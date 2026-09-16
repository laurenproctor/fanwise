import { isCountryCode } from "@/lib/location/countries"
import { marketingRoutes } from "@/lib/routes"
import type { ProductType } from "./types"

/**
 * The creator directory at `/creators`: what its URL means, and the words it
 * uses. Pure, so the server page, the client controls and the tests all read
 * the same rules.
 *
 * The URL is the state. Search, filters, sort and page all live in the query
 * string, so a refresh, the back button, a shared link and a return from a
 * creator's profile all land on the same results. Nothing about the directory
 * is held anywhere else.
 */

export const DIRECTORY_SORTS = ["featured", "recent", "name"] as const
export type DirectorySort = (typeof DIRECTORY_SORTS)[number]

/**
 * Only orders the data can honestly back. There is no "popular" or "trending":
 * Fanwise has no engagement figure it could stand behind, and a sort named for
 * one would be ranking by something invented.
 */
export const SORT_LABELS: Record<DirectorySort, string> = {
  featured: "Featured",
  recent: "Recently published",
  name: "Name A–Z",
}

/** Plural, because a filter asks for a kind of work: "Fonts", not "Font". */
export const PRODUCT_TYPE_FILTER_LABELS: Record<ProductType, string> = {
  font: "Fonts",
  template: "Templates",
  graphic: "Graphics",
  photo: "Photos",
  illustration: "Illustrations",
  icon: "Icons",
  mockup: "Mockups",
  brush: "Brushes",
  three_d: "3D",
  theme: "Themes",
  other: "Other",
}

const PRODUCT_TYPES = Object.keys(PRODUCT_TYPE_FILTER_LABELS) as ProductType[]

export const MAX_QUERY_LENGTH = 80
const MAX_CITY_LENGTH = 120
/** Far past any real directory; a bound so a crafted URL cannot ask for page 10^9. */
const MAX_PAGE = 10_000

export interface DirectoryState {
  q: string
  productType: ProductType | null
  country: string | null
  city: string | null
  sort: DirectorySort
  page: number
}

export const DEFAULT_DIRECTORY_STATE: DirectoryState = {
  q: "",
  productType: null,
  country: null,
  city: null,
  sort: "featured",
  page: 1,
}

type RawParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ""
}

/** Whitespace collapsed and bounded. What a search box shows back. */
export function normalizeQuery(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH)
}

/**
 * Reads the query string. Anything unrecognised falls back to the default
 * rather than failing, because the URL is typed by people and pasted from
 * old links: `?sort=popular` is the Featured order, not an error page.
 */
export function parseDirectoryState(raw: RawParams | URLSearchParams): DirectoryState {
  const get = (key: string) =>
    raw instanceof URLSearchParams ? (raw.get(key) ?? "") : first(raw[key])

  const productType = get("productType")
  const country = get("country").toUpperCase()
  const city = get("city").replace(/\s+/g, " ").trim().slice(0, MAX_CITY_LENGTH)
  const sort = get("sort")
  const page = Number.parseInt(get("page"), 10)

  const validCountry = isCountryCode(country) ? country : null

  return {
    q: normalizeQuery(get("q")),
    productType: (PRODUCT_TYPES as string[]).includes(productType)
      ? (productType as ProductType)
      : null,
    country: validCountry,
    // A city means nothing without its country.
    city: validCountry && city.length > 0 ? city : null,
    sort: (DIRECTORY_SORTS as readonly string[]).includes(sort)
      ? (sort as DirectorySort)
      : "featured",
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, MAX_PAGE) : 1,
  }
}

/** Search or any filter. Sort and page are not filters: they reorder, they do not narrow. */
export function isFiltered(state: DirectoryState): boolean {
  return state.q.length > 0 || state.productType !== null || state.country !== null
}

/**
 * The address for a state. Defaults are omitted, so the plain directory is
 * `/creators` and never `/creators?sort=featured&page=1` — one page, one URL.
 * Keys are written in a fixed order so equal states produce equal strings.
 */
export function directoryHref(state: Partial<DirectoryState> = {}): string {
  const s = { ...DEFAULT_DIRECTORY_STATE, ...state }
  const params = new URLSearchParams()
  if (s.q) params.set("q", s.q)
  if (s.productType) params.set("productType", s.productType)
  if (s.country) {
    params.set("country", s.country)
    if (s.city) params.set("city", s.city)
  }
  if (s.sort !== "featured") params.set("sort", s.sort)
  if (s.page > 1) params.set("page", String(s.page))
  const query = params.toString()
  return query ? `${marketingRoutes.creators}?${query}` : marketingRoutes.creators
}

/** A change to what is being looked for starts again from the first page. */
export function withChange(state: DirectoryState, change: Partial<DirectoryState>): DirectoryState {
  const next = { ...state, ...change, page: change.page ?? 1 }
  if (
    change.country !== undefined &&
    change.country !== state.country &&
    change.city === undefined
  ) {
    next.city = null
  }
  if (!next.country) next.city = null
  return next
}

export type ActiveFilter = {
  key: "q" | "productType" | "country" | "city"
  label: string
  href: string
}

/**
 * The removable chips, in the order the controls sit. Removing one keeps every
 * other filter and the sort; removing a country takes its city with it,
 * because a city chip on its own would describe a filter that no longer runs.
 */
export function activeFilters(
  state: DirectoryState,
  names: { country: (code: string) => string | null },
): ActiveFilter[] {
  const out: ActiveFilter[] = []
  if (state.q) {
    out.push({ key: "q", label: `“${state.q}”`, href: directoryHref(withChange(state, { q: "" })) })
  }
  if (state.productType) {
    out.push({
      key: "productType",
      label: PRODUCT_TYPE_FILTER_LABELS[state.productType],
      href: directoryHref(withChange(state, { productType: null })),
    })
  }
  if (state.country) {
    out.push({
      key: "country",
      label: names.country(state.country) ?? state.country,
      href: directoryHref(withChange(state, { country: null })),
    })
  }
  if (state.country && state.city) {
    out.push({
      key: "city",
      label: state.city,
      href: directoryHref(withChange(state, { city: null })),
    })
  }
  return out
}

/**
 * Query words, for matching. Letters, digits, hyphens and apostrophes only:
 * every other character is either punctuation nobody searches for or syntax
 * in PostgREST's filter grammar, and a word is dropped rather than escaped.
 */
export function searchTokens(q: string): string[] {
  return normalizeQuery(q)
    .toLowerCase()
    .split(" ")
    .map((word) => word.replace(/[^\p{L}\p{N}'’-]/gu, "").replace(/’/g, "'"))
    .filter((word) => word.length > 0)
    .slice(0, 6)
}

/**
 * Words people use for a product type that the stored value does not contain.
 * "typefaces" is a search for fonts; `search_text` holds "font".
 */
const TYPE_SYNONYMS: Record<string, ProductType> = {
  typeface: "font",
  typefaces: "font",
  fonts: "font",
  templates: "template",
  graphics: "graphic",
  photos: "photo",
  photography: "photo",
  illustrations: "illustration",
  icons: "icon",
  mockups: "mockup",
  brushes: "brush",
  "3d": "three_d",
  themes: "theme",
}

export function productTypeForWord(word: string): ProductType | null {
  return TYPE_SYNONYMS[word] ?? null
}

/**
 * The explicit profile link: "View Mina’s profile", or "View profile".
 *
 * Fanwise does not know whether a display name belongs to a person or a
 * studio, so the possessive is used only where a name reads unmistakably as a
 * person's: two or three capitalised words, letters only, none of them a word
 * studios name themselves with. Anything else — "Northline Studio", "Field
 * Notes", "Forge", "A&B", "type.co" — gets the plain label. A wrong guess
 * ("View Field’s profile") is worse than the neutral form.
 */
const STUDIO_WORDS = new Set([
  "agency",
  "and",
  "assets",
  "atelier",
  "brand",
  "brands",
  "bureau",
  "club",
  "co",
  "collective",
  "company",
  "creative",
  "creatives",
  "design",
  "designs",
  "digital",
  "field",
  "fonts",
  "forge",
  "foundry",
  "goods",
  "group",
  "house",
  "inc",
  "kit",
  "kits",
  "lab",
  "labs",
  "llc",
  "ltd",
  "media",
  "notes",
  "office",
  "partners",
  "presets",
  "press",
  "shop",
  "store",
  "studio",
  "studios",
  "supply",
  "systems",
  "team",
  "templates",
  "the",
  "type",
  "works",
  "workshop",
])

export function profileLinkLabel(displayName: string): string {
  const words = displayName.trim().split(/\s+/)
  const personLike =
    words.length >= 2 &&
    words.length <= 3 &&
    words.every((word) => /^\p{Lu}[\p{Ll}'’-]*\p{Ll}$/u.test(word)) &&
    words.every((word) => !STUDIO_WORDS.has(word.toLowerCase()))
  return personLike ? `View ${words[0]}’s profile` : "View profile"
}

export function creatorCountLabel(count: number): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? "creator" : "creators"}`
}

export function productCountLabel(count: number): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? "product" : "products"}`
}
