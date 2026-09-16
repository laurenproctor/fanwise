import { z } from "zod"
import { FONT_CLASSIFICATIONS, FONT_FORMATS } from "@/lib/products/metadata"
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

export const DRAFT_SCHEMA_VERSION = "2026-09-16.1"

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

const shortText = z.string().trim().min(1).max(64)
const count = (max: number) => z.number().int().min(1).max(max).nullable()

/**
 * The structured details a source states, in the product model's own terms.
 *
 * One flat shape for every product type, because the model chooses the type
 * in the same answer and cannot be handed a schema that depends on it. Which
 * fields matter is decided afterwards: `lib/imports/facts.ts` maps the ones the
 * chosen type can hold into its metadata and drops the rest. Every field is
 * nullable or an empty list, and null is the correct answer whenever the
 * source did not say. The claims check then drops any value the source does
 * not contain, so a number here is one the creator can find in their own
 * material.
 */
export const draftDetailsSchema = z.object({
  /** Fonts. */
  styleCount: count(500),
  styleNames: z.array(z.string().trim().min(1).max(120)).max(100),
  isVariable: z.boolean().nullable(),
  fontFormats: z.array(z.enum(FONT_FORMATS)).max(FONT_FORMATS.length),
  glyphCount: count(100_000),
  classification: z.enum(FONT_CLASSIFICATIONS).nullable(),
  scripts: z.array(shortText).max(64),
  languages: z.array(z.string().trim().min(2).max(64)).max(200),
  /** OpenType feature tags, four letters each: liga, salt, ss01, smcp. */
  features: z.array(z.string().trim().min(1).max(4)).max(64),
  /** Templates and themes. */
  software: z.array(shortText).max(20),
  pageCount: count(10_000),
  dimensions: z.string().trim().min(1).max(64).nullable(),
  /** Graphics, photos, illustrations, icons, mockups, brushes. */
  fileFormats: z.array(z.string().trim().min(1).max(16)).max(20),
  dpi: count(2400),
  itemCount: count(100_000),
})

export type DraftDetails = z.infer<typeof draftDetailsSchema>

/** Nothing stated. The value a source without specifications produces. */
export function emptyDraftDetails(): DraftDetails {
  return {
    styleCount: null,
    styleNames: [],
    isVariable: null,
    fontFormats: [],
    glyphCount: null,
    classification: null,
    scripts: [],
    languages: [],
    features: [],
    software: [],
    pageCount: null,
    dimensions: null,
    fileFormats: [],
    dpi: null,
    itemCount: null,
  }
}

/** Whether any detail is stated at all. */
export function hasAnyDetail(details: DraftDetails): boolean {
  return Object.values(details).some((value) =>
    Array.isArray(value) ? value.length > 0 : value !== null,
  )
}

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
  details: suggested(draftDetailsSchema),
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
  "details",
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
const nullableInteger = { type: ["integer", "null"] }

const DETAILS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "styleCount",
    "styleNames",
    "isVariable",
    "fontFormats",
    "glyphCount",
    "classification",
    "scripts",
    "languages",
    "features",
    "software",
    "pageCount",
    "dimensions",
    "fileFormats",
    "dpi",
    "itemCount",
  ],
  properties: {
    styleCount: {
      ...nullableInteger,
      description: "Fonts: how many styles, weights or cuts the family includes.",
    },
    styleNames: {
      ...stringArray(100),
      description: "Fonts: the names of the styles, as the source lists them.",
    },
    isVariable: {
      type: ["boolean", "null"],
      description: "Fonts: whether the source says it is a variable font.",
    },
    fontFormats: {
      type: "array",
      maxItems: FONT_FORMATS.length,
      items: { type: "string", enum: [...FONT_FORMATS] },
      description: "Fonts: file formats the source names.",
    },
    glyphCount: { ...nullableInteger, description: "Fonts: the glyph count the source states." },
    classification: {
      type: ["string", "null"],
      enum: [...FONT_CLASSIFICATIONS, null],
      description: "Fonts: the classification the source's own words support.",
    },
    scripts: {
      ...stringArray(64),
      description: "Fonts: writing systems the source names, such as Latin, Cyrillic, Kana.",
    },
    languages: { ...stringArray(200), description: "Fonts: languages the source names." },
    features: {
      ...stringArray(64),
      description:
        "Fonts: OpenType feature tags the source names, four letters each (liga, dlig, salt, ss01, swsh, calt, smcp, frac, tnum, onum, kern).",
    },
    software: {
      ...stringArray(20),
      description: "Templates and themes: the software the source says it opens in.",
    },
    pageCount: { ...nullableInteger, description: "Templates: the page or slide count stated." },
    dimensions: {
      type: ["string", "null"],
      description: "Templates: the dimensions stated, as written.",
    },
    fileFormats: {
      ...stringArray(20),
      description: "Graphics, photos, icons, mockups, brushes: file formats the source names.",
    },
    dpi: { ...nullableInteger, description: "Graphics: the resolution in DPI, when stated." },
    itemCount: {
      ...nullableInteger,
      description: "Graphics and icons: how many items the set contains, when stated.",
    },
  },
}

export const DRAFT_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [...DRAFT_FIELDS, "missingInformation"],
  properties: {
    title: suggestedJson({ type: "string" }, "A product name. Prefer the page's own wording."),
    shortDescription: suggestedJson({ type: "string" }, "One or two sentences."),
    longDescription: suggestedJson(
      { type: "string" },
      "Markdown: an opening paragraph or two, then sections under '## ' headings drawn from the source's own structure, '### ' for subsections, paragraphs separated by blank lines, bullet lists with '- ' where the evidence lists things. No '# ' heading, no links, no images, no emoji.",
    ),
    productType: suggestedJson(
      { type: "string", enum: [...PRODUCT_TYPES] },
      "The closest member of the list. Use other when nothing fits.",
    ),
    features: suggestedJson(stringArray(12), "Things the page shows the product doing."),
    useCases: suggestedJson(stringArray(8), "What somebody would use it for."),
    audience: suggestedJson({ type: "string" }, "Who it appears to be for."),
    tags: suggestedJson(
      stringArray(15),
      "Eight to fifteen lowercase search keywords a buyer would type: the kind of product, its style, and its uses, drawn from the evidence. Always filled.",
    ),
    technicalRequirements: suggestedJson(
      stringArray(8),
      "Only requirements the page itself states. Empty array if it states none.",
    ),
    details: suggestedJson(
      DETAILS_JSON_SCHEMA,
      "Structured details the source states, in its own words. null or an empty list for anything it does not say; Fanwise checks each value against the source and drops what it cannot find there.",
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
