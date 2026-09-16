/**
 * The gallery in the order a visitor sees it, cover first.
 *
 * Three things decide the order, in this precedence: the page's own cover
 * choice, when the creator made one; the asset the product marks as its
 * cover; then the product's own image order. `sort_order` alone is not
 * enough. An upload takes the column's default, so every image of a product
 * that was never reordered ties at zero, and the tie fell to whichever row the
 * database returned first — which is how a chosen cover ended up third.
 *
 * `created_at` is used when the caller has it. The public page cannot ask for
 * it — `anon` is granted named columns only — so there the id settles a tie,
 * which is arbitrary but the same on every request.
 */
export function orderGallery<
  T extends { id: string; asset_type: string; sort_order: number | null; created_at?: string },
>(assets: readonly T[], chosenCoverId: string | null): T[] {
  const rank = (asset: T) =>
    asset.id === chosenCoverId ? 0 : asset.asset_type === "cover_image" ? 1 : 2
  return [...assets].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
      (a.created_at ?? "").localeCompare(b.created_at ?? "") ||
      a.id.localeCompare(b.id),
  )
}
