import { pluralTypeLabel } from "@/lib/products/types"
import type { PresentationProduct } from "./profile-presentation"

/**
 * Search, filter and sort for the products on a public profile.
 *
 * Pure, and run in the visitor's browser: a profile's catalog is tens of
 * products and every one of them is already on the page, so narrowing it is a
 * question of which cards to draw, not a query. The state lives in the address
 * (`?q=`, `?type=`, `?sort=`) so a link to "this studio's fonts" is a link a
 * creator can paste anywhere, and the server reads the same parameters to draw
 * the first paint already narrowed.
 *
 * Nothing here can hide a product a visitor could otherwise reach. Every
 * filter is a view over the published cards the page was handed.
 */

export const SORTS = ["featured", "newest", "price-asc", "price-desc", "name"] as const
export type ProductSort = (typeof SORTS)[number]

export const SORT_LABELS: Record<ProductSort, string> = {
  // The creator's own arrangement from the builder. The default, because the
  // order is a choice they made on purpose.
  featured: "Featured",
  newest: "Newest",
  "price-asc": "Price: low to high",
  "price-desc": "Price: high to low",
  name: "Name: A to Z",
}

export interface BrowseState {
  query: string
  /** A stored product type ("font"), or "all". */
  type: string
  sort: ProductSort
}

export const DEFAULT_BROWSE: BrowseState = { query: "", type: "all", sort: "featured" }

/** Search and sort appear once there is enough on the page to look through. */
export const SEARCH_THRESHOLD = 4

/**
 * Reads the address. Anything unrecognised falls back to the default rather
 * than failing: these parameters arrive from links strangers typed.
 */
export function parseBrowse(params: {
  q?: string | string[]
  type?: string | string[]
  sort?: string | string[]
}): BrowseState {
  const first = (value: string | string[] | undefined) =>
    (Array.isArray(value) ? value[0] : value) ?? ""
  const query = first(params.q).slice(0, 100)
  const type = first(params.type).trim().toLowerCase()
  const sort = first(params.sort)
  return {
    query,
    type: /^[a-z0-9_]{1,40}$/.test(type) ? type : "all",
    sort: (SORTS as readonly string[]).includes(sort) ? (sort as ProductSort) : "featured",
  }
}

/** The address for a state: only what differs from the default, so the plain profile stays `/@handle`. */
export function browseSearch(state: BrowseState): string {
  const params = new URLSearchParams()
  if (state.query.trim() !== "") params.set("q", state.query.trim())
  if (state.type !== "all") params.set("type", state.type)
  if (state.sort !== "featured") params.set("sort", state.sort)
  const search = params.toString()
  return search === "" ? "" : `?${search}`
}

/** The kinds on the page, with how many of each, in the order they first appear. */
export function typeCounts(
  products: readonly PresentationProduct[],
): Array<{ type: string; label: string; count: number }> {
  const counts = new Map<string, number>()
  for (const product of products) {
    counts.set(product.productType, (counts.get(product.productType) ?? 0) + 1)
  }
  return [...counts].map(([type, count]) => ({ type, label: pluralTypeLabel(type), count }))
}

/**
 * The products to draw, in the order to draw them.
 *
 * A `type` naming a kind the page does not have shows everything rather than
 * nothing: a shared link to a category the creator has since emptied should
 * land on their work, not on an empty grid.
 */
export function browseProducts(
  products: readonly PresentationProduct[],
  state: BrowseState,
): PresentationProduct[] {
  const hasType = products.some((product) => product.productType === state.type)
  const needles = fold(state.query).split(/\s+/).filter(Boolean)

  const shown = products.filter((product) => {
    if (hasType && product.productType !== state.type) return false
    if (needles.length === 0) return true
    const haystack = fold(
      [
        product.title,
        product.typeLabel,
        pluralTypeLabel(product.productType),
        product.summary ?? "",
      ].join(" "),
    )
    // Every word has to appear somewhere, in any order: "serif display" finds
    // "Display Serif".
    return needles.every((needle) => haystack.includes(needle))
  })

  return sortProducts(shown, state.sort)
}

function sortProducts(products: PresentationProduct[], sort: ProductSort): PresentationProduct[] {
  // Array.prototype.sort is stable, so ties keep the creator's order.
  const sorted = [...products]
  switch (sort) {
    case "featured":
      return sorted
    case "name":
      return sorted.sort((a, b) =>
        a.title.localeCompare(b.title, "en", { sensitivity: "base", numeric: true }),
      )
    case "newest":
      return sorted.sort((a, b) => time(b.publishedAt) - time(a.publishedAt))
    case "price-asc":
    case "price-desc": {
      const direction = sort === "price-asc" ? 1 : -1
      return sorted.sort((a, b) => {
        const pa = a.startingPrice?.amount
        const pb = b.startingPrice?.amount
        // A product with no known price goes last either way: it is not
        // cheapest and not dearest, it is unknown.
        if (pa === undefined && pb === undefined) return 0
        if (pa === undefined) return 1
        if (pb === undefined) return -1
        return (pa - pb) * direction
      })
    }
  }
}

function time(iso: string | null | undefined): number {
  const value = iso ? Date.parse(iso) : Number.NaN
  return Number.isNaN(value) ? 0 : value
}

/** Lower case, accents off, so "cafe" finds "Café". */
function fold(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
}
