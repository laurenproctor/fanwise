import type { BillingInterval, Proration, SubscriptionStatus } from "./gateway"

/**
 * The pricing model and the rules that make it work, as pure functions.
 *
 * docs/billing.md and the pricing page agree on the numbers: $9 a month plus
 * $6 per connected external marketplace, and annual billing is ten months for
 * twelve. They are here once, read by the settings page and the tests, and
 * the provider is configured to match them rather than the other way round.
 * The provider's prices are the ones that charge; these are the ones Fanwise
 * shows, and a unit test keeps the arithmetic honest.
 */

export const PRICING: Record<BillingInterval, { base: number; channel: number }> = {
  month: { base: 9, channel: 6 },
  year: { base: 90, channel: 60 },
}

/**
 * How long a new workspace may use Fanwise before subscribing.
 *
 * The roadmap's C1 says "trial" and docs/decisions/0002 item 18 has not
 * settled whether that means a trial or a free plan. Fourteen days is the
 * assumption C1 builds on, kept on Fanwise's side rather than the provider's
 * so that either answer to item 18 is a change here and in the entitlement
 * service at C2, not to any subscription. Nothing is gated on it yet; that is
 * C2's job. It is displayed, so it has to be true.
 */
export const TRIAL_DAYS = 14

export function estimate(interval: BillingInterval, billableChannels: number): number {
  const prices = PRICING[interval]
  return prices.base + prices.channel * Math.max(0, billableChannels)
}

export function formatUsd(amount: number): string {
  return `$${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
}

/**
 * Which subscription statuses mean the workspace holds a live subscription.
 *
 * `past_due` and `unpaid` are included: the subscription exists and the
 * provider is chasing payment, which is a fact to show, not a reason to
 * pretend there is no subscription and offer a second checkout.
 */
const LIVE: ReadonlySet<SubscriptionStatus> = new Set([
  "trialing",
  "active",
  "past_due",
  "unpaid",
  "incomplete",
  "paused",
])

export function isLiveSubscription(status: SubscriptionStatus | null): boolean {
  return status !== null && LIVE.has(status)
}

/**
 * How a quantity change is charged. This is docs/billing.md rules 2 and 3.
 *
 *   Going down never credits. A disconnected channel was paid for through
 *   the end of the period, the connection is simply gone, and the next
 *   invoice carries the lower number. That is "decrements at the end of the
 *   period, no mid-cycle refund" in money terms, without a scheduled job to
 *   remember to decrement.
 *
 *   Going up prorates the remainder of the period — unless the new quantity
 *   is one the workspace has already been billed for this period. A creator
 *   who connects, disconnects and reconnects inside one period pays for the
 *   unit once, which is rule 3: a connection bills for a minimum of one full
 *   period, and cycling around it gains nothing.
 */
export function prorationFor(params: {
  current: number
  target: number
  periodPeak: number
}): Proration | null {
  const { current, target, periodPeak } = params
  if (target === current) return null
  if (target < current) return "none"
  return target <= periodPeak ? "none" : "prorate"
}

/** Where the peak lands after a write to `target`. */
export function nextPeriodPeak(periodPeak: number, target: number): number {
  return Math.max(periodPeak, target)
}

/**
 * The idempotency key for one attempt at one ledger row.
 *
 * The provider binds a key to the parameters of the first request made with
 * it, and refuses the same key with different parameters. Every attempt sets
 * an absolute quantity that may have moved since the last attempt, so each
 * attempt needs its own key — and the attempt number is persisted on the row
 * before the call, so the key is still written down before it is used.
 */
export function attemptKey(eventKey: string, attempt: number): string {
  return `${eventKey}:a${attempt}`
}

export function customerKey(workspaceId: string): string {
  return `customer:${workspaceId}`
}
