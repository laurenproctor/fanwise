import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/supabase/database.types"

/**
 * Approving a listing. Step B2.
 *
 * A person saying the stored text is the text to ship. It stamps
 * `approved_at`, which `awaitingReview` compares against the moment model copy
 * last landed; nothing else changes, and the snapshot history already holds
 * the text being approved from the save that put it there.
 *
 * Runs as the signed-in user, through RLS. It approves what is stored, which
 * is why the editor offers it only when nothing is unsaved: approving text the
 * screen shows and the row does not hold would be approving something else.
 */

export type ApproveOutcome =
  { kind: "approved"; approvedAt: string } | { kind: "error"; message: string }

export async function approveListing(params: {
  supabase: SupabaseClient<Database>
  workspaceId: string
  listingId: string
}): Promise<ApproveOutcome> {
  const { supabase, workspaceId, listingId } = params
  const approvedAt = new Date().toISOString()

  const { data, error } = await supabase
    .from("channel_listings")
    .update({ approved_at: approvedAt })
    .eq("id", listingId)
    .eq("workspace_id", workspaceId)
    .select("id")
    .maybeSingle()

  if (error) {
    console.error("[ai] could not approve listing", { listingId, error })
    return { kind: "error", message: "That could not be approved. Try again." }
  }
  if (!data) return { kind: "error", message: "That listing could not be found." }
  return { kind: "approved", approvedAt }
}
