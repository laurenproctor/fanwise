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

const fontMetadata = z.object({
  kind: z.literal("font"),
  styleCount: z.number().int().min(1).max(500).optional(),
  isVariable: z.boolean().optional(),
  formats: z.array(z.enum(["otf", "ttf", "woff", "woff2", "eot"])).optional(),
  languageSupport: z.array(z.string().min(2).max(64)).max(200).optional(),
  glyphCount: z.number().int().min(1).max(100_000).optional(),
})

const templateMetadata = z.object({
  kind: z.literal("template"),
  software: z.array(z.string().min(1).max(64)).max(20).optional(),
  pageCount: z.number().int().min(1).max(10_000).optional(),
  dimensions: z.string().min(1).max(64).optional(),
})

const rasterMetadata = z.object({
  kind: z.literal("raster"),
  fileFormats: z.array(z.string().min(1).max(16)).max(20).optional(),
  dpi: z.number().int().min(1).max(2400).optional(),
  itemCount: z.number().int().min(1).max(100_000).optional(),
})

const genericMetadata = z.object({
  kind: z.literal("generic"),
  notes: z.string().max(2000).optional(),
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
