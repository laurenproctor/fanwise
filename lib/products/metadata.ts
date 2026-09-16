import { z } from "zod"
import { PRODUCT_TYPES } from "./types"

/**
 * Type-specific product facts.
 *
 * A discriminated union on product_type rather than a bag of optional columns,
 * so a font cannot claim a page count and a photo cannot claim a weight axis.
 * This is the raw material the FactSheet is derived from at B1, which is why it
 * is worth being strict about now.
 *
 * Deliberately shallow. Finer taxonomy (serif vs sans, print vs web) belongs
 * here rather than in the product_type enum, and a channel's own category tree
 * belongs to the adapter.
 */

/**
 * Classification is Fanwise's own word for what kind of type this is. A channel
 * that files fonts under its own tree maps from this in its adapter.
 */
export const FONT_CLASSIFICATIONS = [
  "sans_serif",
  "serif",
  "slab_serif",
  "display",
  "script",
  "handwritten",
  "monospace",
  "blackletter",
  "decorative",
] as const

/** The font file formats the model knows. A channel maps from these in its adapter. */
export const FONT_FORMATS = ["otf", "ttf", "woff", "woff2", "eot"] as const
export type FontFormat = (typeof FONT_FORMATS)[number]

export const FONT_LICENSE_KINDS = ["desktop", "web", "app", "epub"] as const
export type FontLicenseKind = (typeof FONT_LICENSE_KINDS)[number]

const shortText = z.string().trim().min(1).max(64)

/**
 * Search keywords for the product, entered once, on every kind of product.
 *
 * Not a channel field: each channel's listing keeps its own tags, and those
 * remain what it is sent. A listing with none of its own is offered these.
 */
const productTags = z.array(z.string().trim().min(1).max(40)).max(50).optional()

/**
 * One style of the family, as the creator stands behind it.
 *
 * Seeded from what the uploaded files say and then theirs to correct. `key` is
 * the PostScript name where a file had one, which is what ties a correction to
 * the files it describes across a re-upload of the same face.
 */
const fontStyle = z.object({
  key: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(120),
  weight: z.number().int().min(1).max(1000).optional(),
  width: z.number().int().min(1).max(9).optional(),
  italic: z.boolean().optional(),
})

const fontAxis = z.object({
  tag: z.string().trim().min(1).max(4),
  name: z.string().trim().max(64).optional(),
  min: z.number(),
  default: z.number(),
  max: z.number(),
})

/**
 * A licence type the creator sells, and its limits.
 *
 * Only the types they enable exist in the list, so an absent `app` means "not
 * sold" rather than "unanswered". Limits are optional because a creator may
 * sell an unlimited desktop licence; readiness asks for the one that a web
 * licence cannot sensibly go without.
 */
const fontLicense = z.object({
  kind: z.enum(FONT_LICENSE_KINDS),
  /** Price for this licence in the product's currency. Absent means the base price. */
  price: z.number().min(0).max(1_000_000).optional(),
  seats: z.number().int().min(1).max(1_000_000).optional(),
  monthlyPageviews: z.number().int().min(1).max(10_000_000_000).optional(),
  apps: z.number().int().min(1).max(10_000).optional(),
  terms: z.string().trim().max(2000).optional(),
})

const fontMetadata = z.object({
  kind: z.literal("font"),
  styleCount: z.number().int().min(1).max(500).optional(),
  isVariable: z.boolean().optional(),
  formats: z.array(z.enum(FONT_FORMATS)).optional(),
  languageSupport: z.array(z.string().min(2).max(64)).max(200).optional(),
  glyphCount: z.number().int().min(1).max(100_000).optional(),
  classification: z.enum(FONT_CLASSIFICATIONS).optional(),
  scripts: z.array(shortText).max(64).optional(),
  features: z.array(z.string().trim().min(1).max(4)).max(512).optional(),
  axes: z.array(fontAxis).max(64).optional(),
  styles: z.array(fontStyle).max(500).optional(),
  tags: productTags,
  licenses: z.array(fontLicense).max(FONT_LICENSE_KINDS.length).optional(),
  eulaUrl: z.url().max(2000).optional(),
})

export type FontMetadata = z.infer<typeof fontMetadata>
export type FontStyle = z.infer<typeof fontStyle>
export type FontLicense = z.infer<typeof fontLicense>
export type FontClassification = (typeof FONT_CLASSIFICATIONS)[number]
export const fontMetadataSchema = fontMetadata

const templateMetadata = z.object({
  kind: z.literal("template"),
  software: z.array(z.string().min(1).max(64)).max(20).optional(),
  pageCount: z.number().int().min(1).max(10_000).optional(),
  dimensions: z.string().min(1).max(64).optional(),
  tags: productTags,
})

const rasterMetadata = z.object({
  kind: z.literal("raster"),
  fileFormats: z.array(z.string().min(1).max(16)).max(20).optional(),
  dpi: z.number().int().min(1).max(2400).optional(),
  itemCount: z.number().int().min(1).max(100_000).optional(),
  tags: productTags,
})

const genericMetadata = z.object({
  kind: z.literal("generic"),
  notes: z.string().max(2000).optional(),
  tags: productTags,
})

export const productMetadataSchema = z.discriminatedUnion("kind", [
  fontMetadata,
  templateMetadata,
  rasterMetadata,
  genericMetadata,
])

export type ProductMetadata = z.infer<typeof productMetadataSchema>
export type MetadataKind = ProductMetadata["kind"]

/** Which metadata shape a product type uses. */
export const METADATA_KIND_BY_PRODUCT_TYPE = {
  font: "font",
  template: "template",
  theme: "template",
  graphic: "raster",
  photo: "raster",
  illustration: "raster",
  icon: "raster",
  mockup: "raster",
  brush: "raster",
  three_d: "generic",
  other: "generic",
} as const satisfies Record<(typeof PRODUCT_TYPES)[number], MetadataKind>

export function emptyMetadataFor(productType: (typeof PRODUCT_TYPES)[number]): ProductMetadata {
  return { kind: METADATA_KIND_BY_PRODUCT_TYPE[productType] } as ProductMetadata
}

/**
 * Parses stored jsonb. Unrecognised or legacy shapes degrade to generic rather
 * than throwing, because a product row must stay readable even if its metadata
 * predates a schema change.
 */
export function parseMetadata(value: unknown): ProductMetadata {
  const parsed = productMetadataSchema.safeParse(value)
  return parsed.success ? parsed.data : { kind: "generic" }
}
