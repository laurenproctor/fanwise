import { createClient } from "@/lib/supabase/server"
import type { Database } from "@/lib/supabase/database.types"
import type { ManualStepRow } from "./manual-steps"

export type PublicationJob = Database["public"]["Tables"]["publication_jobs"]["Row"]

/**
 * What the publish surfaces need to read, for a whole product at once.
 *
 * Batched by listing id rather than fetched per card. A product on six channels
 * is six cards, and six cards each running two queries is twelve round trips to
 * render one page.
 *
 * Both reads run as the signed-in user, so RLS does the tenant filtering and
 * neither can return another workspace's row even though both are also scoped
 * in code.
 */

export interface PublicationView {
  manualSteps: Map<string, ManualStepRow[]>
  /** The most recent job per listing, whatever its outcome. */
  latestJob: Map<string, PublicationJob>
}

export async function loadPublicationViews(
  workspaceId: string,
  listingIds: readonly string[],
): Promise<PublicationView> {
  const empty: PublicationView = { manualSteps: new Map(), latestJob: new Map() }
  if (listingIds.length === 0) return empty

  const supabase = await createClient()

  const [steps, jobs] = await Promise.all([
    supabase
      .from("listing_manual_steps")
      .select("*")
      .eq("workspace_id", workspaceId)
      .in("channel_listing_id", listingIds),
    supabase
      .from("publication_jobs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .in("channel_listing_id", listingIds)
      .order("created_at", { ascending: false }),
  ])

  if (steps.error) throw steps.error
  if (jobs.error) throw jobs.error

  const manualSteps = new Map<string, ManualStepRow[]>()
  for (const row of steps.data ?? []) {
    const list = manualSteps.get(row.channel_listing_id) ?? []
    list.push(row)
    manualSteps.set(row.channel_listing_id, list)
  }

  // Ordered newest first above, so the first row seen per listing is the latest
  // and every later one is skipped.
  const latestJob = new Map<string, PublicationJob>()
  for (const job of jobs.data ?? []) {
    if (!latestJob.has(job.channel_listing_id)) latestJob.set(job.channel_listing_id, job)
  }

  return { manualSteps, latestJob }
}
