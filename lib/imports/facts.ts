import {
  FONT_CLASSIFICATIONS,
  METADATA_KIND_BY_PRODUCT_TYPE,
  type FontClassification,
  type FontFormat,
  type ProductMetadata,
} from "@/lib/products/metadata"
import type { ProductType } from "@/lib/products/types"
import { slugify } from "@/lib/slug"
import { emptyDraftDetails, type DraftDetails } from "./draft-output"

/**
 * The structured details of a draft: which of them the sources actually
 * state, and how the stated ones land on the product.
 *
 * A model reading a specimen page will happily report "6 styles, 524 glyphs,
 * Cyrillic" when the page says so, and just as happily when it does not. The
 * prose fields are checked for the kinds of claim a page cannot establish
 * (`claims.ts`); a detail is a plainer thing, a number or a name, and the check
 * is plainer too: **the value is kept only if the sources contain it.** A count
 * has to appear as that number or its word, a format as its name, a script or a
 * language as itself, a classification in a word a person would use for it.
 * Anything else is dropped and named, so the creator sees "glyph count: 524"
 * under "removed" rather than on their product.
 *
 * What survives is mapped into the product's metadata for the type the creator
 * chose, filling only what is still empty. Values read from uploaded font files
 * and values the creator typed are already theirs, and a draft never overwrites
 * either.
 *
 * Pure. No model, no network, no clock.
 */

export interface DroppedDetail {
  field: keyof DraftDetails
  value: string
}

const NUMBER_WORDS: Record<number, string> = {
  1: "one",
  2: "two",
  3: "three",
  4: "four",
  5: "five",
  6: "six",
  7: "seven",
  8: "eight",
  9: "nine",
  10: "ten",
  11: "eleven",
  12: "twelve",
  13: "thirteen",
  14: "fourteen",
  15: "fifteen",
  16: "sixteen",
  17: "seventeen",
  18: "eighteen",
  19: "nineteen",
  20: "twenty",
}

/** Words a source uses for each classification. "serif" alone must not be "sans serif". */
const CLASSIFICATION_WORDS: Record<FontClassification, readonly string[]> = {
  sans_serif: ["sans serif", "sans-serif", "sans", "grotesk", "grotesque", "gothic sans"],
  serif: ["(?<!sans[\\s-])serif", "didone", "garalde", "transitional serif", "old style"],
  slab_serif: ["slab"],
  display: ["display"],
  script: ["script", "calligraphic", "brush"],
  handwritten: ["handwritten", "hand-written", "handwriting", "hand lettered", "hand-lettered"],
  monospace: ["monospace", "monospaced", "mono"],
  blackletter: ["blackletter", "fraktur", "textura"],
  decorative: ["decorative", "ornamental"],
}

const FORMAT_WORDS: Record<FontFormat, readonly string[]> = {
  otf: ["otf", "opentype"],
  ttf: ["ttf", "truetype"],
  woff: ["woff"],
  woff2: ["woff2", "woff 2"],
  eot: ["eot"],
}

/** What a source calls an OpenType feature, beside its tag. */
const FEATURE_WORDS: Record<string, readonly string[]> = {
  liga: ["ligatures", "ligature"],
  dlig: ["discretionary ligatures"],
  hlig: ["historical ligatures"],
  clig: ["contextual ligatures"],
  calt: ["contextual alternates", "contextual alternate"],
  salt: ["stylistic alternates", "stylistic alternate", "alternates"],
  swsh: ["swashes", "swash"],
  smcp: ["small caps", "small capitals"],
  c2sc: ["small caps", "small capitals"],
  frac: ["fractions", "fraction"],
  sups: ["superscript", "superscripts", "superiors"],
  subs: ["subscript", "subscripts", "inferiors"],
  tnum: ["tabular figures", "tabular numerals", "tabular"],
  pnum: ["proportional figures", "proportional numerals", "proportional"],
  onum: ["oldstyle figures", "old-style figures", "old style figures", "oldstyle"],
  lnum: ["lining figures", "lining numerals", "lining"],
  ordn: ["ordinals", "ordinal"],
  locl: ["localized forms", "localised forms", "localized", "localised"],
  case: ["case-sensitive", "case sensitive"],
  kern: ["kerning", "kerned"],
  titl: ["titling"],
  init: ["initial forms"],
  fina: ["terminal forms", "final forms"],
  zero: ["slashed zero"],
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** A phrase as a word-bounded pattern, tolerant of spacing and hyphens between its words. */
function phrasePattern(phrase: string): RegExp {
  const body = phrase
    .toLowerCase()
    .split(/[\s-]+/)
    .filter((part) => part.length > 0)
    .map(escape)
    .join("[\\s-]*")
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "iu")
}

/** A pattern written by hand above, which may already carry its own guards. */
function rawPattern(source: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${source}(?![\\p{L}\\p{N}])`, "iu")
}

function hasPhrase(corpus: string, phrase: string): boolean {
  return phrasePattern(phrase).test(corpus)
}

function hasAnyWord(corpus: string, words: readonly string[]): boolean {
  return words.some((word) => rawPattern(word).test(corpus))
}

/** The number as digits, without thousands separators, or as its word for small counts. */
function hasNumber(corpus: string, value: number): boolean {
  // Not part of a longer number, and not the whole part of a decimal: "$24.00"
  // does not state 24 of anything.
  const digits = new RegExp(`(?<![\\d.,])${value}(?!\\d|\\.\\d)`)
  if (digits.test(corpus.replace(/(\d),(?=\d{3}(?!\d))/g, "$1"))) return true
  const word = NUMBER_WORDS[value]
  return word !== undefined && hasPhrase(corpus, word)
}

/**
 * The details the sources support, and the ones they do not.
 *
 * `corpus` is everything the sources said, lower-cased, as `claims.ts` builds
 * it. The same details and the same corpus always give the same answer.
 */
export function supportedDetails(
  details: DraftDetails,
  corpus: string,
): { details: DraftDetails; dropped: DroppedDetail[] } {
  const dropped: DroppedDetail[] = []
  const drop = (field: keyof DraftDetails, value: string | number) =>
    dropped.push({ field, value: String(value) })

  const keepCount = (field: keyof DraftDetails, value: number | null): number | null => {
    if (value === null) return null
    if (hasNumber(corpus, value)) return value
    drop(field, value)
    return null
  }

  const keepEach = <T extends string>(
    field: keyof DraftDetails,
    values: readonly T[],
    supported: (value: T) => boolean,
  ): T[] =>
    values.filter((value) => {
      if (supported(value)) return true
      drop(field, value)
      return false
    })

  const isVariable =
    details.isVariable === null
      ? null
      : details.isVariable
        ? hasPhrase(corpus, "variable")
          ? true
          : (drop("isVariable", "variable"), null)
        : hasPhrase(corpus, "static") || hasPhrase(corpus, "not variable")
          ? false
          : (drop("isVariable", "not variable"), null)

  const classification =
    details.classification === null
      ? null
      : hasAnyWord(corpus, CLASSIFICATION_WORDS[details.classification])
        ? details.classification
        : (drop("classification", details.classification), null)

  const dimensions =
    details.dimensions === null
      ? null
      : hasPhrase(corpus, details.dimensions)
        ? details.dimensions
        : (drop("dimensions", details.dimensions), null)

  return {
    details: {
      styleCount: keepCount("styleCount", details.styleCount),
      styleNames: keepEach("styleNames", details.styleNames, (name) => hasPhrase(corpus, name)),
      isVariable,
      fontFormats: keepEach("fontFormats", details.fontFormats, (format) =>
        hasAnyWord(corpus, FORMAT_WORDS[format]),
      ),
      glyphCount: keepCount("glyphCount", details.glyphCount),
      classification,
      scripts: keepEach("scripts", details.scripts, (script) => hasPhrase(corpus, script)),
      languages: keepEach("languages", details.languages, (language) =>
        hasPhrase(corpus, language),
      ),
      features: keepEach(
        "features",
        details.features,
        (tag) =>
          hasPhrase(corpus, tag) ||
          hasAnyWord(corpus, FEATURE_WORDS[tag.toLowerCase()] ?? []) ||
          (/^ss\d\d$/i.test(tag) && hasAnyWord(corpus, ["stylistic sets?"])),
      ),
      software: keepEach("software", details.software, (name) => hasPhrase(corpus, name)),
      pageCount: keepCount("pageCount", details.pageCount),
      dimensions,
      fileFormats: keepEach("fileFormats", details.fileFormats, (format) =>
        hasPhrase(corpus, format),
      ),
      dpi: keepCount("dpi", details.dpi),
      itemCount: keepCount("itemCount", details.itemCount),
    },
    dropped,
  }
}

/** Labels for the screen, one per detail field. */
export const DETAIL_LABELS: Record<keyof DraftDetails, string> = {
  styleCount: "Number of styles",
  styleNames: "Style names",
  isVariable: "Variable font",
  fontFormats: "Font formats",
  glyphCount: "Glyph count",
  classification: "Classification",
  scripts: "Writing systems",
  languages: "Languages",
  features: "OpenType features",
  software: "Software",
  pageCount: "Page count",
  dimensions: "Dimensions",
  fileFormats: "File formats",
  dpi: "Resolution (DPI)",
  itemCount: "Items included",
}

/** Which detail fields a product type can hold. The rest are dropped on save. */
export function detailFieldsFor(productType: ProductType): ReadonlyArray<keyof DraftDetails> {
  switch (METADATA_KIND_BY_PRODUCT_TYPE[productType]) {
    case "font":
      return [
        "classification",
        "styleCount",
        "styleNames",
        "isVariable",
        "fontFormats",
        "glyphCount",
        "scripts",
        "languages",
        "features",
      ]
    case "template":
      return ["software", "pageCount", "dimensions"]
    case "raster":
      return ["fileFormats", "dpi", "itemCount"]
    case "generic":
      return []
  }
}

/** The details a type can hold, as "Label: value" lines for the screen. */
export function describeDetails(
  details: DraftDetails,
  productType: ProductType | null,
): Array<{ field: keyof DraftDetails; label: string; value: string }> {
  const fields = productType ? detailFieldsFor(productType) : (Object.keys(details) as never[])
  const lines: Array<{ field: keyof DraftDetails; label: string; value: string }> = []
  for (const field of fields as ReadonlyArray<keyof DraftDetails>) {
    const value = details[field]
    if (value === null || (Array.isArray(value) && value.length === 0)) continue
    const text = Array.isArray(value)
      ? value.join(", ")
      : typeof value === "boolean"
        ? value
          ? "Yes"
          : "No"
        : field === "classification"
          ? CLASSIFICATION_LABELS[value as FontClassification]
          : String(value)
    lines.push({ field, label: DETAIL_LABELS[field], value: text })
  }
  return lines
}

export const CLASSIFICATION_LABELS: Record<FontClassification, string> = {
  sans_serif: "Sans serif",
  serif: "Serif",
  slab_serif: "Slab serif",
  display: "Display",
  script: "Script",
  handwritten: "Handwritten",
  monospace: "Monospace",
  blackletter: "Blackletter",
  decorative: "Decorative",
}

// Every classification has a label and a word list, or the record types above
// would not compile; this line keeps the enum import honest if one is added.
void FONT_CLASSIFICATIONS

/**
 * The details a product already holds, in the draft's shape.
 *
 * What the font workspace or an upload wrote, read back so the review screen
 * shows the creator's own facts as theirs rather than offering a model's copy
 * of them.
 */
export function detailsFromMetadata(metadata: ProductMetadata): DraftDetails {
  const details = emptyDraftDetails()
  switch (metadata.kind) {
    case "font":
      return {
        ...details,
        styleCount: metadata.styleCount ?? null,
        styleNames: (metadata.styles ?? []).map((style) => style.name),
        isVariable: metadata.isVariable ?? null,
        fontFormats: [...(metadata.formats ?? [])],
        glyphCount: metadata.glyphCount ?? null,
        classification: metadata.classification ?? null,
        scripts: [...(metadata.scripts ?? [])],
        languages: [...(metadata.languageSupport ?? [])],
        features: [...(metadata.features ?? [])],
      }
    case "template":
      return {
        ...details,
        software: [...(metadata.software ?? [])],
        pageCount: metadata.pageCount ?? null,
        dimensions: metadata.dimensions ?? null,
      }
    case "raster":
      return {
        ...details,
        fileFormats: [...(metadata.fileFormats ?? [])],
        dpi: metadata.dpi ?? null,
        itemCount: metadata.itemCount ?? null,
      }
    case "generic":
      return details
  }
}

/**
 * The product's metadata with the stated details filled in.
 *
 * The shape follows the chosen type: a product that arrived as `other` and is
 * now a font gets font metadata, which is what the font workspace and the
 * FactSheet read. An existing value is never replaced, only an absent one
 * filled, so facts read from uploaded files and facts the creator typed stay
 * theirs. Tags fill in the same way.
 */
export function metadataWithDetails(params: {
  existing: ProductMetadata
  productType: ProductType
  details: DraftDetails
  tags: readonly string[]
}): ProductMetadata {
  const { existing, productType, details, tags } = params
  const kind = METADATA_KIND_BY_PRODUCT_TYPE[productType]
  const base: ProductMetadata = existing.kind === kind ? existing : ({ kind } as ProductMetadata)

  // The form showed the stored tags first, so what it sends back is the answer.
  const nextTags = tags.length > 0 ? [...tags] : base.tags
  const withTags = nextTags ? { ...base, tags: nextTags } : base

  switch (withTags.kind) {
    case "font": {
      const styles =
        withTags.styles === undefined && details.styleNames.length > 0
          ? details.styleNames.map((name) => ({ key: slugify(name) || name, name }))
          : undefined
      return {
        ...withTags,
        ...(withTags.styleCount === undefined && (details.styleCount ?? styles?.length)
          ? { styleCount: details.styleCount ?? styles!.length }
          : {}),
        ...(withTags.isVariable === undefined && details.isVariable !== null
          ? { isVariable: details.isVariable }
          : {}),
        ...(withTags.formats === undefined && details.fontFormats.length > 0
          ? { formats: [...details.fontFormats] }
          : {}),
        ...(withTags.glyphCount === undefined && details.glyphCount !== null
          ? { glyphCount: details.glyphCount }
          : {}),
        ...(withTags.classification === undefined && details.classification !== null
          ? { classification: details.classification }
          : {}),
        ...(withTags.scripts === undefined && details.scripts.length > 0
          ? { scripts: [...details.scripts] }
          : {}),
        ...(withTags.languageSupport === undefined && details.languages.length > 0
          ? { languageSupport: [...details.languages] }
          : {}),
        ...(withTags.features === undefined && details.features.length > 0
          ? { features: details.features.map((tag) => tag.toLowerCase()) }
          : {}),
        ...(styles ? { styles } : {}),
      }
    }
    case "template":
      return {
        ...withTags,
        ...(withTags.software === undefined && details.software.length > 0
          ? { software: [...details.software] }
          : {}),
        ...(withTags.pageCount === undefined && details.pageCount !== null
          ? { pageCount: details.pageCount }
          : {}),
        ...(withTags.dimensions === undefined && details.dimensions !== null
          ? { dimensions: details.dimensions }
          : {}),
      }
    case "raster":
      return {
        ...withTags,
        ...(withTags.fileFormats === undefined && details.fileFormats.length > 0
          ? { fileFormats: details.fileFormats.map((format) => format.toLowerCase()) }
          : {}),
        ...(withTags.dpi === undefined && details.dpi !== null ? { dpi: details.dpi } : {}),
        ...(withTags.itemCount === undefined && details.itemCount !== null
          ? { itemCount: details.itemCount }
          : {}),
      }
    case "generic":
      return withTags
  }
}
