import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/supabase/database.types"
import { jobs } from "@/lib/jobs"
import type { JobQueue } from "@/lib/jobs"

/**
 * Asking for a generation, as the signed-in user.
 *
 * The row is inserted through RLS, so a member who cannot insert it is a
 * member who may not compose for this workspace, and that is the database's
 * judgement rather than the page's. The partial unique index on in-flight rows
 * is what makes a double click one generation: the second insert loses and is
 * told so.
 *
 * Not an idempotency key in the invariant-3 sense. A generation is not an
 * external write; composing twice costs a cent and changes nothing a buyer can
 * see. The guard here is against paying twice for one click, not against
 * creating two of something.
 */

export type StartGenerationOutcome =
  | { kind: "started"; generationId: string }
  | { kind: "already_running" }
  | { kind: "error"; message: string }

const UNIQUE_VIOLATION = "23505"

export async function startGeneration(params: {
  supabase: SupabaseClient<Database>
  workspaceId: string
  productId: string
  listingId: string
  userId: string
  /** Test seam. Production hands off to the configured queue. */
  queue?: JobQueue
}): Promise<StartGenerationOutcome> {
  const { supabase, workspaceId, productId, listingId, userId, queue = jobs } = params

  const { data, error } = await supabase
    .from("ai_generations")
    .insert({
      workspace_id: workspaceId,
      product_id: productId,
      channel_listing_id: listingId,
      requested_by: userId,
      generation_type: "listing",
      status: "pending",
    })
    .select("id")
    .single()

  if (error || !data) {
    if (error?.code === UNIQUE_VIOLATION) return { kind: "already_running" }
    console.error("[ai] could not create generation", { listingId, error })
    return { kind: "error", message: "Composing could not be started. Try again." }
  }

  await queue.enqueue(
    "generate_listing",
    { workspaceId, generationId: data.id },
    // The delivery key, per lib/publishing/start.ts: one hand-off per row.
    { idempotencyKey: `${data.id}:0` },
  )

  return { kind: "started", generationId: data.id }
}
