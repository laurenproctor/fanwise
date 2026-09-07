/**
 * Shopify's product category, which is not the same field as `productType`.
 *
 * Two fields on a Shopify product look like a category and only one of them is:
 *
 *   productType   free text, no taxonomy, whatever the merchant types
 *   category      an id from Shopify's Standard Product Taxonomy, and the field
 *                 the admin labels "Category"
 *
 * Fanwise sent only the first, so every product it created arrived in Shopify
 * with the Category field empty. Category is what drives Shopify's own
 * attributes, its category-specific fields and its marketplace feeds, so an
 * empty one is not cosmetic.
 *
 * ## Why a table, and why this table
 *
 * docs/channels/shopify.md said a channel with a real taxonomy gets the table it
 * actually needs, and Shopify has one: roughly 14,000 categories, almost all of
 * them about physical objects. Offering a creator who sells fonts the whole tree
 * would be a worse experience than offering none of it, so this is the leaf set
 * a digital product can honestly sit in, and nothing else.
 *
 * The ids are hierarchical slugs rather than numbers and Shopify keeps them
 * stable across taxonomy releases. Every id here was checked against the
 * published `v2026-05` taxonomy, which is the release preceding the `2026-07`
 * Admin API version this adapter is pinned to, and against `unstable`.
 *
 * ## What is stored, and where
 *
 * `channel_listings.category` holds the **label**, not the id. The label is what
 * the creator picked, what the editor renders, and what a snapshot records; the
 * id is a Shopify implementation detail that has no business in a column shared
 * with every other channel. `taxonomyCategoryId` maps one to the other, and a
 * label that no longer maps returns null rather than guessing — an unrecognised
 * category is sent as no category, and the enum requirement says so in the UI.
 */

import type { Database } from "@/lib/supabase/database.types"

type FanwiseProductType = Database["public"]["Enums"]["product_type"]

/**
 * Label to taxonomy id.
 *
 * Labels are Shopify's own leaf names, so the word the creator picks in Fanwise
 * is the word they will see on the product in Shopify admin. The two exceptions
 * carry their parent, because Shopify's leaf name alone is ambiguous out of the
 * tree: "Digital Downloads" under Videos, and the Digital Goods parent itself.
 */
export const SHOPIFY_CATEGORIES: Readonly<Record<string, string>> = {
  // Software > Digital Goods & Currency, which is where most of this belongs.
  Fonts: "gid://shopify/TaxonomyCategory/so-2-5",
  "Digital Artwork": "gid://shopify/TaxonomyCategory/so-2-3",
  "Document Templates": "gid://shopify/TaxonomyCategory/so-2-4",
  "Stock Photographs & Video Footage": "gid://shopify/TaxonomyCategory/so-2-6",
  "Computer Icons": "gid://shopify/TaxonomyCategory/so-2-1",
  "Desktop Wallpapers": "gid://shopify/TaxonomyCategory/so-2-2",
  "SVG & Cut Files": "gid://shopify/TaxonomyCategory/so-2-8",
  "Photo Editing Presets & LUTs": "gid://shopify/TaxonomyCategory/so-2-9",
  "Digital Goods & Currency": "gid://shopify/TaxonomyCategory/so-2",

  // Media, for the things a creator sells that are not design assets.
  "E-Books": "gid://shopify/TaxonomyCategory/me-1-2",
  Printables: "gid://shopify/TaxonomyCategory/me-10",
  "Sheet Music": "gid://shopify/TaxonomyCategory/me-6",
  "Digital Music Downloads": "gid://shopify/TaxonomyCategory/me-3-1",
  "Video Digital Downloads": "gid://shopify/TaxonomyCategory/me-7-2",
  "Online Courses": "gid://shopify/TaxonomyCategory/me-9",

  // Software proper, for the two kinds that are software rather than an asset.
  "Web Design Software": "gid://shopify/TaxonomyCategory/so-1-10-10",
  "Digital Video Games": "gid://shopify/TaxonomyCategory/so-3-1",
}

/** Declaration order, which is the order the picker offers them in. */
export const CATEGORY_LABELS = Object.keys(SHOPIFY_CATEGORIES) as readonly string[]

/**
 * The label a Fanwise product type starts at.
 *
 * A default, not a decision. `buildListing` seeds the listing with it and the
 * creator overrides it in the editor, which is the same relationship every
 * other generated field has with the canonical record.
 *
 * Every member of the enum is named rather than defaulted through a fallback,
 * so adding a product type is a compile error here instead of a product that
 * quietly publishes as "Digital Goods & Currency".
 */
const BY_PRODUCT_TYPE: Readonly<Record<FanwiseProductType, string>> = {
  font: "Fonts",
  template: "Document Templates",
  graphic: "Digital Artwork",
  photo: "Stock Photographs & Video Footage",
  illustration: "Digital Artwork",
  icon: "Computer Icons",
  mockup: "Document Templates",
  brush: "Digital Artwork",
  three_d: "Digital Artwork",
  theme: "Web Design Software",
  other: "Digital Goods & Currency",
}

export function defaultCategoryLabel(productType: FanwiseProductType): string {
  return BY_PRODUCT_TYPE[productType]
}

/**
 * The taxonomy id for a stored label, or null when there is no such label.
 *
 * Null is sent as an omitted `category`, which leaves whatever Shopify already
 * holds untouched. That is deliberately not the same as clearing it: a label
 * this build does not recognise is a Fanwise problem, and resolving it by
 * wiping a category the creator set in Shopify admin would make a naming drift
 * into data loss.
 */
export function taxonomyCategoryId(label: string | null): string | null {
  if (!label) return null
  return SHOPIFY_CATEGORIES[label.trim()] ?? null
}
