import { z } from "zod"

/**
 * What a generation must produce.
 *
 * The six text fields of a listing and nothing else. Price, currency and
 * category are deliberately absent: a price is a decision the creator made,
 * and a category on a channel with a taxonomy is a mapping the adapter owns.
 * The model writes; it does not decide.
 *
 * Bounds here are the database's, as in lib/channels/schemas.ts. Whether the
 * copy fits the channel is the requirement engine's question, asked on read,
 * and a composed listing that runs long shows up in readiness exactly as a
 * hand-written one would.
 */
export const listingOutputSchema = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().min(1).max(20000),
  shortDescription: z.string().trim().max(2000),
  seoTitle: z.string().trim().max(500),
  seoDescription: z.string().trim().max(2000),
  tags: z
    .array(z.string().trim().min(1).max(120))
    .max(100)
    .transform((tags) => {
      const seen = new Set<string>()
      return tags.filter((tag) => {
        const key = tag.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    }),
})

export type ListingOutput = z.infer<typeof listingOutputSchema>

/**
 * The same shape as a JSON Schema for the provider to constrain the answer to.
 *
 * Written by hand beside the Zod schema rather than derived from it. The two
 * are six fields long, a derivation would pull a schema dialect the provider
 * may not accept, and the unit test that parses a schema-shaped answer with
 * the Zod schema is what keeps them agreeing.
 */
export const LISTING_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description", "shortDescription", "seoTitle", "seoDescription", "tags"],
  properties: {
    title: { type: "string", description: "The listing title." },
    description: { type: "string", description: "The full description, plain text." },
    shortDescription: {
      type: "string",
      description: "A one or two sentence summary. Empty string if the channel has no use for one.",
    },
    seoTitle: {
      type: "string",
      description: "Search-result title. Empty string to fall back to the title.",
    },
    seoDescription: {
      type: "string",
      description: "Search-result description. Empty string to fall back to the short description.",
    },
    tags: { type: "array", items: { type: "string" }, description: "Lowercase tags." },
  },
}

/**
 * The fields a generation may target one at a time. Step B2.
 *
 * The keys of the listing output, not the column names: a field generation is
 * read back into the same shape as a whole one, and the runner is the only
 * thing that knows which column a key lands in.
 */
export const LISTING_FIELDS = [
  "title",
  "description",
  "shortDescription",
  "seoTitle",
  "seoDescription",
  "tags",
] as const satisfies readonly (keyof ListingOutput)[]

export type ListingField = (typeof LISTING_FIELDS)[number]

export const listingFieldSchema = z.enum(LISTING_FIELDS)

export const LISTING_FIELD_LABELS: Record<ListingField, string> = {
  title: "Title",
  description: "Description",
  shortDescription: "Short description",
  seoTitle: "Meta title",
  seoDescription: "Meta description",
  tags: "Tags",
}

/**
 * What a single-field generation must produce: the one value, under the key
 * the whole-listing output uses for it, so the same validator runs unchanged
 * on a listing that holds only that field.
 */
export function fieldOutputSchema(field: ListingField) {
  return listingOutputSchema.pick({ [field]: true } as Record<ListingField, true>)
}

export function fieldOutputJsonSchema(field: ListingField): Record<string, unknown> {
  const properties = LISTING_OUTPUT_JSON_SCHEMA.properties as Record<string, unknown>
  return {
    type: "object",
    additionalProperties: false,
    required: [field],
    properties: { [field]: properties[field] },
  }
}

/** A whole-listing shape holding only one field, for the validator. */
export function onlyField(field: ListingField, value: string | string[]): ListingOutput {
  return {
    title: "",
    description: "",
    shortDescription: "",
    seoTitle: "",
    seoDescription: "",
    tags: [],
    [field]: value,
  } as ListingOutput
}
