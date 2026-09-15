import { markdownToClaimText } from "@/lib/text/markdown"
import { featureLabel } from "@/lib/fonts/coverage"
import { WIDTH_NAMES } from "@/lib/fonts/detected"
import {
  axisName,
  distinctWeights,
  stylisticSetCount,
  weightName,
  type FactSheet,
} from "./factsheet"
import type { ListingOutput } from "./output"

/**
 * The factuality validator. One of the three things that never bend.
 *
 * A deterministic pass that extracts every number, format name, compatibility
 * claim and restricted claim from generated text and checks each against the
 * FactSheet. Anything unsupported fails the generation, and the listing is not
 * touched. A fabricated glyph count on a live listing is not a quality issue;
 * it is a refund, a bad review, and in the wrong category a legal problem.
 *
 * The bias is towards refusing. A generation rejected for a number the creator
 * could have vouched for costs one more click; a generation accepted with a
 * number nobody can vouch for costs the thing this product is for. So the
 * vocabularies below err on the side of catching, and a term that is genuinely
 * in the product's facts is always allowed, because the allowed set is built
 * from the FactSheet's own words.
 *
 * No model, no network, no clock. The same output and the same FactSheet
 * always produce the same verdict.
 */

export type ViolationKind = "number" | "format" | "compatibility" | "claim" | "feature" | "script"

export interface Violation {
  kind: ViolationKind
  /** What was said, as it appeared. */
  value: string
  /** Which output field said it. */
  field: keyof ListingOutput
}

export type FactualityResult = { ok: true; violations: [] } | { ok: false; violations: Violation[] }

/**
 * File and delivery formats a listing might claim. Only tokens that are not
 * also ordinary English words, so that prose never trips them: "pages",
 * "numbers", "key" and "raw" are all formats and all left out on purpose.
 */
const FORMAT_TERMS = [
  "otf",
  "ttf",
  "ttc",
  "woff",
  "woff2",
  "eot",
  "pfb",
  "dfont",
  "svg",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "tiff",
  "tif",
  "bmp",
  "ico",
  "icns",
  "psd",
  "psb",
  "ai",
  "eps",
  "pdf",
  "indd",
  "idml",
  "xd",
  "afdesign",
  "afphoto",
  "afpub",
  "abr",
  "brushset",
  "obj",
  "fbx",
  "stl",
  "gltf",
  "glb",
  "c4d",
  "skp",
  "dxf",
  "dwg",
  "mp4",
  "mov",
  "mkv",
  "mp3",
  "wav",
  "aac",
  "flac",
  "ogg",
  "zip",
  "rar",
  "7z",
  "docx",
  "pptx",
  "xlsx",
  "dng",
  "heic",
  "avif",
  "aep",
  "prproj",
  "lottie",
  "4k",
  "8k",
  "1080p",
] as const

/** Aliases that name one format two ways. Both sides are checked as one. */
const FORMAT_ALIASES: Record<string, string> = {
  jpeg: "jpg",
  tiff: "tif",
}

/**
 * Software, platforms and devices a listing might claim compatibility with.
 * Multi-word entries first, so "affinity designer" is matched before "affinity".
 */
const COMPATIBILITY_TERMS = [
  "after effects",
  "premiere pro",
  "affinity designer",
  "affinity photo",
  "affinity publisher",
  "clip studio",
  "cinema 4d",
  "3ds max",
  "microsoft word",
  "google docs",
  "google slides",
  "google sheets",
  "davinci resolve",
  "final cut",
  "logic pro",
  "fl studio",
  "adobe fonts",
  "mac os",
  "photoshop",
  "illustrator",
  "indesign",
  "lightroom",
  "premiere",
  "affinity",
  "figma",
  "canva",
  "procreate",
  "krita",
  "gimp",
  "inkscape",
  "blender",
  "maya",
  "sketchup",
  "unity",
  "unreal",
  "powerpoint",
  "keynote",
  "notion",
  "wordpress",
  "elementor",
  "squarespace",
  "wix",
  "windows",
  "macos",
  "ios",
  "android",
  "ipad",
  "iphone",
  "cricut",
  "glowforge",
  "capcut",
  "ableton",
  "garageband",
  "kindle",
  "goodnotes",
  "notability",
  "adobe",
] as const

/**
 * Claims about licensing, support, guarantees and standing that a model has no
 * way to know. Allowed only when the FactSheet's own text makes them.
 */
const CLAIM_TERMS = [
  "money-back",
  "money back",
  "refund",
  "refunds",
  "guarantee",
  "guaranteed",
  "warranty",
  "lifetime updates",
  "free updates",
  "lifetime access",
  "lifetime license",
  "lifetime support",
  "email support",
  "free support",
  "priority support",
  "customer support",
  "24/7",
  "unlimited",
  "royalty-free",
  "royalty free",
  "commercial",
  "non-commercial",
  "personal use",
  "extended license",
  "license",
  "licence",
  "licensed",
  "award-winning",
  "award winning",
  "best-selling",
  "bestselling",
  "best selling",
  "top-rated",
  "top rated",
  "trusted by",
  "#1",
] as const

/**
 * OpenType features a typeface listing might claim, each group being one
 * feature said several ways. A term is allowed when any term or tag of its
 * group is in the facts, so "small caps" passes for a font whose features list
 * smcp. Longer phrases are matched and consumed before shorter ones, so
 * "discretionary ligatures" is judged as itself and not as "ligatures".
 *
 * Only phrases that mean the feature and little else in ordinary prose:
 * "fractions" and "ordinals" are in, "alternates" alone and "kerning" are not.
 */
const FEATURE_GROUPS: ReadonlyArray<{ terms: readonly string[]; tags: readonly string[] }> = [
  { terms: ["discretionary ligatures"], tags: ["dlig"] },
  { terms: ["contextual ligatures"], tags: ["clig"] },
  { terms: ["contextual alternates"], tags: ["calt"] },
  { terms: ["stylistic alternates"], tags: ["salt"] },
  { terms: ["stylistic sets", "stylistic set"], tags: [] },
  { terms: ["character variants", "character variant"], tags: [] },
  { terms: ["titling alternates"], tags: ["titl"] },
  { terms: ["petite capitals", "petite caps"], tags: ["pcap", "c2pc"] },
  { terms: ["small capitals", "small caps"], tags: ["smcp", "c2sc"] },
  { terms: ["oldstyle figures", "old-style figures", "old style figures", "oldstyle numerals", "old-style numerals"], tags: ["onum"] },
  { terms: ["lining figures", "lining numerals"], tags: ["lnum"] },
  { terms: ["tabular figures", "tabular numerals"], tags: ["tnum"] },
  { terms: ["proportional figures", "proportional numerals"], tags: ["pnum"] },
  { terms: ["slashed zero"], tags: ["zero"] },
  { terms: ["case-sensitive forms", "case-sensitive punctuation"], tags: ["case"] },
  { terms: ["superscripts", "superscript"], tags: ["sups"] },
  { terms: ["subscripts", "subscript"], tags: ["subs"] },
  { terms: ["fractions"], tags: ["frac"] },
  { terms: ["ordinals"], tags: ["ordn"] },
  { terms: ["swashes", "swash"], tags: ["swsh", "cswh"] },
  { terms: ["ligatures"], tags: ["liga", "dlig", "clig", "rlig"] },
  { terms: ["variable fonts", "variable font"], tags: [] },
  { terms: ["italics", "italic"], tags: [] },
] // prettier-ignore

/** Stylistic sets and character variants are tag families, not single tags. */
const FEATURE_TAG_PREFIX: Record<string, RegExp> = {
  "stylistic sets": /^ss\d\d$/,
  "character variants": /^cv\d\d$/,
}

/**
 * Writing systems a typeface listing might claim. "Latin extended" first, so
 * a font that covers the basic alphabet cannot claim the extended one.
 * "Arabic numerals" is ordinary English for 0 to 9 and is removed before the
 * check. Short or ambiguous names (Han, Thai as a cuisine) are left out, or
 * kept only where a listing would rarely use the word for anything else.
 */
const SCRIPT_TERMS = [
  "latin extended",
  "extended latin",
  "latin",
  "greek",
  "cyrillic",
  "armenian",
  "hebrew",
  "arabic",
  "devanagari",
  "georgian",
  "hiragana",
  "katakana",
  "kana",
  "hangul",
  "cjk",
] as const

const NUMBER_WORDS: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
  thousand: 1000,
  dozen: 12,
}

/** Words that state a quantity without stating it: always unsupported. */
const VAGUE_QUANTITIES = ["dozens", "hundreds", "thousands", "millions", "countless"] as const

const TENS = "twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety"
const UNITS = "one|two|three|four|five|six|seven|eight|nine"
const COMPOUND_NUMBER_WORD = new RegExp(`\\b(${TENS})[- ](${UNITS})\\b`, "gi")
const NUMBER_WORD = new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join("|")})\\b`, "gi")
const VAGUE = new RegExp(`\\b(${VAGUE_QUANTITIES.join("|")})\\b`, "gi")

/**
 * A number, standing on its own. Not preceded by a letter, digit or dot, so
 * "woff2", "v2.1" and "A4" do not yield a 2, a 1 or a 4; and not followed by a
 * letter, so "1080p" and "2x" are left to the vocabulary. Thousands separators
 * and decimals are one number. A decade's plural is the one letter allowed:
 * "1970s", "1970's" and "'90s" are periods, and a period is a claim, so they
 * read as 1970, 1970 and 90 rather than slipping past as words.
 */
const NUMERAL = /(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:['\u2019]?s)?(?![\w])/g

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** A whole-word, case-insensitive matcher for a term that may contain symbols. */
function termPattern(term: string): RegExp {
  return new RegExp(`(?<![\\w])${escapeRegExp(term)}(?![\\w])`, "gi")
}

function parseNumeral(text: string): number {
  return Number(text.replace(/,|['\u2019]?s$/g, ""))
}

function normalizeFormat(term: string): string {
  const lower = term.toLowerCase()
  return FORMAT_ALIASES[lower] ?? lower
}

/** Every string the FactSheet holds, lowercased and joined, for term lookup. */
function factCorpus(sheet: FactSheet): string {
  const parts: string[] = [
    sheet.name,
    sheet.title,
    sheet.productType,
    markdownToClaimText(sheet.description),
    sheet.shortDescription ?? "",
    sheet.brand ?? "",
    sheet.version ?? "",
    sheet.licenseSummary ?? "",
    ...sheet.files.formats,
  ]
  const d = sheet.details
  switch (d.kind) {
    case "font":
      parts.push(...(d.formats ?? []), ...(d.languageSupport ?? []))
      if (d.classification) parts.push(d.classification)
      for (const style of d.styles ?? []) {
        parts.push(style.name)
        if (style.weight !== undefined) parts.push(weightName(style.weight) ?? "")
        if (style.width !== undefined) parts.push(WIDTH_NAMES[style.width] ?? "")
        if (style.italic) parts.push("italic")
      }
      for (const axis of d.axes ?? []) parts.push(axis.tag, axisName(axis))
      if (d.isVariable === true || (d.axes?.length ?? 0) > 0) parts.push("variable font")
      parts.push(...(d.scripts ?? []))
      for (const tag of d.features ?? []) parts.push(tag, featureLabel(tag))
      parts.push(...(d.licenses ?? []), ...(d.keywords ?? []))
      break
    case "template":
      parts.push(...(d.software ?? []), d.dimensions ?? "")
      break
    case "raster":
      parts.push(...(d.fileFormats ?? []))
      break
    case "generic":
      parts.push(d.notes ?? "")
      break
  }
  return parts.join("\n").toLowerCase()
}

/** Every number the FactSheet states, as a value or inside its text. */
function factNumbers(sheet: FactSheet, corpus: string): Set<number> {
  const numbers = new Set<number>()
  const add = (n: number | undefined) => {
    if (n !== undefined && Number.isFinite(n)) numbers.add(n)
  }

  if (sheet.price) add(sheet.price.amount)
  add(sheet.files.deliverableCount)
  add(sheet.imageCount)

  const d = sheet.details
  switch (d.kind) {
    case "font":
      add(d.styleCount)
      add(d.glyphCount)
      if (d.languageSupport?.length) add(d.languageSupport.length)
      if (d.scripts?.length) add(d.scripts.length)
      if (d.styles?.length) {
        add(d.styles.length)
        for (const style of d.styles) add(style.weight)
        const weights = distinctWeights(d.styles)
        if (weights.length > 0) add(weights.length)
        const italics = d.styles.filter((style) => style.italic === true).length
        if (italics > 0) add(italics)
      }
      for (const axis of d.axes ?? []) {
        add(axis.min)
        add(axis.default)
        add(axis.max)
      }
      if (d.axes?.length) add(d.axes.length)
      if (d.features) {
        const sets = stylisticSetCount(d.features)
        if (sets > 0) add(sets)
      }
      break
    case "template":
      add(d.pageCount)
      break
    case "raster":
      add(d.dpi)
      add(d.itemCount)
      break
    case "generic":
      break
  }

  for (const match of corpus.matchAll(NUMERAL)) add(parseNumeral(match[0]))
  for (const match of corpus.matchAll(COMPOUND_NUMBER_WORD)) {
    add(NUMBER_WORDS[match[1]!.toLowerCase()]! + NUMBER_WORDS[match[2]!.toLowerCase()]!)
  }
  for (const match of corpus.matchAll(NUMBER_WORD)) add(NUMBER_WORDS[match[1]!.toLowerCase()])

  return numbers
}

/**
 * Format tokens the FactSheet supports: the measured deliverable extensions,
 * the declared formats, and anything the creator wrote in their own text.
 */
function factFormats(sheet: FactSheet, corpus: string): Set<string> {
  const formats = new Set<string>()
  for (const f of sheet.files.formats) formats.add(normalizeFormat(f))
  const d = sheet.details
  if (d.kind === "font") for (const f of d.formats ?? []) formats.add(normalizeFormat(f))
  if (d.kind === "raster") for (const f of d.fileFormats ?? []) formats.add(normalizeFormat(f))
  for (const term of FORMAT_TERMS) {
    if (termPattern(term).test(corpus)) formats.add(normalizeFormat(term))
  }
  return formats
}

function corpusHas(corpus: string, term: string): boolean {
  return termPattern(term).test(corpus)
}

/** Whether the facts support a feature group: a term in the text, or a tag. */
function featureSupported(
  group: (typeof FEATURE_GROUPS)[number],
  corpus: string,
  tags: readonly string[],
): boolean {
  if (group.terms.some((term) => corpusHas(corpus, term))) return true
  if (group.tags.some((tag) => tags.includes(tag))) return true
  const prefix = FEATURE_TAG_PREFIX[group.terms[0]!]
  return prefix !== undefined && tags.some((tag) => prefix.test(tag))
}

interface Allowed {
  numbers: Set<number>
  formats: Set<string>
  corpus: string
  /** The font's OpenType feature tags, when the product is a font. */
  featureTags: readonly string[]
}

function checkField(
  field: keyof ListingOutput,
  text: string,
  allowed: Allowed,
  violations: Violation[],
): void {
  const seen = new Set<string>()
  const report = (kind: ViolationKind, value: string) => {
    const key = `${kind}:${value.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    violations.push({ kind, value, field })
  }

  // Numerals. "9 weights", "$48", "300 DPI", "2024".
  for (const match of text.matchAll(NUMERAL)) {
    const value = parseNumeral(match[0])
    if (!allowed.numbers.has(value)) report("number", match[0])
  }

  // Number words. Compounds first, and their span removed so the parts are
  // not counted a second time on their own.
  let remaining = text
  for (const match of text.matchAll(COMPOUND_NUMBER_WORD)) {
    const value = NUMBER_WORDS[match[1]!.toLowerCase()]! + NUMBER_WORDS[match[2]!.toLowerCase()]!
    if (!allowed.numbers.has(value)) report("number", match[0])
    remaining = remaining.replace(match[0], " ")
  }
  for (const match of remaining.matchAll(NUMBER_WORD)) {
    const value = NUMBER_WORDS[match[1]!.toLowerCase()]!
    if (!allowed.numbers.has(value)) report("number", match[0])
  }
  for (const match of text.matchAll(VAGUE)) report("number", match[0])

  // Formats. The vocabulary is checked as whole words, so "pdf" inside
  // "pdfs" is caught by the trailing-s tolerance below and "ai" inside
  // "paint" is not.
  for (const term of FORMAT_TERMS) {
    const pattern = new RegExp(`(?<![\\w])${escapeRegExp(term)}s?(?![\\w])`, "gi")
    if (pattern.test(text) && !allowed.formats.has(normalizeFormat(term))) {
      report("format", term)
    }
  }

  // Compatibility. Longest terms first so a matched phrase is consumed before
  // its shorter member is looked for.
  let compat = text
  for (const term of COMPATIBILITY_TERMS) {
    const pattern = termPattern(term)
    if (!pattern.test(compat)) continue
    if (!corpusHas(allowed.corpus, term)) report("compatibility", term)
    compat = compat.replace(termPattern(term), " ")
  }

  // OpenType features. Longest phrases first, each consumed once judged.
  let features = text
  for (const group of FEATURE_GROUPS) {
    for (const term of group.terms) {
      const pattern = termPattern(term)
      if (!pattern.test(features)) continue
      if (!featureSupported(group, allowed.corpus, allowed.featureTags)) report("feature", term)
      features = features.replace(termPattern(term), " ")
    }
  }

  // Writing systems. "Arabic numerals" means 0 to 9, not the script.
  let scripts = text.replace(/\barabic (numerals|numbers|digits)\b/gi, " ")
  for (const term of SCRIPT_TERMS) {
    const pattern = termPattern(term)
    if (!pattern.test(scripts)) continue
    if (!corpusHas(allowed.corpus, term)) report("script", term)
    scripts = scripts.replace(termPattern(term), " ")
  }

  // Restricted claims, allowed only where the creator's own words make them.
  let claims = text
  for (const term of CLAIM_TERMS) {
    const pattern = termPattern(term)
    if (!pattern.test(claims)) continue
    if (!corpusHas(allowed.corpus, term)) report("claim", term)
    claims = claims.replace(termPattern(term), " ")
  }
}

export function validateFactuality(output: ListingOutput, sheet: FactSheet): FactualityResult {
  const corpus = factCorpus(sheet)
  const allowed: Allowed = {
    numbers: factNumbers(sheet, corpus),
    formats: factFormats(sheet, corpus),
    corpus,
    featureTags: sheet.details.kind === "font" ? (sheet.details.features ?? []) : [],
  }

  const violations: Violation[] = []
  checkField("title", output.title, allowed, violations)
  // Read as the words a buyer sees: list markers are structure, not counts.
  checkField("description", markdownToClaimText(output.description), allowed, violations)
  checkField("shortDescription", output.shortDescription, allowed, violations)
  checkField("seoTitle", output.seoTitle, allowed, violations)
  checkField("seoDescription", output.seoDescription, allowed, violations)
  checkField("tags", output.tags.join("\n"), allowed, violations)

  return violations.length === 0 ? { ok: true, violations: [] } : { ok: false, violations }
}

/**
 * The sentence a creator sees. Names what was claimed, never the model or the
 * vendor, and never more than a handful so a long list is still readable.
 */
export function describeViolations(violations: readonly Violation[]): string {
  const values = [...new Set(violations.map((v) => v.value))]
  const shown = values.slice(0, 6).join(", ")
  const more = values.length > 6 ? ` and ${values.length - 6} more` : ""
  return `The model claimed something not in your product data: ${shown}${more}.`
}
