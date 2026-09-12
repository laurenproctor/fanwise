import type { DraftProduct } from "./profile-draft"
import type { PresentationProduct } from "./profile-presentation"

/**
 * Which products a public profile shows, and in what order: the builder's
 * second step, as pure functions over plain data.
 *
 * ## Eligibility comes from the existing lifecycle
 *
 * There is no product-level "published" in Fanwise (ADR 0005): listings are
 * published, products are not. So a product is eligible for a public profile
 * when two facts the product lifecycle already records are true of it:
 *
 *   - it is not archived (`products.archived_at` is null), and
 *   - at least one of its listings is `live`, by the same `liveness()` rule
 *     the catalog uses — published, confirmed, every required step done, and
 *     not reported unpurchasable by the channel.
 *
 * A profile is a place customers choose where to buy; a product with nowhere
 * to buy it has nothing to send them to. No new status is invented for this.
 *
 * ## The arrangement is the whole list, not just the shown part
 *
 * The draft stores every arranged product with a `visible` flag, in display
 * order. Hiding a product flips its flag and leaves it where it is, so turning
 * it back on returns it to the same position rather than the end of the list.
 * "Hidden" here means one thing only: not on the public Fanwise profile. It
 * never touches a listing.
 *
 * A product that was arranged and has since become ineligible keeps its entry
 * and its flag, so nothing the creator chose is lost, but it is never counted
 * as selected, never previewed and never published, and the row says why.
 */

export type Ineligibility = "archived" | "not_live"

export type Eligibility = { eligible: true } | { eligible: false; reason: Ineligibility }

export function eligibilityOf(product: {
  archivedAt: string | null
  liveChannelCount: number
}): Eligibility {
  if (product.archivedAt !== null) return { eligible: false, reason: "archived" }
  if (product.liveChannelCount === 0) return { eligible: false, reason: "not_live" }
  return { eligible: true }
}

export const INELIGIBLE_MESSAGES: Record<Ineligibility, string> = {
  archived: "Archived, so it can't appear on your profile. Your choice is kept.",
  not_live:
    "Not live in a connected shop right now, so it can't appear on your profile. Your choice is kept for when it is.",
}

/**
 * One product the builder may arrange, reduced to what the screen shows.
 * Nothing here is private beyond what the creator already sees in their own
 * catalog, and nothing identifies another workspace.
 */
export interface ProductCandidate {
  id: string
  title: string
  typeLabel: string
  /** A members-only image route, or null for a product with no ready image. */
  imageUrl: string | null
  eligibility: Eligibility
  /**
   * The product's existing position on the public profile, if it already has
   * a public page. Seeds the first arrangement so the builder starts from what
   * is live rather than from catalog order.
   */
  existingOrder: number | null
}

export interface ArrangementRow {
  product: ProductCandidate
  visible: boolean
}

/**
 * The rows the screen shows, from the stored draft and the workspace's current
 * products.
 *
 *   - A draft that has never been arranged (no entries) starts with every
 *     eligible product shown: products already on the public profile first, in
 *     their existing order, then the rest in catalog order.
 *   - An arranged draft keeps its order. Eligible products it has never seen —
 *     created or taken live since — are appended hidden, because a product
 *     should not appear on a public page without the creator choosing it.
 *   - Ineligible products appear only if the draft already arranged them.
 *   - An entry whose product no longer exists in this workspace is dropped:
 *     there is nothing left to show or to preserve.
 */
export function arrange(
  draft: readonly DraftProduct[],
  candidates: readonly ProductCandidate[],
): ArrangementRow[] {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]))

  if (draft.length === 0) {
    const seeded = candidates
      .map((product, catalogIndex) => ({ product, catalogIndex }))
      .filter(({ product }) => product.eligibility.eligible)
      .sort((a, b) => {
        const ao = a.product.existingOrder
        const bo = b.product.existingOrder
        if (ao !== null && bo !== null && ao !== bo) return ao - bo
        if (ao !== null && bo === null) return -1
        if (ao === null && bo !== null) return 1
        return a.catalogIndex - b.catalogIndex
      })
    return seeded.map(({ product }) => ({ product, visible: true }))
  }

  const rows: ArrangementRow[] = []
  const seen = new Set<string>()
  for (const entry of draft) {
    const product = byId.get(entry.productId)
    if (!product || seen.has(product.id)) continue
    seen.add(product.id)
    rows.push({ product, visible: entry.visible })
  }
  for (const product of candidates) {
    if (seen.has(product.id) || !product.eligibility.eligible) continue
    rows.push({ product, visible: false })
  }
  return rows
}

/** Shown on the profile: eligible and switched on. */
export function isShown(row: ArrangementRow): boolean {
  return row.product.eligibility.eligible && row.visible
}

export function counts(rows: readonly ArrangementRow[]): { selected: number; selectable: number } {
  return {
    selected: rows.filter(isShown).length,
    selectable: rows.filter((row) => row.product.eligibility.eligible).length,
  }
}

/**
 * Flips one product. An ineligible product can be switched off but not on:
 * turning on something that cannot be shown would promise a card the profile
 * will not draw.
 */
export function toggleVisible(
  rows: readonly ArrangementRow[],
  productId: string,
): ArrangementRow[] {
  return rows.map((row) => {
    if (row.product.id !== productId) return row
    if (!row.visible && !row.product.eligibility.eligible) return row
    return { ...row, visible: !row.visible }
  })
}

/** Select or clear every eligible product. Ineligible entries keep their flag. */
export function setAllVisible(rows: readonly ArrangementRow[], visible: boolean): ArrangementRow[] {
  return rows.map((row) => (row.product.eligibility.eligible ? { ...row, visible } : row))
}

/** Moves one product to an index, clamped to the list. Returns the same array when nothing moves. */
export function moveTo(
  rows: readonly ArrangementRow[],
  productId: string,
  toIndex: number,
): readonly ArrangementRow[] {
  const from = rows.findIndex((row) => row.product.id === productId)
  if (from === -1) return rows
  const to = Math.max(0, Math.min(rows.length - 1, toIndex))
  if (to === from) return rows
  const next = rows.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved!)
  return next
}

export function moveBy(
  rows: readonly ArrangementRow[],
  productId: string,
  delta: number,
): readonly ArrangementRow[] {
  const from = rows.findIndex((row) => row.product.id === productId)
  return from === -1 ? rows : moveTo(rows, productId, from + delta)
}

/**
 * The keyboard alternative to dragging, as data: which move a key makes on a
 * focused drag handle. Null for keys that are not reordering keys, so the
 * caller leaves them alone (Tab must still move focus).
 */
export const REORDER_KEYS = ["ArrowUp", "ArrowDown", "Home", "End"] as const
export type ReorderKey = (typeof REORDER_KEYS)[number]

export function isReorderKey(key: string): key is ReorderKey {
  return (REORDER_KEYS as readonly string[]).includes(key)
}

export function moveForKey(
  rows: readonly ArrangementRow[],
  productId: string,
  key: ReorderKey,
): readonly ArrangementRow[] {
  switch (key) {
    case "ArrowUp":
      return moveBy(rows, productId, -1)
    case "ArrowDown":
      return moveBy(rows, productId, 1)
    case "Home":
      return moveTo(rows, productId, 0)
    case "End":
      return moveTo(rows, productId, rows.length - 1)
  }
}

/** What the draft stores. Order is the array order; there are no separate order numbers to drift. */
export function toDraftProducts(rows: readonly ArrangementRow[]): DraftProduct[] {
  return rows.map((row) => ({ productId: row.product.id, visible: row.visible }))
}

/** The preview's and publication's product list: shown rows, in order. */
export function toPresentationProducts(rows: readonly ArrangementRow[]): PresentationProduct[] {
  return rows.filter(isShown).map((row) => ({
    key: row.product.id,
    title: row.product.title,
    typeLabel: row.product.typeLabel,
    imageUrl: row.product.imageUrl,
    imageAlt: row.product.title,
  }))
}

/** Same products, same order, same flags. Used to make an unchanged save a no-op. */
export function sameArrangement(a: readonly DraftProduct[], b: readonly DraftProduct[]): boolean {
  return (
    a.length === b.length &&
    a.every((entry, i) => entry.productId === b[i]!.productId && entry.visible === b[i]!.visible)
  )
}

/**
 * Candidates from the workspace catalog plus the profile's existing public
 * pages. Pure, so eligibility filtering is tested without a database.
 */
export function candidatesFrom(
  catalog: ReadonlyArray<{
    product: {
      id: string
      name: string
      canonical_title: string | null
      product_type: string
      archived_at: string | null
    }
    liveChannelNames: readonly string[]
    thumbnail: { assetId: string } | null
  }>,
  pages: ReadonlyArray<{
    product_id: string
    title_override: string | null
    cover_asset_id: string | null
    display_order: number
  }>,
  options: { typeLabel: (productType: string) => string; imageUrl: (assetId: string) => string },
): ProductCandidate[] {
  const pageByProduct = new Map(pages.map((page) => [page.product_id, page]))
  return catalog.map(({ product, liveChannelNames, thumbnail }) => {
    const page = pageByProduct.get(product.id)
    const coverId = page?.cover_asset_id ?? thumbnail?.assetId ?? null
    return {
      id: product.id,
      title: page?.title_override ?? product.canonical_title ?? product.name,
      typeLabel: options.typeLabel(product.product_type),
      imageUrl: coverId ? options.imageUrl(coverId) : null,
      eligibility: eligibilityOf({
        archivedAt: product.archived_at,
        liveChannelCount: liveChannelNames.length,
      }),
      existingOrder: page ? page.display_order : null,
    }
  })
}
