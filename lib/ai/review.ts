import type { ChannelListing } from "@/lib/channels/types"

/**
 * Whether a listing holds composed copy nobody has looked at.
 *
 * docs/ai-merchandising.md: no first generation reaches a marketplace without
 * explicit approval. The review screen is B2; at B1 the approval is the
 * creator opening the editor, reading what was composed, and saving it. Saving
 * stamps `approved_at`; applying a generation stamps `metadata.composedAt`.
 * When the second is newer than the first, Publish refuses.
 *
 * `composedAt` lives in metadata rather than a column because a rebuild drops
 * it, correctly: the adapter's draft replaced the model's, so there is nothing
 * left to review. `rebuildColumns` keeps only publication-owned keys and this
 * is not one.
 */
export const COMPOSED_AT_KEY = "composedAt"

export function composedAt(listing: Pick<ChannelListing, "metadata">): string | null {
  const metadata = (listing.metadata as Record<string, unknown> | null) ?? {}
  const value = metadata[COMPOSED_AT_KEY]
  return typeof value === "string" && value.length > 0 ? value : null
}

export function awaitingReview(listing: Pick<ChannelListing, "metadata" | "approved_at">): boolean {
  const composed = composedAt(listing)
  if (!composed) return false
  if (!listing.approved_at) return true
  return new Date(listing.approved_at).getTime() < new Date(composed).getTime()
}

export const REVIEW_REQUIRED_MESSAGE =
  "This listing was composed and has not been reviewed. Open it, read it, and save it before publishing."
