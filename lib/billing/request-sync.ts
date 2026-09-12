import { jobs } from "@/lib/jobs"

/**
 * Ask for a billing sync, without making the queue's health the caller's
 * problem.
 *
 * Every caller here has already finished its real work and committed it: the
 * connection row exists, or is gone, and the ledger row was written by the
 * database trigger in the same transaction. The sync is what carries that to
 * the provider afterwards.
 *
 * Enqueueing it with a bare `await` made the queue the last word on whether
 * the operation succeeded. It is not. A provider whose credential is already
 * sealed was told the connection failed and threw its key away; a disconnect
 * that had already deleted the row raised through to the error boundary and
 * told the creator their workspace could not be loaded. Both had worked.
 *
 * Losing the enqueue costs a delay and nothing else. `syncBilling` drains
 * every pending row for the workspace, oldest first, rather than the one it
 * was called about, so the next sync — the next connect, the next disconnect,
 * the next subscription webhook — carries anything an earlier one missed. The
 * ledger is the record; the job is only the nudge.
 *
 * Not silent, per rule 8. The failure is logged with the queue's own words,
 * because "the queue refused" and "the queue is not configured" need different
 * answers and only the message tells them apart. It returns whether the nudge
 * landed, so a caller that wants to say so can.
 */
export async function requestBillingSync(workspaceId: string): Promise<boolean> {
  try {
    await jobs.enqueue("sync_billing", { workspaceId })
    return true
  } catch (error) {
    console.error("[billing] the sync could not be queued", {
      workspaceId,
      name: error instanceof Error ? error.name : "unknown",
      message: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}
