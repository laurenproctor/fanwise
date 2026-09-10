import { createAdminClient } from "@/lib/supabase/admin"
import type { Database } from "@/lib/supabase/database.types"
import { countBillableConnections } from "./connections"
import { normalizeBillingError, type BillingGateway } from "./gateway"
import { gateway as defaultGateway } from "./providers"
import { attemptKey, isLiveSubscription, nextPeriodPeak, prorationFor } from "./rules"

type BillingRow = Database["public"]["Tables"]["workspace_billing"]["Row"]
type BillingEvent = Database["public"]["Tables"]["billing_events"]["Row"]

/**
 * The sync job. Carries the ledger to the provider.
 *
 * Runs as the service role, per docs/security.md rule 4, and every query
 * names the workspace it was given. It is enqueued after any write that
 * touches channel_connections and after any webhook that changes the
 * subscription, and it is safe to run at any time: the quantity it sets is
 * absolute, computed from the connections that exist now, so a run that
 * finds nothing to do does nothing.
 *
 * The ledger rows are processed in order and each one sets the quantity to
 * the current count. A burst of connects therefore costs one provider call
 * and a run of no-ops, which is the intended shape: the events are the audit
 * trail and the idempotency keys, not a queue of increments to replay.
 *
 * A workspace with no live subscription leaves its billable events pending.
 * That is deliberate rather than lazy: when a checkout completes, the
 * subscription's webhook enqueues this job, and the pending rows are what
 * carry every connection made during the trial onto the new subscription.
 * "Pending" is also the honest word for what a creator on trial sees in the
 * ledger — recorded, not yet billed.
 */
export async function syncBilling(
  { workspaceId }: { workspaceId: string },
  deps: { gateway?: BillingGateway | null } = {},
): Promise<void> {
  const gateway = deps.gateway === undefined ? defaultGateway() : deps.gateway
  const admin = createAdminClient()

  const { data: pending, error: pendingError } = await admin
    .from("billing_events")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })

  if (pendingError) throw pendingError
  if (!pending || pending.length === 0) return

  // Non-billable channels never reach the provider. Settled first, so an
  // owned storefront's connect and disconnect read as what they are in the
  // ledger — recorded and free — rather than sitting pending forever.
  const free = pending.filter((event) => !event.billable)
  if (free.length > 0) {
    const { error } = await admin
      .from("billing_events")
      .update({
        status: "skipped",
        applied_at: new Date().toISOString(),
        normalized_error_message: "This channel is included in the base price.",
      })
      .in(
        "id",
        free.map((event) => event.id),
      )
      .eq("workspace_id", workspaceId)
    if (error) throw error
  }

  const billable = pending.filter((event) => event.billable)
  if (billable.length === 0) return

  if (!gateway) {
    // No provider on this deployment. The rows stay pending, which is true.
    console.info("[billing] no provider configured; leaving events pending", {
      workspaceId,
      count: billable.length,
    })
    return
  }

  const { data: row, error: rowError } = await admin
    .from("workspace_billing")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle()
  if (rowError) throw rowError

  if (!row || !row.external_subscription_id || !isLiveSubscription(row.subscription_status)) {
    return
  }

  const interval = row.billing_interval === "year" ? "year" : "month"
  const target = await countBillableConnections(admin, workspaceId)

  let current: Pick<BillingRow, "channel_quantity" | "channel_item_id" | "period_peak_quantity"> =
    row

  for (const event of billable) {
    const proration = prorationFor({
      current: current.channel_quantity,
      target,
      periodPeak: current.period_peak_quantity,
    })

    if (proration === null) {
      // Already what the provider holds. An earlier event in this run, or the
      // checkout itself, carried this one; it is applied, not skipped,
      // because the unit it describes is on the subscription.
      await markApplied(admin, event, workspaceId, { noop: true, quantity: target })
      continue
    }

    // The attempt is persisted before the call, so the key the call carries
    // is written down first. Architecture invariant 3.
    const attempt = event.attempt_count + 1
    const { error: attemptError } = await admin
      .from("billing_events")
      .update({ attempt_count: attempt })
      .eq("id", event.id)
      .eq("workspace_id", workspaceId)
    if (attemptError) throw attemptError

    try {
      const result = await gateway.setChannelQuantity({
        subscriptionId: row.external_subscription_id,
        channelItemId: current.channel_item_id,
        interval,
        quantity: target,
        proration,
        idempotencyKey: attemptKey(event.idempotency_key, attempt),
      })

      const peak = nextPeriodPeak(current.period_peak_quantity, result.quantity)
      const { error: rowUpdateError } = await admin
        .from("workspace_billing")
        .update({
          channel_quantity: result.quantity,
          channel_item_id: result.channelItemId,
          period_peak_quantity: peak,
        })
        .eq("workspace_id", workspaceId)
      if (rowUpdateError) throw rowUpdateError

      current = {
        channel_quantity: result.quantity,
        channel_item_id: result.channelItemId,
        period_peak_quantity: peak,
      }

      await markApplied(admin, event, workspaceId, {
        noop: false,
        quantity: result.quantity,
        raw: result.raw,
        proration,
      })
    } catch (error) {
      const normalized = normalizeBillingError(error)
      console.error("[billing] quantity update failed", {
        workspaceId,
        eventId: event.id,
        code: normalized.code,
      })
      const { error: failError } = await admin
        .from("billing_events")
        .update({
          status: normalized.retryable ? "pending" : "failed",
          normalized_error_code: normalized.code,
          normalized_error_message: normalized.message,
          provider_response: rawOf(error) as never,
        })
        .eq("id", event.id)
        .eq("workspace_id", workspaceId)
      if (failError) throw failError

      // A retryable failure is rethrown so the queue retries the job; the row
      // stays pending and the next attempt gets its own key. A permanent one
      // is recorded and the remaining events are left for the next run,
      // because they would set the same quantity and meet the same refusal.
      if (normalized.retryable) throw error
      return
    }
  }
}

function rawOf(error: unknown): unknown {
  if (error && typeof error === "object" && "raw" in error) {
    return (error as { raw: unknown }).raw ?? null
  }
  return null
}

async function markApplied(
  admin: ReturnType<typeof createAdminClient>,
  event: BillingEvent,
  workspaceId: string,
  outcome: { noop: boolean; quantity: number; raw?: unknown; proration?: string },
): Promise<void> {
  const { error } = await admin
    .from("billing_events")
    .update({
      status: "applied",
      applied_at: new Date().toISOString(),
      normalized_error_code: null,
      normalized_error_message: null,
      provider_response: {
        quantity: outcome.quantity,
        noop: outcome.noop,
        ...(outcome.proration ? { proration: outcome.proration } : {}),
        ...(outcome.raw !== undefined ? { provider: outcome.raw } : {}),
      } as never,
    })
    .eq("id", event.id)
    .eq("workspace_id", workspaceId)
  if (error) throw error
}
