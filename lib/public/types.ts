import type { Database } from "@/lib/supabase/database.types"

export type PublicProfileRow = Database["public"]["Tables"]["public_profiles"]["Row"]
export type PublicProductPageRow = Database["public"]["Tables"]["public_product_pages"]["Row"]
export type PublicPageStatus = Database["public"]["Enums"]["public_page_status"]
export type ProductType = Database["public"]["Enums"]["product_type"]

/**
 * A channel a visitor can actually buy through, reduced to what a public page
 * is allowed to know.
 *
 * The reduction is the point. A `channel_listings` row carries a connection id,
 * a status source, sync timestamps and a metadata blob; none of that is a
 * visitor's business and some of it names internal objects. This is the whole
 * of what crosses into the public layer, and the mapper that builds it names
 * every field, so a column added to `channel_listings` later cannot arrive here
 * by accident.
 */
export interface PublicDestination {
  /** The channel's registry key. Drives the brand mark and nothing else. */
  channelKey: string
  channelName: string
  /** Validated https at the boundary. Never rendered unvalidated. */
  url: string
  price: number | null
  currency: string
  /**
   * Opaque to the browser beyond being a link target: the click endpoint
   * re-derives everything from the page id and this key, server-side.
   */
  channelId: string
}

/** A card in a profile's catalog. */
export interface PublicProductCard {
  slug: string
  title: string
  productType: ProductType
  typeLabel: string
  summary: string | null
  coverAssetId: string | null
  coverAlt: string
  featured: boolean
  /** Null when nothing reliable is known. Never guessed, never zero-as-unknown. */
  startingPrice: { amount: number; currency: string } | null
  channelCount: number
}

export interface PublicProfileView {
  id: string
  handle: string
  displayName: string
  shortBio: string | null
  location: string | null
  hasAvatar: boolean
  websiteUrl: string | null
  instagramUrl: string | null
  contactUrl: string | null
  seoTitle: string | null
  seoDescription: string | null
  updatedAt: string
}

export interface PublicProductView {
  id: string
  slug: string
  profile: PublicProfileView
  title: string
  productType: ProductType
  typeLabel: string
  summary: string | null
  description: string | null
  /** Derived from the canonical product. Facts only; nothing invented here. */
  formats: string[]
  version: string | null
  licenseSummary: string | null
  includedItems: string[]
  brandName: string | null
  updatedAt: string
  galleryAssetIds: string[]
  coverAssetId: string | null
  startingPrice: { amount: number; currency: string } | null
  destinations: PublicDestination[]
  seoTitle: string | null
  seoDescription: string | null
}
