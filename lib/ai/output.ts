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
