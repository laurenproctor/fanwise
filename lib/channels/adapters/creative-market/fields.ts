import type { ProductType } from "@/lib/products/types"

/**
 * Creative Market's category and license schema, docs/channels/creative-market.md §4.
 *
 * Category is chosen first and decides everything: which license shape the
 * product is sold under and the floor under each price. Two shapes are
 * modelled. Standard tiers (Personal, Commercial, Extended Commercial) for
 * most categories; four license types priced separately for Fonts, and
 * priced differently again for a family than for a single weight. WordPress
 * themes take GPL 2.0 alone and are an info line, not a shape, because a
 * theme in Fanwise's coarse enum is not necessarily a WordPress one.
 *
 * Every figure here is from the published seller documentation or the
 * application form observed on 7 September 2026, and the ones the spec marks
 * [verify] are marked so here. A floor that is not published is null, and a
 * null floor is never checked: guessing one would block a listing on a
 * number nobody stated.
 */

export const CATEGORIES = [
  "Fonts",
  "Templates & Themes",
  "Graphics",
  "Photos",
  "Illustrations",
  "Icons",
  "Mockups",
  "Brushes & More",
  "3D",
] as const

export type Category = (typeof CATEGORIES)[number]
export const CATEGORY_LABELS: readonly string[] = CATEGORIES

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value)
}

const DEFAULT_CATEGORY_BY_PRODUCT_TYPE: Record<ProductType, Category | null> = {
  font: "Fonts",
  template: "Templates & Themes",
  graphic: "Graphics",
  photo: "Photos",
  illustration: "Illustrations",
  icon: "Icons",
  mockup: "Mockups",
  brush: "Brushes & More",
  three_d: "3D",
  theme: "Templates & Themes",
  other: null,
}

export function defaultCategory(productType: ProductType): Category | null {
  return DEFAULT_CATEGORY_BY_PRODUCT_TYPE[productType]
}

export type LicenseShape = "standard" | "font"

export function licenseShapeFor(category: Category): LicenseShape {
  return category === "Fonts" ? "font" : "standard"
}

export interface Tier {
  key: string
  label: string
  /** USD. Null where Creative Market publishes no floor. */
  floor: number | null
  verified: boolean
}

/**
 * The standard tiers and their floors per category, USD.
 *
 * Templates & Themes carries two rows in the published table, Templates and
 * Themes; the product type decides which applies. Illustrations, Icons and
 * Mockups have no published floor.
 */
const STANDARD_FLOORS: Record<
  string,
  { personal: number; commercial: number; extended: number } | null
> = {
  Templates: { personal: 9, commercial: 14, extended: 36 },
  Themes: { personal: 19, commercial: 29, extended: 76 },
  Graphics: { personal: 6, commercial: 9, extended: 24 },
  "Brushes & More": { personal: 9, commercial: 14, extended: 36 },
  Photos: { personal: 3, commercial: 4, extended: 5 },
  "3D": { personal: 19, commercial: 29, extended: 76 },
  Illustrations: null,
  Icons: null,
  Mockups: null,
}

export function standardTiers(category: Category, productType: ProductType): Tier[] {
  const row =
    category === "Templates & Themes"
      ? productType === "theme"
        ? "Themes"
        : "Templates"
      : category
  const floors = STANDARD_FLOORS[row] ?? null
  const verified = floors !== null
  return [
    { key: "personal", label: "Personal", floor: floors?.personal ?? null, verified },
    { key: "commercial", label: "Commercial", floor: floors?.commercial ?? null, verified },
    {
      key: "extended",
      label: "Extended Commercial",
      floor: floors?.extended ?? null,
      verified,
    },
  ]
}

/** Family or one weight: the font tiers are priced differently for each. */
export const FONT_LICENSE_SCOPES = [
  { value: "family", label: "Family", hint: "Every style in the package, priced together." },
  { value: "individual", label: "Individual weight", hint: "One style on its own." },
] as const
export type FontLicenseScope = (typeof FONT_LICENSE_SCOPES)[number]["value"]

export function isFontLicenseScope(value: unknown): value is FontLicenseScope {
  return FONT_LICENSE_SCOPES.some((scope) => scope.value === value)
}

/**
 * The font license types and the prices the application form showed for
 * each, docs/channels/creative-market.md §4. The spec's §13 item 13 has not
 * confirmed the shape from inside a live shop, so every row is unverified
 * and treated as a floor: a price under it is refused rather than sent.
 */
export function fontTiers(scope: FontLicenseScope): Tier[] {
  const family = scope === "family"
  return [
    { key: "desktop", label: "Desktop & Webfont", floor: family ? 15 : 12, verified: false },
    { key: "epub", label: "E-Pub", floor: family ? 23 : 18, verified: false },
    { key: "app", label: "App", floor: 72, verified: false },
  ]
}

/** The tier the listing's own price is: the first one on the form. */
export function baseTier(
  category: Category,
  productType: ProductType,
  scope: FontLicenseScope,
): Tier {
  return licenseShapeFor(category) === "font"
    ? fontTiers(scope)[0]!
    : standardTiers(category, productType)[0]!
}

/** Font formats Creative Market lists as installable; anything else is not a font there. */
export const INSTALLABLE_FONT_EXTENSIONS = ["otf", "ttf"] as const
/** Letter sets that are explicitly not fonts and must not go in the Fonts category. */
export const LETTER_SET_EXTENSIONS = ["eps", "ai"] as const
