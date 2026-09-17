import type { ProductType } from "@/lib/products/types"

/**
 * Behance's own taxonomy, the two tables docs/channels/behance.md §9 says
 * live here and never in the product enum.
 *
 * A project carries at least one Creative Field, from a list Behance fixes;
 * an asset carries one category, from a dropdown whose five names are not
 * published. Both are read from the marketplace's public pages rather than
 * from inside the seller's editor, which is decision 26's open item: the
 * field list is the subset the marketplace surfaces for digital products, and
 * the categories are the navigation's, marked unverified until a profile with
 * an asset attached settles them (§13 items 1 and 2). A wrong name here costs
 * a creator one dropdown correction on Behance's form; the handoff shows the
 * value as a suggestion to pick, never as a fact about the form.
 */

export interface CreativeField {
  label: string
  verified: boolean
}

/** Creative Fields the marketplace surfaces for the kinds of thing Fanwise sells. */
export const CREATIVE_FIELDS: readonly CreativeField[] = [
  { label: "Graphic Design", verified: true },
  { label: "Illustration", verified: true },
  { label: "Typography", verified: true },
  { label: "Type Design", verified: true },
  { label: "Icon Design", verified: true },
  { label: "Product Design", verified: true },
  { label: "3D Modeling", verified: true },
  { label: "Photography", verified: true },
  { label: "Branding", verified: true },
  { label: "Editorial Design", verified: false },
  { label: "Digital Art", verified: false },
  { label: "Pattern Design", verified: false },
  { label: "Web Design", verified: false },
  { label: "UI/UX", verified: false },
  { label: "Motion Graphics", verified: false },
  { label: "Lettering", verified: false },
  { label: "Packaging", verified: false },
]

export const CREATIVE_FIELD_LABELS = CREATIVE_FIELDS.map((f) => f.label)

const DEFAULT_FIELDS_BY_PRODUCT_TYPE: Record<ProductType, readonly string[]> = {
  font: ["Typography", "Type Design"],
  template: ["Graphic Design", "Editorial Design"],
  graphic: ["Graphic Design", "Illustration"],
  photo: ["Photography"],
  illustration: ["Illustration"],
  icon: ["Icon Design", "Graphic Design"],
  mockup: ["Graphic Design", "Branding"],
  brush: ["Digital Art", "Illustration"],
  three_d: ["3D Modeling"],
  theme: ["Web Design", "UI/UX"],
  other: ["Graphic Design"],
}

export function defaultCreativeFields(productType: ProductType): string[] {
  return [...DEFAULT_FIELDS_BY_PRODUCT_TYPE[productType]]
}

export function isCreativeField(label: string): boolean {
  return CREATIVE_FIELD_LABELS.includes(label)
}

export interface AssetCategory {
  label: string
  verified: boolean
}

/**
 * The asset form's category dropdown. Five options per the seller help
 * center; these five are the marketplace navigation's, and §13 item 1 is the
 * question of whether they are the dropdown's.
 */
export const ASSET_CATEGORIES: readonly AssetCategory[] = [
  { label: "Fonts", verified: false },
  { label: "Templates", verified: false },
  { label: "Illustrations", verified: false },
  { label: "Icons", verified: false },
  { label: "Mockups", verified: false },
]

export const ASSET_CATEGORY_LABELS = ASSET_CATEGORIES.map((c) => c.label)

const DEFAULT_CATEGORY_BY_PRODUCT_TYPE: Record<ProductType, string | null> = {
  font: "Fonts",
  template: "Templates",
  graphic: "Illustrations",
  // Not one of the five the navigation shows. The creator picks on the form.
  photo: null,
  illustration: "Illustrations",
  icon: "Icons",
  mockup: "Mockups",
  brush: "Illustrations",
  three_d: null,
  theme: "Templates",
  other: null,
}

export function defaultAssetCategory(productType: ProductType): string | null {
  return DEFAULT_CATEGORY_BY_PRODUCT_TYPE[productType]
}

/**
 * The two licenses Behance fixes per asset, docs/channels/behance.md §12.
 *
 * There is no extended tier and no per-category schema, which is why the
 * mapping is a recommendation rather than a table: a product whose own license
 * summary grants less than Standard Commercial must not be recommended it.
 */
export const LICENSE_TYPES = [
  {
    value: "personal",
    label: "Personal",
    hint: "Non-exclusive use in personal, non-commercial projects.",
  },
  {
    value: "standard_commercial",
    label: "Standard Commercial",
    hint: "Personal use plus up to 5,000 physical products, 5,000 print or advertising uses, and unlimited web, app and social use. Excludes broadcast and streaming.",
  },
] as const

export type LicenseType = (typeof LICENSE_TYPES)[number]["value"]

export function isLicenseType(value: unknown): value is LicenseType {
  return LICENSE_TYPES.some((license) => license.value === value)
}

export function licenseLabel(value: LicenseType): string {
  return LICENSE_TYPES.find((license) => license.value === value)!.label
}

/**
 * What to recommend from the product's own license summary.
 *
 * A summary that speaks of personal, non-commercial or no-commercial use is
 * one Standard Commercial would overstate. Anything else, including no
 * summary, recommends Standard Commercial and says so as a recommendation.
 */
export function recommendedLicense(licenseSummary: string | null): LicenseType {
  const text = (licenseSummary ?? "").toLowerCase()
  if (/non-?commercial|personal use only|not for commercial/.test(text)) return "personal"
  return "standard_commercial"
}
