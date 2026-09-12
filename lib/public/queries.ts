import { createPublicClient } from "@/lib/supabase/public"
import { PRODUCT_TYPE_LABELS, type ProductType } from "@/lib/products/types"
import { parseMetadata } from "@/lib/products/metadata"
import { findAdapter } from "@/lib/channels/registry"
import { canonicalHandle } from "./handles"
import { safeExternalUrl } from "./urls"
import type {
  PublicDestination,
  PublicProductCard,
  PublicProductView,
  PublicProfileView,
} from "./types"

/**
 * The public read path. Every query here runs as `anon`.
 *
 * There is no membership check anywhere in this file and there should never be
 * one. The client is cookie-less (lib/supabase/public.ts), so these queries
 * cannot see a draft even when the person holding the browser owns it, and RLS
 * — not a `where status = 'published'` somebody could forget — is what decides
 * that. The status filters that do appear are belt and braces, and are marked
 * where they are.
 *
 * Columns are always named. `select *` would fail anyway, because `anon` holds
 * column-level grants rather than table-level ones on the canonical tables, and
 * that is the design: the query and the database agree on the column list, and
 * disagreeing is an error rather than a leak.
 */

/**
 * What resolving an address can produce.
 *
 * `redirect` is the case worth naming: a handle or slug that used to be live
 * still resolves, to a permanent redirect at its current address. A link
 * printed in somebody's portfolio outlives a rename.
 */
export type Resolution<T> =
  { kind: "found"; value: T } | { kind: "redirect"; to: string } | { kind: "missing" }

const PROFILE_COLUMNS =
  "id, handle, display_name, short_bio, location, avatar_path, website_url, instagram_url, contact_url, seo_title, seo_description, updated_at"

const PAGE_COLUMNS =
  "id, slug, product_id, featured, display_order, title_override, summary_override, description_override, cover_asset_id, seo_title, seo_description, published_at, updated_at"

function toProfileView(row: {
  id: string
  handle: string
  display_name: string
  short_bio: string | null
  location: string | null
  avatar_path: string | null
  website_url: string | null
  instagram_url: string | null
  contact_url: string | null
  seo_title: string | null
  seo_description: string | null
  updated_at: string
}): PublicProfileView {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    shortBio: row.short_bio,
    location: row.location,
    // The path itself never crosses into a view. A page asks the media route
    // for the image; it does not learn where the object lives.
    hasAvatar: row.avatar_path !== null,
    websiteUrl: safeExternalUrl(row.website_url),
    instagramUrl: safeExternalUrl(row.instagram_url),
    contactUrl: safeExternalUrl(row.contact_url, { allowMailto: true }),
    seoTitle: row.seo_title,
    seoDescription: row.seo_description,
    updatedAt: row.updated_at,
  }
}

/**
 * Resolves `/@<handle>` to a profile, a redirect, or nothing.
 *
 * The two lookups are ordered and not combined. A live handle is the common
 * case and costs one indexed read; history is consulted only when that misses,
 * so the price of supporting renames is paid by the requests that need it.
 */
export async function resolveProfile(rawHandle: string): Promise<Resolution<PublicProfileView>> {
  const handle = canonicalHandle(rawHandle)
  if (handle.length === 0) return { kind: "missing" }

  const supabase = createPublicClient()

  const { data: profile } = await supabase
    .from("public_profiles")
    .select(PROFILE_COLUMNS)
    .eq("handle", handle)
    .maybeSingle()

  if (profile) return { kind: "found", value: toProfileView(profile) }

  // A handle this profile used to answer to. The join is on the history row's
  // own profile, and the profile SELECT is RLS-filtered to published, so a
  // retired handle belonging to an unpublished profile resolves to nothing
  // rather than to a redirect that would then 404.
  const { data: historic } = await supabase
    .from("public_handle_history")
    .select("public_profiles!inner(handle, status)")
    .eq("handle", handle)
    .maybeSingle()

  const current = historic?.public_profiles
  if (current && current.status === "published") {
    return { kind: "redirect", to: current.handle }
  }

  return { kind: "missing" }
}

/**
 * The catalog behind a profile page.
 *
 * One query for the pages, one for the products they point at, one for the
 * images, one for the live listings. Four round trips rather than a single
 * embedded select, because PostgREST embedding on a column-granted table
 * expands to the whole relation and is refused; naming the columns per table
 * is both what the grant requires and what makes the exposure legible.
 */
export async function loadProfileCatalog(profileId: string): Promise<PublicProductCard[]> {
  const supabase = createPublicClient()

  const { data: pages } = await supabase
    .from("public_product_pages")
    .select(PAGE_COLUMNS)
    .eq("public_profile_id", profileId)
    // RLS already restricts this to published pages under a published profile.
    // Stated anyway: a reader of this function should not have to open a
    // migration to know what it returns.
    .eq("status", "published")
    .order("featured", { ascending: false })
    .order("display_order", { ascending: true })
    .order("published_at", { ascending: false })

  if (!pages || pages.length === 0) return []

  const productIds = pages.map((p) => p.product_id)

  const [{ data: products }, { data: assets }, { data: listings }] = await Promise.all([
    supabase
      .from("products")
      .select(
        "id, name, product_type, canonical_title, short_description, base_price, currency, updated_at",
      )
      .in("id", productIds),
    supabase
      .from("product_assets")
      .select("id, product_id, asset_type, sort_order")
      .in("product_id", productIds),
    supabase
      .from("channel_listings")
      .select("id, product_id, channel_id, price, currency")
      .in("product_id", productIds),
  ])

  const productById = new Map((products ?? []).map((p) => [p.id, p]))
  const assetsByProduct = groupBy(assets ?? [], (a) => a.product_id)
  const listingsByProduct = groupBy(listings ?? [], (l) => l.product_id)

  return pages.flatMap((page) => {
    const product = productById.get(page.product_id)
    // A page whose product did not come back is a page RLS declined to show,
    // which can only mean the two disagree. Dropping the card is the honest
    // outcome; rendering a placeholder would invent a product.
    if (!product) return []

    const productListings = listingsByProduct.get(page.product_id) ?? []
    const title = page.title_override ?? product.canonical_title ?? product.name

    return [
      {
        slug: page.slug,
        title,
        productType: product.product_type,
        typeLabel: PRODUCT_TYPE_LABELS[product.product_type as ProductType],
        summary: page.summary_override ?? product.short_description,
        coverAssetId: page.cover_asset_id ?? pickCover(assetsByProduct.get(page.product_id) ?? []),
        coverAlt: title,
        featured: page.featured,
        startingPrice: startingPrice(product, productListings),
        channelCount: productListings.length,
      },
    ]
  })
}

/** Resolves `/@<handle>/<slug>` within an already-resolved profile. */
export async function resolveProductPage(
  profile: PublicProfileView,
  rawSlug: string,
): Promise<Resolution<PublicProductView>> {
  const slug = canonicalHandle(rawSlug)
  if (slug.length === 0) return { kind: "missing" }

  const supabase = createPublicClient()

  const { data: page } = await supabase
    .from("public_product_pages")
    .select(PAGE_COLUMNS)
    .eq("public_profile_id", profile.id)
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle()

  if (!page) {
    const { data: historic } = await supabase
      .from("public_product_slug_history")
      .select("public_product_pages!inner(slug, status)")
      .eq("public_profile_id", profile.id)
      .eq("slug", slug)
      .maybeSingle()

    const current = historic?.public_product_pages
    if (current && current.status === "published") {
      return { kind: "redirect", to: current.slug }
    }
    return { kind: "missing" }
  }

  const [{ data: product }, { data: assets }, { data: listings }] = await Promise.all([
    supabase
      .from("products")
      .select(
        "id, name, product_type, canonical_title, canonical_description, short_description, brand_name, base_price, currency, version, license_summary, metadata, updated_at",
      )
      .eq("id", page.product_id)
      .maybeSingle(),
    supabase
      .from("product_assets")
      .select("id, product_id, asset_type, sort_order, mime_type")
      .eq("product_id", page.product_id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("channel_listings")
      .select("id, product_id, channel_id, external_url, price, currency")
      .eq("product_id", page.product_id),
  ])

  if (!product) return { kind: "missing" }

  const gallery = (assets ?? []).filter(
    (a) => GALLERY_TYPES.has(a.asset_type) && a.mime_type?.startsWith("image/"),
  )

  const destinations = await loadDestinations(listings ?? [])
  const title = page.title_override ?? product.canonical_title ?? product.name
  const metadata = parseMetadata(product.metadata)

  return {
    kind: "found",
    value: {
      id: page.id,
      slug: page.slug,
      profile,
      title,
      productType: product.product_type,
      typeLabel: PRODUCT_TYPE_LABELS[product.product_type as ProductType],
      summary: page.summary_override ?? product.short_description,
      description: page.description_override ?? product.canonical_description,
      formats: formatsFrom(metadata),
      version: product.version,
      licenseSummary: product.license_summary,
      includedItems: includedFrom(metadata),
      brandName: product.brand_name,
      updatedAt: page.published_at ?? product.updated_at,
      galleryAssetIds: gallery.map((a) => a.id),
      coverAssetId: page.cover_asset_id ?? gallery[0]?.id ?? null,
      startingPrice: startingPrice(product, listings ?? []),
      destinations,
      seoTitle: page.seo_title,
      seoDescription: page.seo_description,
    },
  }
}

/**
 * Turns listing rows into destinations a visitor can be sent to.
 *
 * Two filters that are not negotiable. The URL goes through `safeExternalUrl`,
 * so a stored value that is not plain https never reaches an `href`. And the
 * channel has to be one the registry knows: a listing whose channel key has no
 * adapter is a row from a channel this build does not support, and offering it
 * would be a link Fanwise cannot stand behind.
 */
async function loadDestinations(
  listings: Array<{
    id: string
    channel_id: string
    external_url: string | null
    price: number | null
    currency: string
  }>,
): Promise<PublicDestination[]> {
  if (listings.length === 0) return []

  const supabase = createPublicClient()
  const { data: channels } = await supabase
    .from("channels")
    .select("id, key, name")
    .in("id", [...new Set(listings.map((l) => l.channel_id))])

  const channelById = new Map((channels ?? []).map((c) => [c.id, c]))

  return listings
    .flatMap((listing) => {
      const channel = channelById.get(listing.channel_id)
      if (!channel) return []
      if (!findAdapter(channel.key)) return []

      const url = safeExternalUrl(listing.external_url)
      if (!url) return []

      return [
        {
          channelKey: channel.key,
          channelName: channel.name,
          url,
          price: listing.price,
          currency: listing.currency,
          channelId: channel.id,
        },
      ]
    })
    .sort((a, b) => {
      // Cheapest first, because "From $48" above the list promises that the
      // first row is where that number came from. Unpriced rows sink rather
      // than sorting as zero.
      if (a.price === null && b.price === null) return a.channelName.localeCompare(b.channelName)
      if (a.price === null) return 1
      if (b.price === null) return -1
      return a.price - b.price
    })
}

/** Image asset types a public gallery may show. Deliverables are never shown. */
const GALLERY_TYPES = new Set([
  "cover_image",
  "preview_image",
  "specimen",
  "screenshot",
  "promotional",
])

function pickCover(assets: Array<{ id: string; asset_type: string; sort_order: number | null }>) {
  const gallery = assets
    .filter((a) => GALLERY_TYPES.has(a.asset_type))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  return gallery[0]?.id ?? null
}

/**
 * The "From $X" figure, or nothing.
 *
 * Nothing is a real answer and the reason it exists. A price on a public page
 * is a promise, and the lowest live listing is the only number Fanwise can
 * stand behind: it is what a visitor will actually be charged if they follow
 * the cheapest link on the page. The product's own `base_price` is the
 * creator's intention, used only when no channel has quoted one, and when
 * neither exists the page says nothing rather than `$0`.
 *
 * Mixed currencies are not compared. Comparing 40 GBP against 45 USD by their
 * numbers would silently pick the wrong one, so the majority currency wins and
 * the others are ignored for this figure alone; every channel still shows its
 * own price on its own row.
 */
function startingPrice(
  product: { base_price: number | null; currency: string },
  listings: Array<{ price: number | null; currency: string }>,
): { amount: number; currency: string } | null {
  const priced = listings.filter(
    (l): l is { price: number; currency: string } => typeof l.price === "number" && l.price > 0,
  )

  if (priced.length > 0) {
    const currency = dominantCurrency(priced.map((l) => l.currency))
    const inCurrency = priced.filter((l) => l.currency === currency)
    return { amount: Math.min(...inCurrency.map((l) => l.price)), currency }
  }

  if (typeof product.base_price === "number" && product.base_price > 0) {
    return { amount: product.base_price, currency: product.currency }
  }

  return null
}

function dominantCurrency(currencies: string[]): string {
  const counts = new Map<string, number>()
  for (const c of currencies) counts.set(c, (counts.get(c) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0]
}

/**
 * File formats, taken from the product's own metadata and nowhere else.
 *
 * Invariant 5's rule about AI applies with equal force to a template: a public
 * page may not state a fact the record does not hold. An empty list renders as
 * an absent row, never as "various".
 */
function formatsFrom(metadata: ReturnType<typeof parseMetadata>): string[] {
  switch (metadata.kind) {
    case "font":
      return (metadata.formats ?? []).map((f) => f.toUpperCase())
    case "raster":
      return (metadata.fileFormats ?? []).map((f) => f.toUpperCase())
    case "template":
      return metadata.software ?? []
    default:
      return []
  }
}

/** What's included, again only where the record actually says. */
function includedFrom(metadata: ReturnType<typeof parseMetadata>): string[] {
  const out: string[] = []
  switch (metadata.kind) {
    case "font":
      if (metadata.styleCount) out.push(plural(metadata.styleCount, "style"))
      if (metadata.isVariable) out.push("Variable font")
      if (metadata.glyphCount) out.push(`${metadata.glyphCount.toLocaleString()} glyphs`)
      if (metadata.languageSupport?.length) {
        out.push(plural(metadata.languageSupport.length, "language"))
      }
      break
    case "template":
      if (metadata.pageCount) out.push(plural(metadata.pageCount, "page"))
      if (metadata.dimensions) out.push(metadata.dimensions)
      break
    case "raster":
      if (metadata.itemCount) out.push(plural(metadata.itemCount, "item"))
      if (metadata.dpi) out.push(`${metadata.dpi} DPI`)
      break
    default:
      break
  }
  return out
}

function plural(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>()
  for (const item of items) {
    const k = key(item)
    const bucket = out.get(k)
    if (bucket) bucket.push(item)
    else out.set(k, [item])
  }
  return out
}

/**
 * Every published page, for the sitemap.
 *
 * Drafts cannot appear because this runs as `anon` like everything else here,
 * so "exclude drafts from the sitemap" is not a filter anyone has to remember.
 */
export async function listPublishedForSitemap(): Promise<
  Array<{ handle: string; updatedAt: string; products: Array<{ slug: string; updatedAt: string }> }>
> {
  const supabase = createPublicClient()

  const { data: profiles } = await supabase
    .from("public_profiles")
    .select("id, handle, updated_at")
    .order("handle")

  if (!profiles || profiles.length === 0) return []

  const { data: pages } = await supabase
    .from("public_product_pages")
    .select("public_profile_id, slug, updated_at")
    .in(
      "public_profile_id",
      profiles.map((p) => p.id),
    )

  const byProfile = groupBy(pages ?? [], (p) => p.public_profile_id)

  return profiles.map((profile) => ({
    handle: profile.handle,
    updatedAt: profile.updated_at,
    products: (byProfile.get(profile.id) ?? []).map((p) => ({
      slug: p.slug,
      updatedAt: p.updated_at,
    })),
  }))
}
