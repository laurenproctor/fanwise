import { z } from "zod"
import { HANDLE_LIMITS, PUBLIC_SLUG_LIMITS, checkHandle, checkPublicSlug } from "./handles"

/**
 * What the management forms may submit.
 *
 * The handle and slug schemas delegate to `./handles` rather than restating
 * the rules, so there is one place that decides what a public address may be
 * and one place whose message a creator reads. A second regex here would
 * eventually disagree with that one, and the disagreement would surface as a
 * field that validates in the browser and is refused by the database.
 */

export const handleSchema = z.string().superRefine((value, ctx) => {
  const checked = checkHandle(value)
  if (!checked.ok) {
    ctx.addIssue({ code: "custom", message: checked.message })
  }
})

export const publicSlugSchema = z.string().superRefine((value, ctx) => {
  const checked = checkPublicSlug(value)
  if (!checked.ok) {
    ctx.addIssue({ code: "custom", message: checked.message })
  }
})

/**
 * An optional text field, where a cleared input means "unset" rather than an
 * empty string.
 *
 * The distinction matters at the database: `location` carries a CHECK that a
 * present value is between 1 and 80 characters, so an empty string is a
 * constraint violation where null is simply no location. A form posts `""`
 * for a field somebody emptied, and this is where that becomes null.
 */
function optionalText(max: number, message: string) {
  return z
    .string()
    .trim()
    .max(max, message)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
}

/**
 * A link field. Empty means none; anything else must be a plain https URL.
 *
 * Validated here as well as by `safeExternalUrl` at render and by a CHECK in
 * the database. Three layers sounds like two too many until you notice they
 * answer different questions: this one tells a creator their typo is a typo
 * while they can still fix it, the render-time one protects a visitor from a
 * row written before this schema existed, and the constraint protects both
 * from anything that is not the application.
 */
const httpsUrl = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? null : v))
  .nullable()
  .superRefine((value, ctx) => {
    if (value === null) return
    if (!/^https:\/\/[^\s<>"]+$/.test(value)) {
      ctx.addIssue({ code: "custom", message: "Use a full https:// address." })
    }
  })

const instagramUrl = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? null : v))
  .nullable()
  .superRefine((value, ctx) => {
    if (value === null) return
    if (!/^https:\/\/([a-z0-9-]+\.)*instagram\.com\/[^\s<>"]*$/.test(value)) {
      ctx.addIssue({ code: "custom", message: "Use a full https://instagram.com/ address." })
    }
  })

const contactUrl = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? null : v))
  .nullable()
  .superRefine((value, ctx) => {
    if (value === null) return
    const ok = /^https:\/\/[^\s<>"]+$/.test(value) || /^mailto:[^\s<>"@]+@[^\s<>"@]+$/.test(value)
    if (!ok) {
      ctx.addIssue({
        code: "custom",
        message: "Use a full https:// address or a mailto: address.",
      })
    }
  })

export const publicProfileSchema = z.object({
  handle: handleSchema,
  displayName: z
    .string()
    .trim()
    .min(1, "Give the public profile a name.")
    .max(80, "Keep the name under 80 characters."),
  shortBio: optionalText(280, "Keep the bio under 280 characters."),
  location: optionalText(80, "Keep the location under 80 characters."),
  websiteUrl: httpsUrl,
  instagramUrl,
  contactUrl,
  seoTitle: optionalText(70, "Search titles are cut off past 70 characters."),
  seoDescription: optionalText(200, "Search descriptions are cut off past 200 characters."),
})

export const publicProductPageSchema = z.object({
  slug: publicSlugSchema,
  titleOverride: optionalText(200, "Keep the title under 200 characters."),
  summaryOverride: optionalText(300, "Keep the summary under 300 characters."),
  descriptionOverride: optionalText(4000, "Keep the description under 4000 characters."),
  coverAssetId: z
    .string()
    .trim()
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .refine(
      (v) => v === null || /^[0-9a-f-]{36}$/i.test(v),
      "Choose one of this product's own images.",
    ),
  seoTitle: optionalText(70, "Search titles are cut off past 70 characters."),
  seoDescription: optionalText(200, "Search descriptions are cut off past 200 characters."),
})

export type PublicProfileInput = z.infer<typeof publicProfileSchema>
export type PublicProductPageInput = z.infer<typeof publicProductPageSchema>

export { HANDLE_LIMITS, PUBLIC_SLUG_LIMITS }
