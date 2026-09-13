import type { ProductSourceEvidence } from "./evidence"

/**
 * Where two sources say different things about a fact.
 *
 * A model composing one draft from a PDF that says $12 and a page that says
 * $15 will pick one, and the pick will read as a fact. So before anything is
 * composed, the factual kinds a listing cannot afford to get wrong are read
 * from every source deterministically, and any kind two sources state
 * differently is a conflict: named on the review screen, withheld from the
 * draft, and left for the creator to settle.
 *
 * Four kinds, each read with a narrow pattern. Narrow on purpose: a missed
 * mention leaves the claims check and the creator's review as the backstop,
 * while a false conflict only asks a creator to confirm something.
 */

export const CONFLICT_KINDS = ["price", "dimensions", "fileFormats", "license"] as const
export type ConflictKind = (typeof CONFLICT_KINDS)[number]

export const CONFLICT_KIND_LABELS: Record<ConflictKind, string> = {
  price: "Price",
  dimensions: "Dimensions",
  fileFormats: "File formats",
  license: "Licence terms",
}

export interface SourceFacts {
  price: string[]
  dimensions: string[]
  fileFormats: string[]
  license: string[]
}

export interface FactConflict {
  kind: ConflictKind
  label: string
  /** Each distinct reading, and which sources gave it. */
  values: { value: string; sources: string[] }[]
}

export interface LabelledEvidence {
  label: string
  evidence: ProductSourceEvidence
}

const CURRENCY_SYMBOLS: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP", "¥": "JPY" }
const FILE_FORMATS = [
  "PDF",
  "PNG",
  "JPG",
  "JPEG",
  "SVG",
  "EPS",
  "AI",
  "PSD",
  "TIFF",
  "GIF",
  "WEBP",
  "MP4",
  "MOV",
  "MP3",
  "WAV",
  "ZIP",
  "DOCX",
  "XLSX",
  "PPTX",
  "KEY",
  "FIG",
  "SKETCH",
  "XD",
  "INDD",
  "OTF",
  "TTF",
  "WOFF",
  "WOFF2",
  "STL",
  "OBJ",
  "FBX",
  "BLEND",
  "PROCREATE",
  "BRUSHSET",
  "ABR",
  "CSV",
  "EPUB",
]
const LICENSE_TERMS = [
  "personal use",
  "commercial use",
  "extended license",
  "extended licence",
  "editorial use",
  "royalty-free",
  "royalty free",
  "single use",
  "unlimited use",
]

function unique(values: string[]): string[] {
  return [...new Set(values)].sort()
}

/** Every text a source stated, as one string, for fact reading. */
function textOf(evidence: ProductSourceEvidence): string {
  return [
    evidence.title?.value ?? "",
    evidence.summary?.value ?? "",
    ...evidence.visibleFeatures.value,
    evidence.bodyText?.value ?? "",
  ].join("\n")
}

export function readFacts(evidence: ProductSourceEvidence): SourceFacts {
  const text = textOf(evidence)

  const price: string[] = []
  // "$12", "$12.00", "€ 9,50" (a comma decimal is read as a point).
  for (const match of text.matchAll(/([$€£¥])\s?(\d{1,6}(?:[.,]\d{2})?)(?!\d)/g)) {
    price.push(`${CURRENCY_SYMBOLS[match[1]!]} ${Number(match[2]!.replace(",", ".")).toFixed(2)}`)
  }
  // "12 USD", "USD 12".
  for (const match of text.matchAll(
    /\b(USD|EUR|GBP|CAD|AUD)\s?(\d{1,6}(?:\.\d{2})?)\b|\b(\d{1,6}(?:\.\d{2})?)\s?(USD|EUR|GBP|CAD|AUD)\b/g,
  )) {
    const currency = match[1] ?? match[4]!
    const amount = match[2] ?? match[3]!
    price.push(`${currency} ${Number(amount).toFixed(2)}`)
  }

  const dimensions: string[] = []
  for (const match of text.matchAll(
    /\b(\d{2,5}(?:\.\d+)?)\s?[x×]\s?(\d{2,5}(?:\.\d+)?)\s?(px|in|cm|mm)?\b/gi,
  )) {
    dimensions.push(`${match[1]}×${match[2]}${match[3] ? ` ${match[3].toLowerCase()}` : ""}`)
  }

  const fileFormats: string[] = []
  for (const format of FILE_FORMATS) {
    // Upper-case tokens or dotted extensions, so "ai" in prose and "key" in a
    // sentence do not count; ".ai" and "AI" do.
    const pattern = new RegExp(
      `(?:^|[^A-Za-z0-9])(?:\\.${format.toLowerCase()}|${format})(?![A-Za-z0-9])`,
    )
    if (pattern.test(text)) fileFormats.push(format === "JPEG" ? "JPG" : format)
  }

  const lower = text.toLowerCase()
  const license = LICENSE_TERMS.filter((term) => lower.includes(term)).map((term) =>
    term.replace("licence", "license").replace("royalty free", "royalty-free"),
  )

  return {
    price: unique(price),
    dimensions: unique(dimensions),
    fileFormats: unique(fileFormats),
    license: unique(license),
  }
}

/**
 * The conflicts across a set of sources.
 *
 * A kind conflicts when at least two sources mention it and they do not state
 * the same set. One source mentioning a price and another saying nothing is
 * not a conflict — silence is not disagreement — and it is left to the claims
 * check, which already allows what a source stated.
 */
export function detectConflicts(sources: readonly LabelledEvidence[]): FactConflict[] {
  const facts = sources.map((source) => ({
    label: source.label,
    facts: readFacts(source.evidence),
  }))
  const conflicts: FactConflict[] = []

  for (const kind of CONFLICT_KINDS) {
    const mentioning = facts.filter((entry) => entry.facts[kind].length > 0)
    if (mentioning.length < 2) continue
    const signatures = new Set(mentioning.map((entry) => entry.facts[kind].join("|")))
    if (signatures.size < 2) continue

    const byValue = new Map<string, string[]>()
    for (const entry of mentioning) {
      for (const value of entry.facts[kind]) {
        byValue.set(value, [...(byValue.get(value) ?? []), entry.label])
      }
    }
    conflicts.push({
      kind,
      label: CONFLICT_KIND_LABELS[kind],
      values: [...byValue.entries()].map(([value, labels]) => ({ value, sources: labels })),
    })
  }

  return conflicts
}

/**
 * Patterns a draft must not match on its own authority, because sources
 * disagree about what they describe.
 *
 * Patterns rather than substrings, so "12" in "12 weights" is not taken for a
 * price and "ai" in "detail" is not taken for a file format.
 */
export function conflictPatterns(
  conflicts: readonly FactConflict[],
): { kind: ConflictKind; pattern: RegExp }[] {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const patterns: { kind: ConflictKind; pattern: RegExp }[] = []
  for (const conflict of conflicts) {
    for (const { value } of conflict.values) {
      if (conflict.kind === "price") {
        const amount = escape(value.split(" ")[1]!.replace(/\.00$/, ""))
        patterns.push({
          kind: "price",
          pattern: new RegExp(
            `[$€£¥]\\s?${amount}(?:\\.\\d{2})?(?!\\d)|\\b${amount}(?:\\.\\d{2})?\\s?(?:USD|EUR|GBP|CAD|AUD)\\b`,
            "i",
          ),
        })
      } else if (conflict.kind === "dimensions") {
        const [width, height] = value.split(" ")[0]!.split("×")
        patterns.push({
          kind: "dimensions",
          pattern: new RegExp(`\\b${escape(width!)}\\s?[x×]\\s?${escape(height!)}\\b`, "i"),
        })
      } else if (conflict.kind === "fileFormats") {
        patterns.push({
          kind: "fileFormats",
          pattern: new RegExp(
            `(?:^|[^A-Za-z0-9])(?:\\.${value.toLowerCase()}|${value})(?![A-Za-z0-9])`,
          ),
        })
      } else {
        patterns.push({
          kind: "license",
          pattern: new RegExp(escape(value).replace("-", "[- ]"), "i"),
        })
      }
    }
  }
  return patterns
}
