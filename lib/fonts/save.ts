import { z } from "zod"
import { fontMetadataSchema, type FontMetadata } from "@/lib/products/metadata"
import { productNameSchema, productSlugSchema } from "@/lib/products/schemas"
import { RESERVED_PRODUCT_SLUGS } from "@/lib/slug"
import type { ProductPatch } from "./workspace"

/**
 * One autosave, validated and turned into a row update.
 *
 * A patch rather than the whole form, for two reasons. A field the creator did
 * not touch is not rewritten, so two sections saving close together cannot
 * undo each other. And the font metadata is merged key by key into what is
 * stored, so a correction to the style list cannot drop the glyph count that
 * was adopted a moment before.
 *
 * `null` clears a value; an absent key leaves it alone.
 */

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v))

/** Keys the metadata patch may carry. `kind` is not one of them. */
const FONT_KEYS = Object.keys(fontMetadataSchema.shape).filter((key) => key !== "kind")

export const productPatchSchema = z
  .object({
    name: productNameSchema.optional(),
    canonicalTitle: nullableText(200),
    slug: productSlugSchema
      .refine((slug) => !RESERVED_PRODUCT_SLUGS.has(slug), "That address is reserved. Try another.")
      .optional(),
    shortDescription: nullableText(500),
    canonicalDescription: nullableText(8000),
    brandName: nullableText(120),
    version: nullableText(40),
    basePrice: z
      .number()
      .min(0, "Enter a price of zero or more.")
      .max(1_000_000, "Enter a price under 1,000,000.")
      .nullable()
      .optional(),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, "Use a three-letter currency code.")
      .optional(),
    licenseSummary: nullableText(2000),
    font: z
      .record(z.string(), z.unknown())
      .refine((value) => Object.keys(value).every((key) => FONT_KEYS.includes(key)), {
        message: "That change is not one Fanwise recognises.",
      })
      .optional(),
  })
  .strict()

export type ParsedProductPatch = z.infer<typeof productPatchSchema>

/** The patch field a validation message belongs to, so the screen can point at it. */
export type PatchField = Exclude<keyof ProductPatch, "font"> | `font.${string}`

export type MergeResult =
  { ok: true; metadata: FontMetadata } | { ok: false; error: string; field: PatchField }

/**
 * Applies a metadata patch to what is stored, and validates the result whole.
 *
 * Validating the merged object rather than the patch alone is what catches a
 * patch that is valid on its own and wrong in context — a style list that is
 * fine, arriving at a product whose stored metadata has since been corrupted,
 * is still refused rather than written beside the corruption.
 */
export function mergeFontMetadata(
  stored: unknown,
  patch: Record<string, unknown> | undefined,
): MergeResult {
  const current = fontMetadataSchema.safeParse(stored)
  const base: Record<string, unknown> = current.success ? { ...current.data } : { kind: "font" }

  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === null) delete base[key]
    else base[key] = value
  }
  base.kind = "font"

  const parsed = fontMetadataSchema.safeParse(base)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const key = typeof issue?.path[0] === "string" ? issue.path[0] : "font"
    return {
      ok: false,
      error: "One of those details is not valid. Check it and try again.",
      field: `font.${key}`,
    }
  }
  return { ok: true, metadata: parsed.data }
}

/** Column names for the parts of a patch that live on the product row. */
export function patchColumns(patch: ParsedProductPatch) {
  const columns: Record<string, unknown> = {}
  if (patch.name !== undefined) columns.name = patch.name
  if (patch.canonicalTitle !== undefined) columns.canonical_title = patch.canonicalTitle
  if (patch.slug !== undefined) columns.slug = patch.slug
  if (patch.shortDescription !== undefined) columns.short_description = patch.shortDescription
  if (patch.canonicalDescription !== undefined) {
    columns.canonical_description = patch.canonicalDescription
  }
  if (patch.brandName !== undefined) columns.brand_name = patch.brandName
  if (patch.version !== undefined) columns.version = patch.version
  if (patch.basePrice !== undefined) columns.base_price = patch.basePrice
  if (patch.currency !== undefined) columns.currency = patch.currency
  if (patch.licenseSummary !== undefined) columns.license_summary = patch.licenseSummary
  return columns
}

/** Merges a newer patch over an older one, the way two queued autosaves combine. */
export function combinePatches(older: ProductPatch, newer: ProductPatch): ProductPatch {
  const combined: ProductPatch = { ...older, ...newer }
  if (older.font || newer.font) combined.font = { ...older.font, ...newer.font }
  return combined
}

export function isEmptyPatch(patch: ProductPatch): boolean {
  return Object.entries(patch).every(
    ([key, value]) =>
      value === undefined || (key === "font" && Object.keys(value as object).length === 0),
  )
}
