import { z } from "zod"
import { PRODUCT_TYPES } from "@/lib/products/types"

/**
 * What a model may propose from evidence, and in what shape.
 *
 * Every value arrives wrapped: the value itself, how sure the model was, and
 * which pieces of the page it is pointing at. The wrapper is not decoration.
 * `provenance` on the screen is decided by where a value came from, and a bare
 * string from a model is indistinguishable from a string the page stated —
 * which is exactly the confusion architecture invariant 5 exists to prevent.
 *
 * **Nothing here is applied to the canonical product by this module.** A
 * suggestion lands in `product_imports.suggestions` and stays there until a
 * person accepts it on the review screen. `claims.ts` runs first and refuses a
 * draft that asserts things appearance cannot establish.
 *
 * `DRAFT_SCHEMA_VERSION` is written to the row beside `prompt_version`, so a
 * draft composed months ago can be read with the schema it was composed
 * against rather than the one that happens to be current.
 */

export const DRAFT_SCHEMA_VERSION = "2026-09-12.1"

/** One proposed value, with what the model thought and what it read. */
function suggested<T extends z.ZodType>(inner: T) {
  return z.object({
    value: inner,
    /**
     * The model's own estimate, 0 to 1. Shown as a word, never as a number:
     * "0.82" reads as a measurement and it is a feeling.
     */
    confidence: z.number().min(0).max(1),
    /**
     * The snippets of evidence this rests on. Quoted from the page, so a
     * creator can check a suggestion against what was actually read rather
     * than against the model's account of it.
     */
    evidence: z.array(z.string().trim().max(300)).max(4),
  })
}

export const priceGuidanceSchema = z.object({
  /**
   * Null whenever the page did not state a price. A number here that the
   * evidence does not contain is a price Fanwise invented for somebody's
   * product, which is the single worst thing this feature could do quietly.
   */
  amount: z.number().nonnegative().max(100_000).nullable(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .default("USD"),
  /** Why. Plain words, and allowed to say that there is nothing to go on. */
  rationale: z.string().trim().max(600),
})

export const draftOutputSchema = z.object({
  title: suggested(z.string().trim().min(1).max(200)),
  shortDescription: suggested(z.string().trim().max(500)),
  longDescription: suggested(z.string().trim().max(8000)),
  /** The canonical enum, never a new member. A taxonomy is not a model's to extend. */
  productType: suggested(z.enum(PRODUCT_TYPES)),
  features: suggested(z.array(z.string().trim().min(1).max(200)).max(12)),
  useCases: suggested(z.array(z.string().trim().min(1).max(200)).max(8)),
  audience: suggested(z.string().trim().max(300)),
  tags: suggested(
    z
      .array(z.string().trim().min(1).max(60))
      .max(15)
      .transform((tags) => {
        const seen = new Set<string>()
        return tags.filter((tag) => {
          const key = tag.toLowerCase()
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
      }),
  ),
  technicalRequirements: suggested(z.array(z.string().trim().min(1).max(200)).max(8)),
  priceGuidance: suggested(priceGuidanceSchema),
  /**
   * What the page did not say that a listing usually needs.
   *
   * The most useful field on the screen and the cheapest to produce: it turns
   * "the description is thin" into "nobody said what file formats a buyer
   * gets". Shown to the creator as a checklist of gaps; never shown as model
   * reasoning, and the prompt asks for gaps rather than for an explanation.
   */
  missingInformation: z.array(z.string().trim().min(1).max(200)).max(10),
})

export type DraftOutput = z.infer<typeof draftOutputSchema>
export type DraftField = keyof Omit<DraftOutput, "missingInformation">

export const DRAFT_FIELDS = [
  "title",
  "shortDescription",
  "longDescription",
  "productType",
  "features",
  "useCases",
  "audience",
  "tags",
  "technicalRequirements",
  "priceGuidance",
] as const satisfies readonly DraftField[]

/**
 * The same shape as a JSON Schema, for the provider to constrain the answer to.
 *
 * Written by hand beside the Zod schema rather than derived, exactly as
 * `lib/ai/output.ts` does and for the same reasons: a derivation pulls a schema
 * dialect the provider may not accept, and a unit test that parses a
 * schema-shaped answer with the Zod schema is what keeps the two agreeing.
 */
function suggestedJson(value: Record<string, unknown>, description: string) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["value", "confidence", "evidence"],
    properties: {
      value: { ...value, description },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      evidence: {
        type: "array",
        maxItems: 4,
        items: { type: "string" },
        description: "Short quotations from the page that support this value. Empty if none do.",
      },
    },
  }
}

const stringArray = (maxItems: number) => ({ type: "array", maxItems, items: { type: "string" } })

export const DRAFT_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [...DRAFT_FIELDS, "missingInformation"],
  properties: {
    title: suggestedJson({ type: "string" }, "A product name. Prefer the page's own wording."),
    shortDescription: suggestedJson({ type: "string" }, "One or two sentences."),
    longDescription: suggestedJson(
      { type: "string" },
      "Plain text, paragraphs separated by blank lines. No markdown, no links, no emoji.",
    ),
    productType: suggestedJson(
      { type: "string", enum: [...PRODUCT_TYPES] },
      "The closest member of the list. Use other when nothing fits.",
    ),
    features: suggestedJson(stringArray(12), "Things the page shows the product doing."),
    useCases: suggestedJson(stringArray(8), "What somebody would use it for."),
    audience: suggestedJson({ type: "string" }, "Who it appears to be for."),
    tags: suggestedJson(stringArray(15), "Lowercase keywords."),
    technicalRequirements: suggestedJson(
      stringArray(8),
      "Only requirements the page itself states. Empty array if it states none.",
    ),
    priceGuidance: suggestedJson(
      {
        type: "object",
        additionalProperties: false,
        required: ["amount", "currency", "rationale"],
        properties: {
          amount: { type: ["number", "null"] },
          currency: { type: "string" },
          rationale: { type: "string" },
        },
      },
      "amount must be null unless the page states a price.",
    ),
    missingInformation: {
      ...stringArray(10),
      description: "What a listing needs that the page did not say.",
    },
  },
}
