import Stripe from "stripe"
import { z } from "zod"
import {
  BillingGatewayError,
  SUBSCRIPTION_STATUSES,
  type BillingGateway,
  type SetChannelQuantityParams,
  type SetChannelQuantityResult,
  type SubscriptionSnapshot,
  type WebhookEvent,
} from "@/lib/billing/gateway"
import { itemRole, type StripeConfig } from "./config"

/**
 * The vendor, behind the gateway.
 *
 * This is the only file that imports the vendor's SDK, and the only place
 * its object shapes are read. Everything it returns is validated with Zod
 * before use (CLAUDE.md rule 6) even though the SDK is typed, because a type
 * is a promise about the version of the API the SDK was built against and a
 * webhook can arrive from any version the dashboard is set to.
 *
 * Errors leave here as BillingGatewayError only. The SDK's own errors carry
 * the request that produced them, and the request carried the key.
 */

/**
 * The subset of a subscription Fanwise reads.
 *
 * Period boundaries live on the items, not the subscription: the vendor moved
 * them there in the 2025 API versions, and a subscription's items may in
 * principle have different periods. Fanwise's never do — both items share one
 * anchor — so the base item's period is the subscription's.
 */
const subscriptionSchema = z.object({
  id: z.string(),
  customer: z.union([z.string(), z.object({ id: z.string() })]),
  status: z.enum(SUBSCRIPTION_STATUSES),
  cancel_at_period_end: z.boolean(),
  metadata: z.record(z.string(), z.string()).default({}),
  items: z.object({
    data: z.array(
      z.object({
        id: z.string(),
        quantity: z.number().int().nonnegative().optional(),
        current_period_start: z.number().optional(),
        current_period_end: z.number().optional(),
        price: z.object({ id: z.string() }),
      }),
    ),
  }),
})

const checkoutSessionSchema = z.object({
  customer: z.union([z.string(), z.object({ id: z.string() }), z.null()]).optional(),
  subscription: z.union([z.string(), z.object({ id: z.string() }), z.null()]).optional(),
  client_reference_id: z.string().nullable().optional(),
})

const subscriptionItemSchema = z.object({
  id: z.string(),
  quantity: z.number().int().nonnegative().optional(),
})

function epochToIso(seconds: number | undefined): string | null {
  return typeof seconds === "number" ? new Date(seconds * 1000).toISOString() : null
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null
  return typeof value === "string" ? value : value.id
}

/**
 * The vendor's errors, in Fanwise's vocabulary.
 *
 * The message is written for a creator. The original object is kept as `raw`
 * for the ledger and is never rendered or logged in full.
 */
function toGatewayError(error: unknown): BillingGatewayError {
  if (error instanceof BillingGatewayError) return error

  if (error instanceof Stripe.errors.StripeError) {
    const raw = { type: error.type, code: error.code, statusCode: error.statusCode }
    switch (error.type) {
      case "StripeSignatureVerificationError":
        return new BillingGatewayError(
          "signature_invalid",
          "The webhook signature did not verify.",
          raw,
        )
      case "StripeIdempotencyError":
        return new BillingGatewayError(
          "idempotency_conflict",
          "Billing could not be updated because a request was repeated with different details.",
          raw,
        )
      case "StripeRateLimitError":
        return new BillingGatewayError(
          "rate_limited",
          "Billing is busy right now. Nothing was charged. Try again in a moment.",
          raw,
        )
      case "StripeConnectionError":
        return new BillingGatewayError(
          "network",
          "Billing could not be reached. Nothing was charged. Try again in a moment.",
          raw,
        )
      case "StripeAPIError":
        return new BillingGatewayError(
          "provider_unavailable",
          "Billing is unavailable right now. Nothing was charged. Try again in a moment.",
          raw,
        )
      case "StripeInvalidRequestError":
      case "StripeCardError":
      case "StripeAuthenticationError":
      case "StripePermissionError":
        return new BillingGatewayError(
          "invalid_request",
          "Billing refused that change. Nothing was charged. Contact support if it persists.",
          raw,
        )
      default:
        return new BillingGatewayError(
          "unknown",
          "Billing could not be updated. Nothing was charged. Try again in a moment.",
          raw,
        )
    }
  }

  return new BillingGatewayError(
    "unknown",
    "Billing could not be updated. Nothing was charged. Try again in a moment.",
    error instanceof Error ? { name: error.name } : undefined,
  )
}

export function createStripeGateway(config: StripeConfig): BillingGateway {
  // The SDK pins the API version it was built against; the dashboard's
  // default only governs webhooks, which is why the schemas above are lenient
  // about optional fields.
  const client = new Stripe(config.secretKey, { typescript: true, maxNetworkRetries: 2 })

  function toSnapshot(input: unknown): SubscriptionSnapshot {
    const parsed = subscriptionSchema.safeParse(input)
    if (!parsed.success) {
      throw new BillingGatewayError(
        "invalid_request",
        "Billing sent a subscription Fanwise could not read.",
        { issues: parsed.error.issues.map((i) => i.path.join(".")) },
      )
    }
    const sub = parsed.data

    let baseItemId: string | null = null
    let channelItemId: string | null = null
    let channelQuantity = 0
    let interval: SubscriptionSnapshot["interval"] = null
    let periodStart: string | null = null
    let periodEnd: string | null = null

    for (const item of sub.items.data) {
      const role = itemRole(config, item.price.id)
      if (!role) continue
      interval = role.interval
      if (role.role === "base") {
        baseItemId = item.id
        periodStart = epochToIso(item.current_period_start)
        periodEnd = epochToIso(item.current_period_end)
      } else {
        channelItemId = item.id
        channelQuantity = item.quantity ?? 0
      }
    }

    // A subscription with no base item still has a period; take it from
    // whichever item carries one so the row is never blank on a shape
    // Fanwise did not build.
    if (!periodEnd) {
      const any = sub.items.data.find((item) => item.current_period_end)
      periodStart = epochToIso(any?.current_period_start)
      periodEnd = epochToIso(any?.current_period_end)
    }

    return {
      id: sub.id,
      customerId: idOf(sub.customer) ?? "",
      workspaceId: sub.metadata.workspace_id ?? null,
      status: sub.status,
      interval,
      baseItemId,
      channelItemId,
      channelQuantity,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    }
  }

  return {
    signatureHeader: "stripe-signature",

    async ensureCustomer({ workspaceId, workspaceName, email, idempotencyKey }) {
      try {
        const customer = await client.customers.create(
          {
            name: workspaceName,
            ...(email ? { email } : {}),
            metadata: { workspace_id: workspaceId },
          },
          { idempotencyKey },
        )
        return { customerId: customer.id }
      } catch (error) {
        throw toGatewayError(error)
      }
    },

    async createCheckoutSession({
      customerId,
      workspaceId,
      interval,
      channelQuantity,
      successUrl,
      cancelUrl,
    }) {
      const prices = config.prices[interval]
      try {
        const session = await client.checkout.sessions.create({
          mode: "subscription",
          customer: customerId,
          client_reference_id: workspaceId,
          line_items: [
            { price: prices.base, quantity: 1 },
            // The provider will not carry a line at quantity zero. The item is
            // created by the first billable connection instead.
            ...(channelQuantity > 0 ? [{ price: prices.channel, quantity: channelQuantity }] : []),
          ],
          subscription_data: { metadata: { workspace_id: workspaceId } },
          allow_promotion_codes: true,
          success_url: successUrl,
          cancel_url: cancelUrl,
        })
        if (!session.url) {
          throw new BillingGatewayError(
            "invalid_request",
            "Billing did not return a checkout page.",
          )
        }
        return { url: session.url }
      } catch (error) {
        throw toGatewayError(error)
      }
    },

    async createPortalSession({ customerId, returnUrl }) {
      try {
        const session = await client.billingPortal.sessions.create({
          customer: customerId,
          return_url: returnUrl,
        })
        return { url: session.url }
      } catch (error) {
        throw toGatewayError(error)
      }
    },

    async retrieveSubscription(subscriptionId) {
      try {
        const subscription = await client.subscriptions.retrieve(subscriptionId)
        return toSnapshot(subscription)
      } catch (error) {
        throw toGatewayError(error)
      }
    },

    async setChannelQuantity(params: SetChannelQuantityParams): Promise<SetChannelQuantityResult> {
      const { subscriptionId, channelItemId, interval, quantity, idempotencyKey } = params
      const proration_behavior = params.proration === "prorate" ? "create_prorations" : "none"

      try {
        if (quantity === 0) {
          if (!channelItemId) return { channelItemId: null, quantity: 0, raw: null }
          const deleted = await client.subscriptionItems.del(
            channelItemId,
            { proration_behavior },
            { idempotencyKey },
          )
          return {
            channelItemId: null,
            quantity: 0,
            raw: { id: deleted.id, deleted: deleted.deleted },
          }
        }

        if (channelItemId) {
          const item = await client.subscriptionItems.update(
            channelItemId,
            { quantity, proration_behavior },
            { idempotencyKey },
          )
          const parsed = subscriptionItemSchema.parse(item)
          return { channelItemId: parsed.id, quantity: parsed.quantity ?? quantity, raw: parsed }
        }

        const item = await client.subscriptionItems.create(
          {
            subscription: subscriptionId,
            price: config.prices[interval].channel,
            quantity,
            proration_behavior,
          },
          { idempotencyKey },
        )
        const parsed = subscriptionItemSchema.parse(item)
        return { channelItemId: parsed.id, quantity: parsed.quantity ?? quantity, raw: parsed }
      } catch (error) {
        throw toGatewayError(error)
      }
    },

    parseWebhook(rawBody, signature): WebhookEvent {
      if (!signature) {
        throw new BillingGatewayError("signature_invalid", "The webhook carried no signature.")
      }

      let event: Stripe.Event
      try {
        event = client.webhooks.constructEvent(rawBody, signature, config.webhookSecret)
      } catch (error) {
        const normalized = toGatewayError(error)
        // Whatever went wrong before verification is a verification failure
        // to the caller: nothing in the body has been trusted yet.
        throw new BillingGatewayError("signature_invalid", normalized.message, normalized.raw)
      }

      switch (event.type) {
        case "customer.subscription.created":
        case "customer.subscription.updated":
          return {
            id: event.id,
            type: "subscription_changed",
            subscription: toSnapshot(event.data.object),
          }
        case "customer.subscription.deleted":
          return {
            id: event.id,
            type: "subscription_deleted",
            subscription: toSnapshot(event.data.object),
          }
        case "checkout.session.completed": {
          const session = checkoutSessionSchema.parse(event.data.object)
          return {
            id: event.id,
            type: "checkout_completed",
            customerId: idOf(session.customer),
            subscriptionId: idOf(session.subscription),
            workspaceId: session.client_reference_id ?? null,
          }
        }
        default:
          return { id: event.id, type: "ignored", providerType: event.type }
      }
    },
  }
}
