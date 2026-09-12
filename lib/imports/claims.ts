import type { ProductSourceEvidence } from "./evidence"
import { DRAFT_FIELDS, type DraftField, type DraftOutput } from "./draft-output"

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
 * **A violation withdraws the field rather than the draft.** Suggestions are
 * independent, and losing a whole draft because the long description drifted
 * into "royalty-free" would throw away nine good fields to punish one. The
 * withheld field is named to the creator, which is more useful than a silent
 * omission and much more useful than a quietly invented licence.
 *
 * No model, no network, no clock. The same draft and the same evidence always
 * produce the same verdict.
 */

export type ClaimKind =
  "files" | "compatibility" | "license" | "support" | "ownership" | "commercial"

export interface ClaimViolation {
  field: DraftField
  kind: ClaimKind
  /** The phrase as it appeared, so a reviewer can find it. */
  phrase: string
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

/** Every string in a draft field, so a claim cannot hide inside an array. */
function textOf(output: DraftOutput, field: DraftField): string[] {
  const entry = output[field]
  const value = entry.value
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
  /** The fields that must not be offered. Deduplicated, in field order. */
  withheld: DraftField[]
}

export function checkDraftClaims(output: DraftOutput, evidence: ProductSourceEvidence): ClaimCheck {
  const corpus = evidenceCorpus(evidence)
  const violations: ClaimViolation[] = []

  for (const field of DRAFT_FIELDS) {
    for (const text of textOf(output, field)) {
      const haystack = text.toLowerCase()
      for (const [kind, phrases] of CLAIM_PHRASES) {
        for (const phrase of phrases) {
          if (!haystack.includes(phrase)) continue
          // The page said it too, so it is the page's claim, not an invention.
          if (corpus.includes(phrase)) continue
          violations.push({ field, kind, phrase })
        }
      }
    }
  }

  const withheld = DRAFT_FIELDS.filter((field) =>
    violations.some((violation) => violation.field === field),
  )

  return { violations, withheld }
}

/** What to tell a creator about a field that was withheld. One sentence each. */
export const CLAIM_KIND_REASONS: Record<ClaimKind, string> = {
  files: "it described files a buyer would receive, which the page did not list.",
  compatibility: "it named software the product works with, which the page did not mention.",
  license: "it described licence terms, which only you can set.",
  support: "it promised support or updates, which only you can offer.",
  ownership: "it made a claim about who owns the work, which only you can make.",
  commercial: "it described resale or redistribution rights, which only you can grant.",
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
