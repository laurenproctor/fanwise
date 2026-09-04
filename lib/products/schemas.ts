import { z } from "zod"
import { SLUG_LIMITS } from "@/lib/slug"
import { assetTypeSchema, productTypeSchema } from "./types"

export const productNameSchema = z
  .string()
  .trim()
  .min(1, "Give the product a name.")
  .max(200, "Keep the name under 200 characters.")

export const productSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(SLUG_LIMITS.min, `Slugs are at least ${SLUG_LIMITS.min} characters.`)
  .max(64, "Slugs are at most 64 characters.")
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens.")

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === "" ? undefined : v))

const optionalUrl = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === "" ? undefined : v))
  .refine((v) => v === undefined || z.url().safeParse(v).success, "Enter a valid URL.")

export const createProductSchema = z.object({
  name: productNameSchema,
  productType: productTypeSchema,
})

export const updateProductSchema = z.object({
  name: productNameSchema,
  productType: productTypeSchema,
  canonicalTitle: optionalText(200),
  canonicalDescription: optionalText(8000),
  shortDescription: optionalText(500),
  brandName: optionalText(120),
  basePrice: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === "" || v === undefined ? undefined : Number(v)))
    .refine(
      (v) => v === undefined || (Number.isFinite(v) && v >= 0),
      "Enter a price of zero or more.",
    ),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a three-letter currency code.")
    .default("USD"),
  version: optionalText(40),
  supportUrl: optionalUrl,
  documentationUrl: optionalUrl,
  licenseSummary: optionalText(2000),
})

/**
 * What the browser may say about a file it is about to upload. All of it is a
 * hint: the finalize job measures the stored bytes and overwrites size and type
 * with what it actually found.
 */
export const uploadIntentSchema = z.object({
  productId: z.uuid(),
  assetType: assetTypeSchema,
  filename: z.string().trim().min(1).max(255),
  byteSize: z
    .number()
    .int()
    .min(1, "The file is empty.")
    .max(4 * 1024 * 1024 * 1024, "Files are limited to 4 GB."),
})

export type CreateProductInput = z.infer<typeof createProductSchema>
export type UpdateProductInput = z.infer<typeof updateProductSchema>
export type UploadIntentInput = z.infer<typeof uploadIntentSchema>
