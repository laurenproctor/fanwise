import type { ChannelListing } from "@/lib/channels/types"

/**
 * Whether a listing holds composed copy nobody has looked at.
 *
 * docs/ai-merchandising.md: no first generation reaches a marketplace without
 * a person saying so. Applying or restoring a generation stamps
 * `metadata.composedAt`; publishing stamps `approved_at` (lib/ai/approve.ts)
 * when the first is newer, because the click to publish is the person saying
 * so. The comparison here decides whether the button reads "Review and
 * publish" and whether the click stamps. At B1 a save did the stamping and
 * Publish refused; B2 tried a separate Approve button and dropped it the same
 * day as ceremony: two clicks that both meant "I have looked at this".
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
