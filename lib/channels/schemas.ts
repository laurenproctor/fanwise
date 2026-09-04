import { z } from "zod"

/**
 * What the editor may submit.
 *
 * Deliberately permissive about channel rules: this schema decides whether the
 * payload is *storable*, not whether it is *publishable*. A creator must be able
 * to save a title that is forty characters too long for a marketplace, see the
 * requirement fail, and come back to it. Refusing the save would make readiness
 * unreachable, because the only way to see what is wrong would be to have
 * already fixed it.
 *
 * The hard bounds here are the database's, not the channel's.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v))

/**
 * Tags arrive as one comma-separated string from the form. Splitting here keeps
 * the parsing in one place rather than in the component and the action both.
 */
export const tagsSchema = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? "")
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0),
  )
  .refine((tags) => tags.length <= 100, "That is more tags than any channel accepts.")
  .refine(
    (tags) => tags.every((tag) => tag.length <= 120),
    "One of those tags is unreasonably long.",
  )
  .transform((tags) => {
    // Duplicates are always a mistake and every marketplace rejects or silently
    // collapses them, so they are removed here rather than reported.
    const seen = new Set<string>()
    return tags.filter((tag) => {
      const key = tag.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  })

export const updateListingSchema = z.object({
  title: optionalText(500),
  description: optionalText(20000),
  shortDescription: optionalText(2000),
  category: optionalText(200),
  price: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : Number(v)))
    .refine(
      (v) => v === null || (Number.isFinite(v) && v >= 0),
      "Enter a price of zero or more, or leave it empty.",
    ),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a three-letter currency code.")
    .default("USD"),
  tags: tagsSchema,
})

export type UpdateListingInput = z.infer<typeof updateListingSchema>
