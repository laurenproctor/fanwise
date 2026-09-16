import type { ProductSourceEvidence } from "./evidence"
import { CONFLICT_KIND_LABELS, conflictPatterns, type FactConflict } from "./conflicts"
import { DRAFT_FIELDS, type DraftField, type DraftOutput } from "./draft-output"
import { DETAIL_LABELS, supportedDetails } from "./facts"

/**
 * What a draft may not claim on the strength of how a page looked.
 *
 * `lib/ai/factuality.ts` checks generated copy against a FactSheet derived from
 * a canonical product the creator filled in. There is no FactSheet here: the
 * product does not exist yet, and the only input is a page that Fanwise read
 * and nobody verified. So the check is narrower and sterner in a different
 * direction — not "is this number right" but "is this the kind of thing a
 * screenshot can establish at all".
 *
 * Six kinds of claim cannot be established by appearance, ever:
 *
 *   files         what a buyer receives, and in what formats
 *   compatibility what software or platform it works with
 *   licence       what a buyer may do with it
 *   support       what the seller promises afterwards
 *   ownership     who made it and who may sell it
 *   commercial    resale, redistribution, royalties
 *
 * A page can *state* any of these, and when it does the claim is allowed,
 * because then it is the page's claim and the creator can see where it came
 * from. What is refused is a model adding one that the page never made — a
 * licence nobody granted, a Figma compatibility nobody mentioned, a support
 * promise nobody offered.
 *
 * **A violation withdraws the wording rather than the draft.** Suggestions are
 * independent, and losing a whole draft because the long description drifted
 * into "royalty-free" would throw away nine good fields to punish one. For the
 * same reason a list loses the entry that made the claim and prose loses the
 * sentence, and the cleaned value is checked again from scratch. The whole
 * field is withheld only when that re-check still finds a claim, when nothing
 * worth offering is left, or when the field is one where a partial value would
 * mislead: a title, a product type, price guidance, or any field that states a
 * value the sources disagree about. Either way the creator is told, which is
 * more useful than a silent omission and much more useful than a quietly
 * invented licence.
 *
 * No model, no network, no clock. The same draft and the same evidence always
 * produce the same verdict.
 */

export type ClaimKind =
  | "files"
  | "compatibility"
  | "license"
  | "support"
  | "ownership"
  | "commercial"
  /** The draft states a fact the creator's sources disagree about. */
  | "conflict"
  /** A structured detail — a count, a format, a script — the sources do not contain. */
  | "unstated"

export interface ClaimViolation {
  field: DraftField
  kind: ClaimKind
  /** The phrase as it appeared, so a reviewer can find it. */
  phrase: string
  /**
   * What happened to the field: the offending entries or sentences were
   * `removed` and the rest offered, or the whole field was `withheld`.
   */
  resolution: "removed" | "withheld"
}

/**
 * Phrases that assert something appearance cannot establish.
 *
 * Multi-word wherever a single word would be ordinary English. "support" alone
 * appears in "supports dark mode", which is a feature and not a promise;
 * "customer support" is a promise. The bias is towards letting prose through
 * and catching assertions, because a false positive withholds a field a
 * creator can type themselves, while a false negative publishes a licence
 * nobody granted.
 */
const CLAIM_PHRASES: ReadonlyArray<readonly [ClaimKind, readonly string[]]> = [
  [
    "files",
    [
      "you will receive",
      "you'll receive",
      "download includes",
      "included files",
      "files included",
      "source files",
      "editable files",
      "layered file",
      "vector files",
      "zip file",
      "file formats",
      "comes with",
      "package includes",
    ],
  ],
  [
    "compatibility",
    [
      "works with",
      "compatible with",
      "works in",
      "supports adobe",
      "requires adobe",
      "opens in",
      "import into",
      "plugin for",
      "extension for",
    ],
  ],
  [
    "license",
    [
      "license",
      "licence",
      "licensed",
      "licensing",
      "royalty-free",
      "royalty free",
      "personal use only",
      "commercial use",
      "extended license",
      "sublicense",
    ],
  ],
  [
    "support",
    [
      "customer support",
      "email support",
      "dedicated support",
      "free updates",
      "lifetime updates",
      "money-back",
      "money back guarantee",
      "refund",
      "warranty",
      "we guarantee",
      "guaranteed",
    ],
  ],
  [
    "ownership",
    [
      "you own",
      "full ownership",
      "own the rights",
      "all rights",
      "copyright",
      "trademark",
      "original work by",
      "created by the seller",
    ],
  ],
  [
    "commercial",
    [
      "resell",
      "resale",
      "redistribute",
      "redistribution",
      "white label",
      "white-label",
      "unlimited use",
      "royalties",
      "print on demand",
    ],
  ],
]

/**
 * Every string in a draft field, so a claim cannot hide inside an array.
 *
 * The structured details are not swept for phrases: a count or a format name
 * is not prose, and `supportedDetails` checks each of them against the
 * sources on its own terms.
 */
function textOf(output: DraftOutput, field: DraftField): string[] {
  if (field === "details") return []
  const value: unknown = output[field].value
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string")
  if (value && typeof value === "object" && "rationale" in value) {
    return [String((value as { rationale: unknown }).rationale ?? "")]
  }
  return []
}

/**
 * Everything the page actually said, lower-cased, as one string.
 *
 * The allow-list. A claim found in a draft is permitted exactly when this
 * contains the same phrase, so the page is the authority and the model is only
 * ever repeating it.
 */
export function evidenceCorpus(evidence: ProductSourceEvidence): string {
  return [
    evidence.title?.value ?? "",
    evidence.summary?.value ?? "",
    ...evidence.visibleFeatures.value,
    evidence.productType?.value ?? "",
    // A document's prose is what it said. A claim it makes in paragraph four is
    // still its claim, and the creator can find it there.
    evidence.bodyText?.value ?? "",
  ]
    .join(" \n ")
    .toLowerCase()
}

export interface ClaimCheck {
  violations: ClaimViolation[]
  /** The fields that must not be offered at all. Deduplicated, in field order. */
  withheld: DraftField[]
  /**
   * The fields offered with some wording removed: an entry of a list, or a
   * sentence of prose. Deduplicated, in field order, and never also withheld.
   */
  trimmed: DraftField[]
  /**
   * The draft with every trimmed field replaced by its cleaned value. Withheld
   * fields are still present here; `withoutWithheldFields` takes them out.
   */
  cleaned: DraftOutput
}

export function checkDraftClaims(output: DraftOutput, evidence: ProductSourceEvidence): ClaimCheck {
  return checkDraftClaimsAgainst(output, [evidence], [])
}

/** Lists whose entries are independent, so one entry can go and the rest stay. */
const LIST_FIELDS = [
  "features",
  "useCases",
  "tags",
  "technicalRequirements",
] as const satisfies readonly DraftField[]

/** Prose whose sentences are independent enough that one can go and the rest stay. */
const PROSE_FIELDS = [
  "shortDescription",
  "longDescription",
  "audience",
] as const satisfies readonly DraftField[]

function isListField(field: DraftField): field is (typeof LIST_FIELDS)[number] {
  return (LIST_FIELDS as readonly DraftField[]).includes(field)
}

function isProseField(field: DraftField): field is (typeof PROSE_FIELDS)[number] {
  return (PROSE_FIELDS as readonly DraftField[]).includes(field)
}

interface Sweep {
  corpus: string
  patterns: ReturnType<typeof conflictPatterns>
}

/** The claims in one piece of text, before anything is decided about them. */
function claimsIn(
  field: DraftField,
  text: string,
  sweep: Sweep,
): Omit<ClaimViolation, "resolution">[] {
  const found: Omit<ClaimViolation, "resolution">[] = []
  const haystack = text.toLowerCase()
  for (const [kind, phrases] of CLAIM_PHRASES) {
    for (const phrase of phrases) {
      if (!haystack.includes(phrase)) continue
      // The page said it too, so it is the page's claim, not an invention.
      if (sweep.corpus.includes(phrase)) continue
      found.push({ field, kind, phrase })
    }
  }
  for (const { kind, pattern } of sweep.patterns) {
    const match = pattern.exec(text)
    if (match) {
      found.push({
        field,
        kind: "conflict",
        phrase: `${CONFLICT_KIND_LABELS[kind]}: ${match[0].trim()}`,
      })
    }
  }
  return found
}

/**
 * A sentence boundary: whitespace after a full stop, question or exclamation
 * mark, allowing a closing quote or bracket. Whitespace is required, so "2.5"
 * and "v1.0" are not boundaries. A misplaced split only makes the removed piece
 * smaller or larger; the re-check afterwards is what keeps it safe.
 */
const SENTENCE_BOUNDARY = /(?<=[.!?…]["'”’)\]]*)\s+/

/** Enough of a value left to be worth offering: a few letters, not a stray mark. */
function isMeaningful(text: string): boolean {
  return (text.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 3
}

/** Prose with every sentence that makes a claim taken out. Paragraphs and lines kept. */
function withoutClaimingSentences(field: DraftField, text: string, sweep: Sweep): string {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph
        .split("\n")
        .map((line) =>
          line
            .split(SENTENCE_BOUNDARY)
            .filter((sentence) => claimsIn(field, sentence, sweep).length === 0)
            .join(" ")
            .trim(),
        )
        .filter((line) => line.length > 0)
        .join("\n"),
    )
    .filter((paragraph) => paragraph.length > 0)
    .join("\n\n")
}

/**
 * The field with its claiming entries or sentences removed, or null when the
 * whole field has to go. Null for every field that is not a list or prose.
 */
function cleanedEntry(output: DraftOutput, field: DraftField, sweep: Sweep): DraftOutput | null {
  const next: DraftOutput = { ...output }

  if (isListField(field)) {
    const kept = next[field].value.filter((item) => claimsIn(field, item, sweep).length === 0)
    if (kept.length === 0) return null
    next[field] = { ...next[field], value: kept }
  } else if (isProseField(field)) {
    const kept = withoutClaimingSentences(field, next[field].value, sweep)
    if (!isMeaningful(kept)) return null
    next[field] = { ...next[field], value: kept }
  } else {
    return null
  }

  // Checked again as a whole, exactly as the original was. Anything still found
  // — a phrase that straddled a split, a claim the split could not isolate —
  // withholds the field.
  const remaining = textOf(next, field).flatMap((text) => claimsIn(field, text, sweep))
  return remaining.length === 0 ? next : null
}

/**
 * The same check over several sources, with their disagreements.
 *
 * A claim is allowed when any source stated it — the allow-list is the union
 * of what every readable source said, because a licence stated in the PDF is
 * the creator's own statement wherever it came from. A value two sources state
 * differently is refused in every field, whichever source it matches: agreeing
 * with one of them is exactly the silent pick this exists to stop.
 */
export function checkDraftClaimsAgainst(
  output: DraftOutput,
  evidence: readonly ProductSourceEvidence[],
  conflicts: readonly FactConflict[],
): ClaimCheck {
  const sweep: Sweep = {
    corpus: evidence.map(evidenceCorpus).join(" \n "),
    patterns: conflictPatterns(conflicts),
  }
  const found = new Map<DraftField, Omit<ClaimViolation, "resolution">[]>()
  const note = (violation: Omit<ClaimViolation, "resolution">) =>
    found.set(violation.field, [...(found.get(violation.field) ?? []), violation])

  for (const field of DRAFT_FIELDS) {
    for (const text of textOf(output, field)) {
      for (const violation of claimsIn(field, text, sweep)) note(violation)
    }
  }

  // A price the sources disagree about is withheld even as a bare number,
  // which the text patterns above cannot see.
  if (conflicts.some((conflict) => conflict.kind === "price")) {
    const amount = output.priceGuidance?.value.amount
    if (typeof amount === "number") {
      note({ field: "priceGuidance", kind: "conflict", phrase: `Price: ${amount}` })
    }
  }

  const violations: ClaimViolation[] = []
  const withheld: DraftField[] = []
  const trimmed: DraftField[] = []
  let cleaned = output

  /*
   * The details, value by value. A detail the sources do not contain is
   * removed and the rest offered; the field is never withheld, because an
   * empty set of details is a true statement about a page that gave none.
   */
  if (output.details) {
    const checked = supportedDetails(output.details.value, sweep.corpus)
    if (checked.dropped.length > 0) {
      cleaned = { ...cleaned, details: { ...cleaned.details, value: checked.details } }
      trimmed.push("details")
      for (const item of checked.dropped) {
        violations.push({
          field: "details",
          kind: "unstated",
          phrase: `${DETAIL_LABELS[item.field]}: ${item.value}`,
          resolution: "removed",
        })
      }
    }
  }

  for (const field of DRAFT_FIELDS) {
    const claims = found.get(field)
    if (!claims) continue
    // A value the sources disagree about is never trimmed around: the rest of a
    // sentence built on the disputed number is not trustworthy either.
    const next = claims.some((claim) => claim.kind === "conflict")
      ? null
      : cleanedEntry(cleaned, field, sweep)
    if (next) {
      cleaned = next
      trimmed.push(field)
    } else {
      withheld.push(field)
    }
    const resolution = next ? "removed" : "withheld"
    for (const claim of claims) violations.push({ ...claim, resolution })
  }

  return { violations, withheld, trimmed, cleaned }
}

/** What to tell a creator about wording that was removed or withheld. One sentence each. */
export const CLAIM_KIND_REASONS: Record<ClaimKind, string> = {
  files: "it described files a buyer would receive, which the page did not list.",
  compatibility: "it named software the product works with, which the page did not mention.",
  license: "it described licence terms, which only you can set.",
  support: "it promised support or updates, which only you can offer.",
  ownership: "it made a claim about who owns the work, which only you can make.",
  commercial: "it described resale or redistribution rights, which only you can grant.",
  conflict: "your sources disagree about it, so the value is yours to choose.",
  unstated: "it stated a detail your sources do not contain.",
}

/**
 * The draft with every withheld field removed.
 *
 * Removed rather than blanked: an empty suggestion renders as a model that had
 * nothing to say, and this is a model that said something it was not entitled
 * to. The difference matters on the screen, where a withheld field is named.
 */
export function withoutWithheldFields(
  output: DraftOutput,
  withheld: readonly DraftField[],
): Partial<DraftOutput> & Pick<DraftOutput, "missingInformation"> {
  const kept: Record<string, unknown> = { missingInformation: output.missingInformation }
  for (const field of DRAFT_FIELDS) {
    if (withheld.includes(field)) continue
    kept[field] = output[field]
  }
  return kept as Partial<DraftOutput> & Pick<DraftOutput, "missingInformation">
}
