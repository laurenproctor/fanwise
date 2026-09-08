import type { ProductType } from "@/lib/products/types"

/**
 * Etsy's seller taxonomy, the part of it a digital product lands in.
 *
 * Read from the live taxonomy on 8 September 2026 with the app's keystring:
 * 3,065 nodes, of which these are the ones a font, template, graphic, photo,
 * illustration, icon, mockup, brush, 3D or theme seller uses. There is no
 * node named Fonts anywhere in the tree, which is why fonts default to
 * Graphic Design, where the marketplace's own font sellers list.
 *
 * `taxonomy_id` is required on every listing, so every product type has a
 * default, and the requirement engine offers the labels as an enum so the
 * creator can move a product between them. Ids are Etsy's and stable; labels
 * are the node names. **[verify]** whether Etsy accepts a non-leaf id such as
 * Graphic Design (it has three children) or insists on a leaf.
 */

export interface EtsyCategory {
  label: string
  taxonomyId: number
  /** The path in Etsy's own tree, for the creator's orientation. */
  path: string
}

export const CATEGORIES: readonly EtsyCategory[] = [
  {
    label: "Graphic Design",
    taxonomyId: 1875,
    path: "Paper & Party Supplies > Paper > Stationery > Design & Templates > Graphic Design",
  },
  {
    label: "Logos & Branding",
    taxonomyId: 1877,
    path: "Paper & Party Supplies > Paper > Stationery > Design & Templates > Graphic Design > Logos & Branding",
  },
  {
    label: "Store Graphics",
    taxonomyId: 769,
    path: "Paper & Party Supplies > Paper > Stationery > Design & Templates > Graphic Design > Store Graphics",
  },
  {
    label: "Templates",
    taxonomyId: 1874,
    path: "Paper & Party Supplies > Paper > Stationery > Design & Templates > Templates",
  },
  {
    label: "Social Media Templates",
    taxonomyId: 12486,
    path: "Paper & Party Supplies > Paper > Stationery > Design & Templates > Templates > Social Media Templates",
  },
  {
    label: "Website Templates",
    taxonomyId: 2818,
    path: "Paper & Party Supplies > Paper > Stationery > Design & Templates > Templates > Website Templates",
  },
  {
    label: "Clip Art & Image Files",
    taxonomyId: 6844,
    path: "Craft Supplies & Tools > Canvas & Surfaces > Stencils, Templates & Transfers > Clip Art & Image Files",
  },
  {
    label: "Digital Prints",
    taxonomyId: 2078,
    path: "Art & Collectibles > Prints > Digital Prints",
  },
  {
    label: "Digital Drawing & Illustration",
    taxonomyId: 77,
    path: "Art & Collectibles > Drawing & Illustration > Digital",
  },
  {
    label: "3D Printer Files",
    taxonomyId: 12380,
    path: "Craft Supplies & Tools > Patterns & How To > Craft Machine Files > 3D Printer Files",
  },
]

export const CATEGORY_LABELS = CATEGORIES.map((c) => c.label)

const DEFAULT_BY_PRODUCT_TYPE: Record<ProductType, string> = {
  font: "Graphic Design",
  template: "Templates",
  theme: "Website Templates",
  graphic: "Clip Art & Image Files",
  photo: "Digital Prints",
  illustration: "Digital Drawing & Illustration",
  icon: "Clip Art & Image Files",
  mockup: "Clip Art & Image Files",
  brush: "Clip Art & Image Files",
  three_d: "3D Printer Files",
  other: "Graphic Design",
}

export function defaultCategoryLabel(productType: ProductType): string {
  return DEFAULT_BY_PRODUCT_TYPE[productType]
}

/** The taxonomy id for a label, or null for one this build does not know. */
export function taxonomyId(label: string | null): number | null {
  if (!label) return null
  return CATEGORIES.find((c) => c.label === label.trim())?.taxonomyId ?? null
}
