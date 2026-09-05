import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/supabase/database.types"
import { jobs } from "@/lib/jobs"
import { keyFor, type PublicationKind } from "./idempotency"
import type { ChannelListingDraft } from "@/lib/channels/types"

/**
 * Starting a publication, idempotently.
 *
 * This runs as the signed-in user, through RLS, because starting one is how
 * Publish is authorized: a member who cannot insert the job row is a member who
 * may not publish, and that is the database's judgement rather than the UI's.
 *
 * The idempotency key is persisted here, in the insert that creates the job
 * row, before anything external is contacted. There is no window in which a job
 * exists without its key, because they are the same statement.
 *
 * What a second click does, precisely: the insert loses on the unique
 * constraint, the existing row is read, and its status decides the answer.
 * Nothing is enqueued and no provider is contacted.
 */

export type StartOutcome =
  | { kind: "started"; jobId: string }
  | { kind: "already_running"; jobId: string }
  | { kind: "already_done"; jobId: string }
  | { kind: "retried"; jobId: string }
  | { kind: "error"; message: string }

const UNIQUE_VIOLATION = "23505"

export async function startPublication(params: {
  supabase: SupabaseClient<Database>
  workspaceId: string
  listingId: string
  kind: PublicationKind
  draft: ChannelListingDraft
}): Promise<StartOutcome> {
  const { supabase, workspaceId, listingId, kind, draft } = params
  const idempotencyKey = keyFor({ kind, workspaceId, listingId, draft })

  const { data: inserted, error } = await supabase
    .from("publication_jobs")
    .insert({
      workspace_id: workspaceId,
      channel_listing_id: listingId,
      kind,
      idempotency_key: idempotencyKey,
      status: "pending",
    })
    .select("id")
    .single()

  if (!error && inserted) {
    await enqueue(workspaceId, inserted.id, 0)
    return { kind: "started", jobId: inserted.id }
  }

  if (error?.code !== UNIQUE_VIOLATION) {
    console.error("[publishing] could not create job", { kind, error })
    return { kind: "error", message: "That could not be started. Try again." }
  }

  // The key was already claimed, so this is the same logical operation as one
  // that already exists. What happens next depends entirely on how that one
  // ended, and in three of the four cases the answer is "nothing".
  const { data: existing, error: readError } = await supabase
    .from("publication_jobs")
    .select("id, status, attempt_count")
    .eq("workspace_id", workspaceId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle()

  if (readError || !existing) {
    // The row exists (the insert collided with it) but this member cannot read
    // it, which means it belongs to another workspace. Reporting it as a
    // collision would confirm the existence of another tenant's row.
    return { kind: "error", message: "That could not be started. Try again." }
  }

  if (existing.status === "succeeded") return { kind: "already_done", jobId: existing.id }
  if (existing.status === "pending" || existing.status === "running") {
    return { kind: "already_running", jobId: existing.id }
  }

  // Failed. A retry is the same operation tried again, so it reuses the row and
  // its key rather than creating a second one. The runner's compare-and-swap is
  // what actually re-claims it.
  await enqueue(workspaceId, existing.id, existing.attempt_count)
  return { kind: "retried", jobId: existing.id }
}

/**
 * Hands the job to the queue.
 *
 * The key given to the queue is NOT the idempotency key, and conflating the two
 * is a real bug rather than a stylistic choice. They answer different questions:
 *
 *   the database key   may this operation happen at all? Once, ever.
 *   the delivery key   has this exact hand-off already been queued? Once, per
 *                      attempt.
 *
 * The in-process queue remembers every key it has seen for the lifetime of the
 * process, so passing the idempotency key would make a retry of a failed job
 * silently vanish: the queue would recognise the key, return the original job,
 * and never call the handler again. Keying on the attempt keeps a retry
 * deliverable while still collapsing a double hand-off within one request.
 */
async function enqueue(
  workspaceId: string,
  publicationJobId: string,
  attempt: number,
): Promise<void> {
  await jobs.enqueue(
    "publish_listing",
    { workspaceId, publicationJobId },
    { idempotencyKey: `${publicationJobId}:${attempt}` },
  )
}
