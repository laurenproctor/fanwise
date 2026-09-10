import type { BillingInterval, SubscriptionStatus } from "./gateway"
import { TRIAL_DAYS, isLiveSubscription } from "./rules"

/**
 * What a workspace's billing looks like from the inside, derived at read time.
 *
 * Nothing here is stored. The row says what the provider holds and the
 * workspace says when it was created; the state is the reading of the two
 * together, and a stored copy of that reading would be stale the day the
 * trial ended.
 *
 * `not_configured` is a deployment with no billing provider: CI, a fresh
 * checkout, a developer with no key. Every workspace on such a deployment is
 * in that state and the settings page says so, the same way the channel
 * cards say a channel is not configured rather than offering a button that
 * fails.
 */
export type BillingState =
  | { kind: "not_configured" }
  | { kind: "trialing"; trialEndsAt: string; daysLeft: number }
  | { kind: "trial_ended" }
  | {
      kind: "subscribed"
      status: SubscriptionStatus
      interval: BillingInterval | null
      channelQuantity: number
      currentPeriodEnd: string | null
      cancelAtPeriodEnd: boolean
    }

export interface BillingRowLike {
  subscription_status: SubscriptionStatus | null
  billing_interval: string | null
  channel_quantity: number
  current_period_end: string | null
  cancel_at_period_end: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000

export function trialEndsAt(workspaceCreatedAt: string): Date {
  return new Date(new Date(workspaceCreatedAt).getTime() + TRIAL_DAYS * DAY_MS)
}

export function billingState(params: {
  configured: boolean
  row: BillingRowLike | null
  workspaceCreatedAt: string
  now?: Date
}): BillingState {
  const { configured, row, workspaceCreatedAt } = params
  const now = params.now ?? new Date()

  if (!configured) return { kind: "not_configured" }

  if (row && isLiveSubscription(row.subscription_status)) {
    return {
      kind: "subscribed",
      status: row.subscription_status as SubscriptionStatus,
      interval:
        row.billing_interval === "month" || row.billing_interval === "year"
          ? row.billing_interval
          : null,
      channelQuantity: row.channel_quantity,
      currentPeriodEnd: row.current_period_end,
      cancelAtPeriodEnd: row.cancel_at_period_end,
    }
  }

  const ends = trialEndsAt(workspaceCreatedAt)
  if (now < ends) {
    return {
      kind: "trialing",
      trialEndsAt: ends.toISOString(),
      daysLeft: Math.ceil((ends.getTime() - now.getTime()) / DAY_MS),
    }
  }
  return { kind: "trial_ended" }
}

/**
 * Whether the workspace has actually paid through a current billing period.
 *
 * Narrower than "subscribed" on purpose. A subscription can be live and
 * unpaid: on a provider-side trial, past due, unpaid, incomplete, or paused.
 * Only an active subscription whose current period has not yet ended has
 * been paid for, and only then is it true to tell a creator that a channel
 * they are disconnecting was paid for through the end of the period. With no
 * provider configured, no subscription, or a trial on Fanwise's side, nothing
 * has been paid and nothing may say so.
 */
export function paidThroughCurrentPeriod(state: BillingState, now: Date = new Date()): boolean {
  if (state.kind !== "subscribed") return false
  if (state.status !== "active") return false
  if (!state.currentPeriodEnd) return false
  const end = new Date(state.currentPeriodEnd)
  return !Number.isNaN(end.getTime()) && end > now
}
