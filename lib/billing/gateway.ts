/**
 * The billing gateway contract.
 *
 * Everything the rest of lib/billing needs from a payment provider, in
 * Fanwise's words. The vendor lives in lib/billing/providers and is chosen
 * there; nothing outside that folder names it, and a unit test reads the tree
 * to keep it so, the same way the channel keys and the model vendor are kept
 * inside their layers.
 *
 * The shape follows docs/billing.md: one subscription per workspace, a base
 * item at quantity one and a channel item whose quantity is the count of
 * connected billable channels. There is no plan enum anywhere in this file
 * because there is no plan.
 */

export type BillingInterval = "month" | "year"

export const SUBSCRIPTION_STATUSES = [
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
] as const

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]

/**
 * A subscription as the provider holds it, reduced to what Fanwise records.
 *
 * `workspaceId` comes from metadata the checkout wrote onto the subscription,
 * so a webhook can be attributed without a lookup. It is null for a
 * subscription Fanwise did not create, which the webhook handler then
 * attributes by customer instead, or ignores.
 */
export interface SubscriptionSnapshot {
  id: string
  customerId: string
  workspaceId: string | null
  status: SubscriptionStatus
  interval: BillingInterval | null
  baseItemId: string | null
  channelItemId: string | null
  channelQuantity: number
  /** ISO 8601. Null while the provider has not started a period. */
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
}

/**
 * How a quantity change is charged.
 *
 * `prorate` charges the remainder of the current period for the added units.
 * `none` changes the quantity and charges nothing now: the next invoice
 * carries the new number. docs/billing.md rules 2 and 3 are expressed
 * entirely through which of these a write uses, and that decision is made in
 * lib/billing/rules.ts, never here and never in the provider.
 */
export type Proration = "prorate" | "none"

export interface SetChannelQuantityParams {
  subscriptionId: string
  /** Null when the subscription carries no channel item yet. */
  channelItemId: string | null
  /** Which price to attach when an item has to be created. */
  interval: BillingInterval
  quantity: number
  proration: Proration
  /** Persisted before this call. Architecture invariant 3. */
  idempotencyKey: string
}

export interface SetChannelQuantityResult {
  /** Null when the item was removed because the quantity reached zero. */
  channelItemId: string | null
  quantity: number
  /** The provider's own response, for the ledger. Never a credential. */
  raw: unknown
}

/**
 * A provider webhook, reduced to the events Fanwise acts on.
 *
 * Every other event type arrives as `ignored`, carrying only the provider's
 * name for it, so the receipt table records that it was seen.
 */
export type WebhookEvent =
  | { id: string; type: "subscription_changed"; subscription: SubscriptionSnapshot }
  | { id: string; type: "subscription_deleted"; subscription: SubscriptionSnapshot }
  | {
      id: string
      type: "checkout_completed"
      customerId: string | null
      subscriptionId: string | null
      workspaceId: string | null
    }
  | { id: string; type: "ignored"; providerType: string }

export interface BillingGateway {
  /** The request header the provider signs webhooks with, lower-cased. */
  readonly signatureHeader: string

  ensureCustomer(params: {
    workspaceId: string
    workspaceName: string
    email: string | null
    idempotencyKey: string
  }): Promise<{ customerId: string }>

  createCheckoutSession(params: {
    customerId: string
    workspaceId: string
    interval: BillingInterval
    channelQuantity: number
    successUrl: string
    cancelUrl: string
  }): Promise<{ url: string }>

  createPortalSession(params: { customerId: string; returnUrl: string }): Promise<{ url: string }>

  retrieveSubscription(subscriptionId: string): Promise<SubscriptionSnapshot>

  setChannelQuantity(params: SetChannelQuantityParams): Promise<SetChannelQuantityResult>

  /**
   * Verifies the signature and reduces the event. Throws a
   * BillingGatewayError with code `signature_invalid` before any part of the
   * body is read, per docs/security.md rule 5.
   */
  parseWebhook(rawBody: string, signature: string | null): WebhookEvent
}

export const BILLING_ERROR_CODES = [
  /** The webhook's signature did not verify. Never retried. */
  "signature_invalid",
  /** The provider refused the request as malformed or impossible. */
  "invalid_request",
  /** A key was reused with different parameters. A bug, never retried. */
  "idempotency_conflict",
  /** Rate limited. Retryable. */
  "rate_limited",
  /** The provider is down or erroring. Retryable. */
  "provider_unavailable",
  /** The request never reached the provider. Retryable. */
  "network",
  /** The deployment has no billing provider configured. */
  "not_configured",
  "unknown",
] as const

export type BillingErrorCode = (typeof BILLING_ERROR_CODES)[number]

const RETRYABLE = new Set<BillingErrorCode>(["rate_limited", "provider_unavailable", "network"])

export function isRetryableBillingError(code: BillingErrorCode): boolean {
  return RETRYABLE.has(code)
}

/**
 * The one error type the provider layer throws.
 *
 * `message` is written for a creator and carries no status code, URL or
 * key. The provider's original goes in `raw` for the ledger; it is never
 * rendered and never logged in full, because a provider error can carry the
 * request that produced it.
 */
export class BillingGatewayError extends Error {
  readonly code: BillingErrorCode
  readonly raw: unknown

  constructor(code: BillingErrorCode, message: string, raw?: unknown) {
    super(message)
    this.name = "BillingGatewayError"
    this.code = code
    this.raw = raw
  }
}

export interface NormalizedBillingError {
  code: BillingErrorCode
  message: string
  retryable: boolean
}

/** Anything thrown near the provider, as a code and a sentence. */
export function normalizeBillingError(error: unknown): NormalizedBillingError {
  if (error instanceof BillingGatewayError) {
    return {
      code: error.code,
      message: error.message,
      retryable: isRetryableBillingError(error.code),
    }
  }
  return {
    code: "unknown",
    message: "Billing could not be updated. Nothing was charged. Try again in a moment.",
    retryable: false,
  }
}
