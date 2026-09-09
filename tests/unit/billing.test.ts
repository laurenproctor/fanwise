import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import Stripe from "stripe"
import { describe, expect, it } from "vitest"
import { BillingGatewayError, normalizeBillingError } from "@/lib/billing/gateway"
import { itemRole, readStripeConfig } from "@/lib/billing/providers/stripe/config"
import { createStripeGateway } from "@/lib/billing/providers/stripe"
import { selectGateway } from "@/lib/billing/providers"
import {
  PRICING,
  TRIAL_DAYS,
  attemptKey,
  estimate,
  isLiveSubscription,
  nextPeriodPeak,
  prorationFor,
} from "@/lib/billing/rules"
import { billingState } from "@/lib/billing/state"

/**
 * C1's rules, proved without a network.
 *
 * The arithmetic is the pricing page's, the proration rules are
 * docs/billing.md's, and the webhook path is exercised with a body signed
 * the way the vendor signs one, so the signature check is the real check and
 * not a stub of it.
 */

describe("the pricing model", () => {
  it("is $9 plus $6 per marketplace monthly, ten months for twelve annually", () => {
    expect(PRICING.month).toEqual({ base: 9, channel: 6 })
    expect(PRICING.year).toEqual({ base: 90, channel: 60 })
    expect(estimate("month", 0)).toBe(9)
    expect(estimate("month", 2)).toBe(21)
    expect(estimate("year", 2)).toBe(210)
    expect(PRICING.year.base).toBe(PRICING.month.base * 10)
    expect(PRICING.year.channel).toBe(PRICING.month.channel * 10)
  })

  it("never charges for a negative count", () => {
    expect(estimate("month", -3)).toBe(9)
  })
})

describe("proration, docs/billing.md rules 2 and 3", () => {
  it("does nothing when the provider already holds the quantity", () => {
    expect(prorationFor({ current: 2, target: 2, periodPeak: 2 })).toBeNull()
  })

  it("prorates a unit the workspace has not paid for this period", () => {
    expect(prorationFor({ current: 0, target: 1, periodPeak: 0 })).toBe("prorate")
    expect(prorationFor({ current: 1, target: 2, periodPeak: 1 })).toBe("prorate")
  })

  it("never credits a decrement: the unit was paid through the period", () => {
    expect(prorationFor({ current: 2, target: 1, periodPeak: 2 })).toBe("none")
    expect(prorationFor({ current: 1, target: 0, periodPeak: 1 })).toBe("none")
  })

  it("does not charge again for a reconnection inside the paid period", () => {
    // Connected (peak 1), disconnected (current 0), reconnected: the unit was
    // already paid for through the end of this period.
    expect(prorationFor({ current: 0, target: 1, periodPeak: 1 })).toBe("none")
    // A second unit on top of that is new money.
    expect(prorationFor({ current: 0, target: 2, periodPeak: 1 })).toBe("prorate")
  })

  it("carries the peak forward as the highest quantity billed", () => {
    expect(nextPeriodPeak(1, 3)).toBe(3)
    expect(nextPeriodPeak(3, 1)).toBe(3)
  })

  it("gives every attempt its own key on top of the persisted one", () => {
    expect(attemptKey("billing_event:abc", 1)).toBe("billing_event:abc:a1")
    expect(attemptKey("billing_event:abc", 2)).not.toBe(attemptKey("billing_event:abc", 1))
  })
})

describe("billing state", () => {
  const created = "2026-09-01T00:00:00.000Z"

  it("is not configured when there is no provider, whatever the row says", () => {
    expect(billingState({ configured: false, row: null, workspaceCreatedAt: created }).kind).toBe(
      "not_configured",
    )
  })

  it("is a trial for the first fourteen days of a workspace", () => {
    const state = billingState({
      configured: true,
      row: null,
      workspaceCreatedAt: created,
      now: new Date("2026-09-05T12:00:00.000Z"),
    })
    expect(state.kind).toBe("trialing")
    if (state.kind === "trialing") {
      expect(state.daysLeft).toBe(10)
      expect(state.trialEndsAt).toBe("2026-09-15T00:00:00.000Z")
    }
    expect(TRIAL_DAYS).toBe(14)
  })

  it("ends the trial on the fifteenth day", () => {
    expect(
      billingState({
        configured: true,
        row: null,
        workspaceCreatedAt: created,
        now: new Date("2026-09-15T00:00:00.000Z"),
      }).kind,
    ).toBe("trial_ended")
  })

  it("reads a live subscription off the row", () => {
    const state = billingState({
      configured: true,
      workspaceCreatedAt: created,
      now: new Date("2026-12-01T00:00:00.000Z"),
      row: {
        subscription_status: "past_due",
        billing_interval: "year",
        channel_quantity: 2,
        current_period_end: "2027-09-01T00:00:00.000Z",
        cancel_at_period_end: true,
      },
    })
    expect(state).toEqual({
      kind: "subscribed",
      status: "past_due",
      interval: "year",
      channelQuantity: 2,
      currentPeriodEnd: "2027-09-01T00:00:00.000Z",
      cancelAtPeriodEnd: true,
    })
  })

  it("treats a canceled subscription as no subscription", () => {
    expect(isLiveSubscription("canceled")).toBe(false)
    expect(isLiveSubscription("incomplete_expired")).toBe(false)
    expect(isLiveSubscription(null)).toBe(false)
    const state = billingState({
      configured: true,
      workspaceCreatedAt: created,
      now: new Date("2026-12-01T00:00:00.000Z"),
      row: {
        subscription_status: "canceled",
        billing_interval: "month",
        channel_quantity: 0,
        current_period_end: null,
        cancel_at_period_end: false,
      },
    })
    expect(state.kind).toBe("trial_ended")
  })
})

const FULL_ENV = {
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_test",
  STRIPE_PRICE_BASE_MONTHLY: "price_base_m",
  STRIPE_PRICE_BASE_YEARLY: "price_base_y",
  STRIPE_PRICE_CHANNEL_MONTHLY: "price_channel_m",
  STRIPE_PRICE_CHANNEL_YEARLY: "price_channel_y",
}

describe("provider configuration", () => {
  it("is absent, not broken, when there is no secret key", () => {
    expect(readStripeConfig({})).toBeNull()
    expect(readStripeConfig({ STRIPE_SECRET_KEY: "  " })).toBeNull()
    expect(selectGateway({})).toBeNull()
  })

  it("names what is missing once the key is present", () => {
    expect(() => readStripeConfig({ STRIPE_SECRET_KEY: "sk_test_x" })).toThrow(
      /STRIPE_WEBHOOK_SECRET.*STRIPE_PRICE_BASE_MONTHLY/,
    )
  })

  it("tells the four prices apart by id", () => {
    const config = readStripeConfig(FULL_ENV)!
    expect(itemRole(config, "price_base_m")).toEqual({ role: "base", interval: "month" })
    expect(itemRole(config, "price_channel_y")).toEqual({ role: "channel", interval: "year" })
    expect(itemRole(config, "price_other")).toBeNull()
  })
})

describe("the webhook path", () => {
  const config = readStripeConfig(FULL_ENV)!
  const gateway = createStripeGateway(config)

  const subscription = {
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    cancel_at_period_end: false,
    metadata: { workspace_id: "ws-1" },
    items: {
      data: [
        {
          id: "si_base",
          quantity: 1,
          current_period_start: 1_756_684_800,
          current_period_end: 1_759_276_800,
          price: { id: "price_base_m" },
        },
        {
          id: "si_channel",
          quantity: 2,
          current_period_start: 1_756_684_800,
          current_period_end: 1_759_276_800,
          price: { id: "price_channel_m" },
        },
      ],
    },
  }

  function signed(type: string, object: unknown): { body: string; header: string } {
    const body = JSON.stringify({
      id: `evt_${type}`,
      object: "event",
      type,
      data: { object },
      api_version: "2026-08-26.dahlia",
      created: 1_756_684_800,
      livemode: false,
    })
    const header = Stripe.webhooks.generateTestHeaderString({
      payload: body,
      secret: FULL_ENV.STRIPE_WEBHOOK_SECRET,
    })
    return { body, header }
  }

  it("refuses a body with no signature before reading it", () => {
    const { body } = signed("customer.subscription.updated", subscription)
    expect(() => gateway.parseWebhook(body, null)).toThrow(BillingGatewayError)
    try {
      gateway.parseWebhook(body, null)
    } catch (error) {
      expect((error as BillingGatewayError).code).toBe("signature_invalid")
    }
  })

  it("refuses a body signed with a different secret", () => {
    const { body } = signed("customer.subscription.updated", subscription)
    const forged = Stripe.webhooks.generateTestHeaderString({
      payload: body,
      secret: "whsec_other",
    })
    try {
      gateway.parseWebhook(body, forged)
      expect.unreachable("a forged signature verified")
    } catch (error) {
      expect((error as BillingGatewayError).code).toBe("signature_invalid")
    }
  })

  it("reduces a subscription to what Fanwise records, by price id", () => {
    const { body, header } = signed("customer.subscription.updated", subscription)
    const event = gateway.parseWebhook(body, header)
    expect(event.type).toBe("subscription_changed")
    if (event.type !== "subscription_changed") return
    expect(event.subscription).toEqual({
      id: "sub_1",
      customerId: "cus_1",
      workspaceId: "ws-1",
      status: "active",
      interval: "month",
      baseItemId: "si_base",
      channelItemId: "si_channel",
      channelQuantity: 2,
      currentPeriodStart: "2025-09-01T00:00:00.000Z",
      currentPeriodEnd: "2025-10-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
    })
  })

  it("reads a subscription with no channel item as quantity zero", () => {
    const { body, header } = signed("customer.subscription.created", {
      ...subscription,
      items: { data: [subscription.items.data[0]] },
    })
    const event = gateway.parseWebhook(body, header)
    if (event.type !== "subscription_changed") throw new Error(event.type)
    expect(event.subscription.channelItemId).toBeNull()
    expect(event.subscription.channelQuantity).toBe(0)
  })

  it("marks a deleted subscription as such", () => {
    const { body, header } = signed("customer.subscription.deleted", {
      ...subscription,
      status: "canceled",
    })
    const event = gateway.parseWebhook(body, header)
    expect(event.type).toBe("subscription_deleted")
  })

  it("reduces a completed checkout to its ids", () => {
    const { body, header } = signed("checkout.session.completed", {
      id: "cs_1",
      customer: "cus_1",
      subscription: "sub_1",
      client_reference_id: "ws-1",
    })
    expect(gateway.parseWebhook(body, header)).toEqual({
      id: "evt_checkout.session.completed",
      type: "checkout_completed",
      customerId: "cus_1",
      subscriptionId: "sub_1",
      workspaceId: "ws-1",
    })
  })

  it("records every other event as ignored, by the provider's name for it", () => {
    const { body, header } = signed("invoice.paid", { id: "in_1" })
    expect(gateway.parseWebhook(body, header)).toEqual({
      id: "evt_invoice.paid",
      type: "ignored",
      providerType: "invoice.paid",
    })
  })

  it("refuses a subscription in a status it does not know", () => {
    const { body, header } = signed("customer.subscription.updated", {
      ...subscription,
      status: "something_new",
    })
    expect(() => gateway.parseWebhook(body, header)).toThrow(BillingGatewayError)
  })
})

describe("error normalization", () => {
  it("keeps a gateway error's code and marks the transient ones retryable", () => {
    expect(normalizeBillingError(new BillingGatewayError("rate_limited", "busy"))).toEqual({
      code: "rate_limited",
      message: "busy",
      retryable: true,
    })
    expect(normalizeBillingError(new BillingGatewayError("invalid_request", "no")).retryable).toBe(
      false,
    )
  })

  it("turns anything else into an unknown with a sentence a creator can read", () => {
    const normalized = normalizeBillingError(new Error("ECONNRESET at https://x/?key=sk_live"))
    expect(normalized.code).toBe("unknown")
    expect(normalized.message).not.toContain("sk_live")
  })
})

/**
 * The vendor's name stays inside lib/billing/providers, the same way the
 * channel keys stay inside the adapter layer and the model vendor inside
 * lib/ai/providers. Anywhere else means something has started branching on
 * which payment provider it is talking to.
 */
const ROOT = join(__dirname, "..", "..")

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

describe("the payment vendor's name stays inside the provider layer", () => {
  it("appears in no source file outside lib/billing/providers", () => {
    const offenders: string[] = []
    for (const file of sourceFiles(ROOT)) {
      const rel = relative(ROOT, file).split(sep).join("/")
      if (rel.startsWith("lib/billing/providers/") || rel.startsWith("tests/")) continue
      if (rel.startsWith("design/")) continue
      if (readFileSync(file, "utf8").toLowerCase().includes("stripe")) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })

  it("is reached only through the provider index", () => {
    const offenders: string[] = []
    for (const file of sourceFiles(ROOT)) {
      const rel = relative(ROOT, file).split(sep).join("/")
      if (rel.startsWith("lib/billing/providers/") || rel.startsWith("tests/")) continue
      const contents = readFileSync(file, "utf8")
      if (/from ["']@\/lib\/billing\/providers\/[^"']+["']/.test(contents)) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })
})
