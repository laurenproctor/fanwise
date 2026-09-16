import type { ProductType } from "@/lib/products/types"

/**
 * Gumroad's taxonomy, the part of it a digital product lands in.
 *
 * `category` on a product is a path such as `design/fonts`, and Gumroad files
 * a product with no category under `other`, which keeps it out of Discover
 * browsing. So every product type has a default and the requirement offers
 * the labels so the creator can move a product between them.
 *
 * The paths come from the repository's development seed at commit 409faee
 * (docs/channels/gumroad.md §14). The ones marked verify were not read from
 * production and are settled by B10's exit run against `GET /v2/categories`;
 * a wrong path is refused by Gumroad with its sentence, never guessed around.
 */

export interface GumroadCategory {
  label: string
  /** The taxonomy path Gumroad takes as `category`. Null means leave it to Gumroad. */
  path: string | null
  verified: boolean
}

export const CATEGORIES: readonly GumroadCategory[] = [
  { label: "Fonts", path: "design/fonts", verified: true },
  { label: "Assets & Templates", path: "design/graphics/assets-and-templates", verified: true },
  { label: "Vector Graphics", path: "design/graphics/vector-graphics", verified: true },
  { label: "Mockups", path: "design/graphics/mockups", verified: true },
  { label: "Icons", path: "design/icons", verified: true },
  { label: "UI & Web", path: "design/ui-and-web", verified: true },
  { label: "3D Assets", path: "3d/3d-assets", verified: true },
  // The parent of the digital-illustration node was not read from the seed.
  { label: "Digital Illustration", path: "design/graphics/digital-illustration", verified: false },
  {
    label: "Illustration Brushes",
    path: "design/graphics/digital-illustration/illustration-brushes",
    verified: false,
  },
  // Gumroad's own fallback. Sent as no category at all.
  { label: "Other", path: null, verified: true },
]

export const CATEGORY_LABELS = CATEGORIES.map((c) => c.label)

const DEFAULT_BY_PRODUCT_TYPE: Record<ProductType, string> = {
  font: "Fonts",
  template: "Assets & Templates",
  graphic: "Vector Graphics",
  // Not read from the seed. A photo seller can move it; Other keeps it honest.
  photo: "Other",
  illustration: "Digital Illustration",
  icon: "Icons",
  mockup: "Mockups",
  brush: "Illustration Brushes",
  three_d: "3D Assets",
  theme: "UI & Web",
  other: "Other",
}

export function defaultCategoryLabel(productType: ProductType): string {
  return DEFAULT_BY_PRODUCT_TYPE[productType]
}

/**
 * The path for a label. `undefined` for a label this build does not know,
 * `null` for a known label that means "no category".
 */
export function categoryPath(label: string | null): string | null | undefined {
  if (!label) return undefined
  const found = CATEGORIES.find((c) => c.label === label.trim())
  return found ? found.path : undefined
}
