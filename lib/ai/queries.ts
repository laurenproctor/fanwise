import { createClient } from "@/lib/supabase/server"
import type { Database } from "@/lib/supabase/database.types"

export type AiGeneration = Database["public"]["Tables"]["ai_generations"]["Row"]

/**
 * The most recent generation per listing, whatever its outcome.
 *
 * Read as the signed-in user, so RLS does the tenant filtering. Newest first,
 * and the first row seen per listing wins, the same shape as
 * loadPublicationViews.
 */
export async function latestGenerations(
  workspaceId: string,
  listingIds: readonly string[],
): Promise<Map<string, AiGeneration>> {
  const latest = new Map<string, AiGeneration>()
  if (listingIds.length === 0) return latest

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("ai_generations")
    .select("*")
    .eq("workspace_id", workspaceId)
    .in("channel_listing_id", listingIds)
    .order("created_at", { ascending: false })

  if (error) throw error

  for (const row of data ?? []) {
    if (!latest.has(row.channel_listing_id)) latest.set(row.channel_listing_id, row)
  }
  return latest
}

/**
 * What the compose panel shows about a generation. A projection rather than
 * the row: the row carries the prompt hash, the token counts and the model,
 * none of which a creator needs to see to decide what to do next.
 */
export interface GenerationSummary {
  id: string
  status: AiGeneration["status"]
  /** Whole listing, or one field. */
  field: string | null
  /** The creator-facing sentence for a failed or rejected generation. */
  message: string | null
  /** True when the copy exists on the row and can be put back. */
  restorable: boolean
  completedAt: string | null
  createdAt: string
}

export function summarize(row: AiGeneration): GenerationSummary {
  return {
    id: row.id,
    status: row.status,
    field: row.generation_type === "field" ? row.field : null,
    message: row.status === "failed" || row.status === "rejected" ? row.error_message : null,
    restorable: row.status === "succeeded" && row.structured_output !== null,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  }
}

/**
 * Every generation for one listing, newest first. The review screen's history.
 *
 * Bounded, because a listing composed two hundred times is a listing whose
 * two-hundredth draft nobody is going to restore.
 */
export async function listGenerations(
  workspaceId: string,
  listingId: string,
  limit = 20,
): Promise<AiGeneration[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("ai_generations")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("channel_listing_id", listingId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) throw error
  return data ?? []
}
