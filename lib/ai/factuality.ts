import type { FactSheet } from "./factsheet"
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

export type ViolationKind = "number" | "format" | "compatibility" | "claim"

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
 * and decimals are one number.
 */
const NUMERAL = /(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?![\w])/g

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** A whole-word, case-insensitive matcher for a term that may contain symbols. */
function termPattern(term: string): RegExp {
  return new RegExp(`(?<![\\w])${escapeRegExp(term)}(?![\\w])`, "gi")
}

function parseNumeral(text: string): number {
  return Number(text.replace(/,/g, ""))
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
    sheet.description ?? "",
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

interface Allowed {
  numbers: Set<number>
  formats: Set<string>
  corpus: string
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
  }

  const violations: Violation[] = []
  checkField("title", output.title, allowed, violations)
  checkField("description", output.description, allowed, violations)
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
