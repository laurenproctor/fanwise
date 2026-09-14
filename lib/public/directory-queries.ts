import { cache } from "react"
import { z } from "zod"
import { COUNTRIES, countryName, foldForSearch, formatLocation } from "@/lib/location/countries"
import { PRODUCT_TYPE_LABELS } from "@/lib/products/types"
import { createPublicClient } from "@/lib/supabase/public"
import {
  PRODUCT_TYPE_FILTER_LABELS,
  directoryHref,
  isFiltered,
  parseDirectoryState,
  productTypeForWord,
  searchTokens,
  type DirectoryState,
} from "./directory"
import type { ProductType } from "./types"

/**
 * The directory's read path. Every query runs as `anon`, through the
 * cookie-less client, against views that are `security_invoker`
 * (20260914100000). So what can appear here is decided by the same RLS that
 * decides what `/@handle` may show: a published profile, published pages
 * beneath it, unarchived products. There is no status filter in this file to
 * forget, and no membership check, because nobody is signed in as far as
 * these queries know.
 *
 * Three bounded reads per page, however large the directory grows: one page of
 * creators with its count, their product types (for at most `PAGE_SIZE` + 3
 * creators), and the featured section. Representative products come inside the
 * creator row, capped at four by the view, so there is no query per creator.
 */

/** Divisible by four, three and two, so every breakpoint ends on a full row. */
export const DIRECTORY_PAGE_SIZE = 24
export const FEATURED_LIMIT = 3

export interface DirectoryPreview {
  slug: string
  title: string
  typeLabel: string
  /** A showable gallery image, or null for the ruled fallback panel. */
  coverAssetId: string | null
}

export interface DirectoryCreator {
  id: string
  handle: string
  displayName: string
  /** The creator's own introduction, used as the one-line statement. Never excerpted. */
  shortBio: string | null
  location: string | null
  hasAvatar: boolean
  /** Cache key for the avatar route, as the profile page uses it. */
  updatedAt: string
  productCount: number
  /** Plural labels, most published first, at most two. */
  primaryTypes: string[]
  previews: DirectoryPreview[]
}

export type DirectoryPage =
  | { kind: "page"; creators: DirectoryCreator[]; total: number; page: number; pageCount: number }
  /** A page number past the last page, from an old or edited link. */
  | { kind: "past-end"; page: number }

/**
 * Thrown in place of a PostgREST error. The page shows a calm message and the
 * log keeps the original, per the rule that raw provider errors are never
 * surfaced (CLAUDE.md, rule 8).
 */
export class DirectoryUnavailableError extends Error {
  constructor(cause: unknown) {
    super("The creator directory could not be loaded.", { cause })
    this.name = "DirectoryUnavailableError"
  }
}

function unavailable(where: string, error: unknown): never {
  console.error(`[public] creator directory: ${where}`, error)
  throw new DirectoryUnavailableError(error)
}

const COLUMNS =
  "id, handle, display_name, short_bio, city, country_code, location, has_avatar, updated_at, product_count, previews"

const productTypeSchema = z.enum(
  Object.keys(PRODUCT_TYPE_LABELS) as [ProductType, ...ProductType[]],
)

// The view's columns are all nullable as far as the generated types know,
// because Postgres reports every view column that way. They are not null in
// practice; a row that is anyway is dropped rather than rendered half-empty.
const rowSchema = z.object({
  id: z.string().uuid(),
  handle: z.string().min(1),
  display_name: z.string().min(1),
  short_bio: z.string().nullable(),
  city: z.string().nullable(),
  country_code: z.string().nullable(),
  location: z.string().nullable(),
  has_avatar: z.boolean(),
  updated_at: z.string(),
  product_count: z.number().int().positive(),
  previews: z
    .array(
      z.object({
        slug: z.string().min(1),
        title: z.string().min(1),
        productType: productTypeSchema,
        coverAssetId: z.string().uuid().nullable(),
      }),
    )
    .max(4),
})

type Row = z.infer<typeof rowSchema>

function parseRows(rows: unknown[] | null): Row[] {
  return (rows ?? []).flatMap((row) => {
    const parsed = rowSchema.safeParse(row)
    if (!parsed.success) {
      console.error("[public] creator directory: dropped a malformed row", parsed.error.issues)
      return []
    }
    return [parsed.data]
  })
}

async function primaryTypesFor(ids: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (ids.length === 0) return out

  const { data, error } = await createPublicClient()
    .from("public_creator_product_types")
    .select("public_profile_id, product_type, product_count")
    .in("public_profile_id", ids)
  if (error) unavailable("product types", error)

  const order = Object.keys(PRODUCT_TYPE_FILTER_LABELS)
  const grouped = new Map<string, Array<{ type: ProductType; count: number }>>()
  for (const row of data ?? []) {
    const type = productTypeSchema.safeParse(row.product_type)
    if (!row.public_profile_id || !type.success) continue
    const list = grouped.get(row.public_profile_id) ?? []
    list.push({ type: type.data, count: row.product_count ?? 0 })
    grouped.set(row.public_profile_id, list)
  }
  for (const [id, list] of grouped) {
    list.sort((a, b) => b.count - a.count || order.indexOf(a.type) - order.indexOf(b.type))
    out.set(
      id,
      list.slice(0, 2).map((entry) => PRODUCT_TYPE_FILTER_LABELS[entry.type]),
    )
  }
  return out
}

async function toCreators(rows: Row[]): Promise<DirectoryCreator[]> {
  const types = await primaryTypesFor(rows.map((row) => row.id))
  return rows.map((row) => ({
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    shortBio: row.short_bio?.trim() ? row.short_bio.trim() : null,
    location: formatLocation({
      city: row.city,
      countryCode: row.country_code,
      legacy: row.location,
    }),
    hasAvatar: row.has_avatar,
    updatedAt: row.updated_at,
    productCount: row.product_count,
    primaryTypes: types.get(row.id) ?? [],
    previews: row.previews.map((preview) => ({
      slug: preview.slug,
      title: preview.title,
      typeLabel: PRODUCT_TYPE_LABELS[preview.productType],
      coverAssetId: preview.coverAssetId,
    })),
  }))
}

/**
 * Country codes whose name a search word could mean. The view has codes, not
 * names — the names live in lib/location — so "canada" becomes `CA` here.
 * Three letters at least, or "us" would match every country with "us" in it.
 */
export function countryCodesForWord(word: string): string[] {
  const folded = foldForSearch(word)
  if (folded.length < 3) return []
  return COUNTRIES.filter((country) =>
    foldForSearch(country.name)
      .split(" ")
      .some((part) => part.startsWith(folded)),
  )
    .slice(0, 12)
    .map((country) => country.code)
}

/**
 * The PostgREST `or` clause for one search word. Every word must match
 * somewhere (the clauses are ANDed together); each word may match the public
 * text, a product type it names, or a country it names.
 *
 * Safe to interpolate because `searchTokens` has already reduced the word to
 * letters, digits, hyphens and apostrophes, none of which is filter syntax.
 */
export function searchClause(word: string): string {
  const clauses = [`search_text.ilike.*${word}*`]
  const type = productTypeForWord(word)
  if (type) clauses.push(`product_types.cs.{${type}}`)
  const codes = countryCodesForWord(word)
  if (codes.length > 0) clauses.push(`country_code.in.(${codes.join(",")})`)
  return clauses.join(",")
}

/** The featured section: editorially ranked, and still only public creators. */
export const loadFeaturedCreators = cache(async (): Promise<DirectoryCreator[]> => {
  const { data, error } = await createPublicClient()
    .from("public_creator_directory")
    .select(COLUMNS)
    .not("featured_rank", "is", null)
    .order("featured_rank", { ascending: true })
    .limit(FEATURED_LIMIT)
  if (error) unavailable("featured creators", error)
  return toCreators(parseRows(data))
})

/**
 * One page of the directory.
 *
 * Keyed by the canonical href so React's per-request `cache` can share the
 * result between the count in the results line and the grid below it.
 *
 * In the unfiltered view the creators already shown in Featured are left out
 * of the grid beneath them — on every page, so pagination stays stable — and
 * added back into the count, so "128 creators" still means every public
 * creator. A search or filter hides Featured and lists everyone who matches.
 */
export const loadDirectoryPage = cache(async (href: string): Promise<DirectoryPage> => {
  const state = parseDirectoryState(new URL(href, "https://fanwise.invalid").searchParams)
  const featured = isFiltered(state) ? [] : await loadFeaturedCreators()
  const excluded = featured.map((creator) => creator.id)

  let query = createPublicClient()
    .from("public_creator_directory")
    .select(COLUMNS, { count: "exact" })

  for (const word of searchTokens(state.q)) query = query.or(searchClause(word))
  if (state.productType) query = query.contains("product_types", [state.productType])
  if (state.country) query = query.eq("country_code", state.country)
  if (state.country && state.city) query = query.eq("city", state.city)
  if (excluded.length > 0) query = query.not("id", "in", `(${excluded.join(",")})`)

  // Every order ends on the handle, which is unique, so no two creators ever
  // tie and a creator cannot move between pages from one request to the next.
  switch (state.sort) {
    case "recent":
      query = query.order("latest_published_at", { ascending: false })
      break
    case "name":
      query = query.order("sort_name", { ascending: true })
      break
    case "featured":
      query = query
        .order("featured_rank", { ascending: true, nullsFirst: false })
        .order("latest_published_at", { ascending: false })
      break
  }
  query = query.order("handle", { ascending: true })

  const from = (state.page - 1) * DIRECTORY_PAGE_SIZE
  const { data, error, count } = await query.range(from, from + DIRECTORY_PAGE_SIZE - 1)

  // PGRST103: the range starts past the last row. Not a failure, an old link.
  if (error?.code === "PGRST103") return { kind: "past-end", page: state.page }
  if (error) unavailable("directory page", error)

  const matched = count ?? 0
  if (matched > 0 && (data ?? []).length === 0 && state.page > 1) {
    return { kind: "past-end", page: state.page }
  }

  return {
    kind: "page",
    creators: await toCreators(parseRows(data)),
    total: matched + excluded.length,
    page: state.page,
    pageCount: Math.max(1, Math.ceil(matched / DIRECTORY_PAGE_SIZE)),
  }
})

/** The React cache key for a state. */
export function directoryKey(state: DirectoryState): string {
  return directoryHref(state)
}

export interface DirectoryFacets {
  countries: Array<{ code: string; name: string }>
  /** Cities per country code, alphabetical. */
  cities: Record<string, string[]>
}

/**
 * The places public creators are in, for the Country and City menus. Only
 * places someone is actually in, so a menu never offers a filter that returns
 * nobody. A failure here is not the page's failure: the menus go empty and
 * search still works.
 */
export async function loadDirectoryFacets(): Promise<DirectoryFacets> {
  const { data, error } = await createPublicClient()
    .from("public_creator_locations")
    .select("country_code, city")
    .limit(2000)
  if (error) {
    console.error("[public] creator directory: locations", error)
    return { countries: [], cities: {} }
  }

  const cities: Record<string, Set<string>> = {}
  for (const row of data ?? []) {
    if (!row.country_code || !countryName(row.country_code)) continue
    cities[row.country_code] ??= new Set()
    if (row.city?.trim()) cities[row.country_code]!.add(row.city.trim())
  }

  return {
    countries: Object.keys(cities)
      .map((code) => ({ code, name: countryName(code)! }))
      .sort((a, b) => a.name.localeCompare(b.name, "en")),
    cities: Object.fromEntries(
      Object.entries(cities).map(([code, set]) => [
        code,
        [...set].sort((a, b) => a.localeCompare(b, "en")),
      ]),
    ),
  }
}
