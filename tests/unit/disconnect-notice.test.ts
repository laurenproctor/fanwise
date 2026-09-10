import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { disconnectMessage } from "@/components/channels/connect-button"
import { paidThroughCurrentPeriod, type BillingState } from "@/lib/billing/state"

/**
 * The disconnect confirmation may say "you have paid for this channel through
 * the end of the current billing period" only when that is true. It was
 * keyed on the channel's `billable` flag, which is a statement about the
 * channel, not about whether anyone paid; on an unconfigured deployment or a
 * trial it told a creator about an invoice that did not exist. The sentence
 * now follows the billing state, and these tests hold each side of the line.
 */

const NOW = new Date("2026-09-10T12:00:00Z")
const FUTURE = "2026-10-01T00:00:00Z"
const PAST = "2026-09-01T00:00:00Z"

function subscribed(overrides: Partial<Extract<BillingState, { kind: "subscribed" }>> = {}) {
  return {
    kind: "subscribed" as const,
    status: "active" as const,
    interval: "month" as const,
    channelQuantity: 1,
    currentPeriodEnd: FUTURE,
    cancelAtPeriodEnd: false,
    ...overrides,
  }
}

describe("paidThroughCurrentPeriod", () => {
  it("is false with no provider configured, on trial, and after the trial", () => {
    expect(paidThroughCurrentPeriod({ kind: "not_configured" }, NOW)).toBe(false)
    expect(
      paidThroughCurrentPeriod({ kind: "trialing", trialEndsAt: FUTURE, daysLeft: 20 }, NOW),
    ).toBe(false)
    expect(paidThroughCurrentPeriod({ kind: "trial_ended" }, NOW)).toBe(false)
  })

  it("is true only for an active subscription whose current period has not ended", () => {
    expect(paidThroughCurrentPeriod(subscribed(), NOW)).toBe(true)
  })

  it("is false for a live but unpaid subscription", () => {
    for (const status of ["trialing", "past_due", "unpaid", "incomplete", "paused"] as const) {
      expect(paidThroughCurrentPeriod(subscribed({ status }), NOW), status).toBe(false)
    }
  })

  it("is false once the period has ended, or when no period is known", () => {
    expect(paidThroughCurrentPeriod(subscribed({ currentPeriodEnd: PAST }), NOW)).toBe(false)
    expect(paidThroughCurrentPeriod(subscribed({ currentPeriodEnd: null }), NOW)).toBe(false)
    expect(paidThroughCurrentPeriod(subscribed({ currentPeriodEnd: "not a date" }), NOW)).toBe(
      false,
    )
  })

  it("does not care whether the subscription is set to cancel: the period is still paid", () => {
    expect(paidThroughCurrentPeriod(subscribed({ cancelAtPeriodEnd: true }), NOW)).toBe(true)
  })
})

describe("the disconnect confirmation", () => {
  const PAID = "You have paid for this channel through the end of the current billing period"

  it("never mentions payment unless the period is genuinely paid", () => {
    const message = disconnectMessage("Etsy", false)
    expect(message).toContain("Disconnecting Etsy removes its listings from Fanwise.")
    expect(message).toContain("Anything already published stays on Etsy.")
    expect(message).not.toContain(PAID)
  })

  it("says so when it is", () => {
    const message = disconnectMessage("Etsy", true)
    expect(message).toContain("Disconnecting Etsy removes its listings from Fanwise.")
    expect(message).toContain(PAID)
    expect(message).toContain("it comes off the next invoice")
  })

  it("is wired from billing state on the channels page, not from the channel row alone", () => {
    const ROOT = join(__dirname, "..", "..")
    const page = readFileSync(join(ROOT, "app", "[slug]", "channels", "page.tsx"), "utf8")
    expect(page).toContain("paidThroughCurrentPeriod(overview.state)")
    expect(page).toContain("paidThroughPeriod={channel.billable && paidThroughPeriod}")
    expect(page).not.toMatch(/billable=\{channel\.billable\}/)
    const button = readFileSync(join(ROOT, "components", "channels", "connect-button.tsx"), "utf8")
    expect(button).not.toContain("billable?: boolean")
    expect(button).toContain("disconnectMessage(channelName, paidThroughPeriod === true)")
  })
})
