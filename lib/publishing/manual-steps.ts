import type { Database } from "@/lib/supabase/database.types"
import type { ChannelListing, ManualStepSpec } from "@/lib/channels/types"

export type ManualStepRow = Database["public"]["Tables"]["listing_manual_steps"]["Row"]

/**
 * Manual steps, and the derived condition ADR 0001 asks for.
 *
 * The ADR's sentence is the whole of this file:
 *
 *   "Fully published is therefore a derived condition, not a status value:
 *   published, and no required manual step left incomplete. Do not report the
 *   product as live until it holds."
 *
 * So `live` is computed here, from the listing status and the step rows, and is
 * never stored. Storing it would create a second source of truth that could
 * disagree with the rows, and the disagreement would be invisible: a listing
 * labelled live with an outstanding file step is exactly the state the ADR
 * exists to prevent.
 *
 * Everything here is pure. Rows in, verdict out.
 */

export interface ManualStepState {
  spec: ManualStepSpec
  completedAt: string | null
}

/**
 * Pairs the adapter's declared steps with whatever rows exist.
 *
 * Driven by the specs, not by the rows. A row whose adapter no longer declares
 * its step is dropped rather than rendered: the step is not outstanding any
 * more, because the channel stopped asking for it. A spec with no row yet is
 * simply incomplete, which is what a step nobody has recorded means.
 */
export function mergeManualSteps(
  specs: readonly ManualStepSpec[],
  rows: readonly ManualStepRow[],
): ManualStepState[] {
  return specs.map((spec) => ({
    spec,
    completedAt: rows.find((row) => row.step_key === spec.key)?.completed_at ?? null,
  }))
}

/** Required steps nobody has done yet. These are what hold a listing back. */
export function outstandingRequired(states: readonly ManualStepState[]): ManualStepState[] {
  return states.filter((state) => state.spec.required && state.completedAt === null)
}

/**
 * True when every step that gates activation is done, which is the moment the
 * adapter is allowed to take the provider object live.
 */
export function readyToActivate(states: readonly ManualStepState[]): boolean {
  const gating = states.filter((state) => state.spec.gatesActivation)
  return gating.length > 0 && gating.every((state) => state.completedAt !== null)
}

/**
 * What a creator is actually told about one listing on one channel.
 *
 * Five words, chosen so that none of them can be read as "for sale" unless it
 * is. `published_not_live` is the state ADR 0001 cares about: the provider has
 * the product, Fanwise confirmed it, and a buyer cannot reach it yet.
 */
export type ListingLiveness =
  "unpublished" | "publishing" | "published_not_live" | "live" | "failed"

export function liveness(
  listing: Pick<ChannelListing, "status" | "external_listing_id">,
  states: readonly ManualStepState[],
): ListingLiveness {
  if (listing.status === "publishing") return "publishing"
  if (listing.status === "failed") return "failed"
  if (listing.status !== "published" || !listing.external_listing_id) return "unpublished"
  return outstandingRequired(states).length === 0 ? "live" : "published_not_live"
}

export const LIVENESS_LABELS: Record<ListingLiveness, string> = {
  unpublished: "Not published",
  publishing: "Publishing",
  published_not_live: "Published, not live",
  live: "Live",
  failed: "Failed",
}
