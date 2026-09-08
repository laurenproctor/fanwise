import type { ChannelListing } from "@/lib/channels/types"

/**
 * Whether a listing holds composed copy nobody has looked at.
 *
 * docs/ai-merchandising.md: no first generation reaches a marketplace without
 * explicit approval. Applying or restoring a generation stamps
 * `metadata.composedAt`; the Approve button (lib/ai/approve.ts) stamps
 * `approved_at`. When the first is newer than the second, Publish refuses. At
 * B1, before the button existed, a save did the stamping; B2 separated the two
 * so a creator can save an edit and still be asked to read the whole.
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
  "This listing was composed and has not been approved. Open it, read it, and approve it before publishing."
