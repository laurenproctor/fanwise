import { fieldsAwaitingReview, listingIssues, LISTING_FIELD_LABELS } from "./draft"
import { joinWords } from "./prose"
import type {
  BuyerDeliverable,
  ExternalDeliveryApproval,
  LicenseSelection,
  ListingDraft,
  RightsAttestation,
  SourceSnapshot,
} from "./types"

/**
 * Import readiness: one calculation, five steps, read by every indicator.
 *
 * The progress track at the top of the screen and the checklist at the bottom
 * are two renderings of this one function's output. That is the point of it.
 * A screen whose bar and whose list are computed separately says 60% over a
 * list of two unfinished things soon enough, and a creator who catches it once
 * stops believing either.
 *
 * Three rules this shares with `lib/channels/readiness.ts`, deliberately, so
 * the two never mean different things by the same word:
 *
 *   1. `ready` is exactly "every required step complete". It is not the
 *      percentage crossing a threshold, because a threshold invites the idea
 *      that 80% is nearly publishable, and it is not.
 *   2. The percentage is for display and is never used in a comparison.
 *   3. A step is complete because something was measured, never because a
 *      screen was visited.
 *
 * What it deliberately does NOT share is the channel readiness type.
 * `computeReadiness()` counts unsatisfied error-severity requirement rules for
 * one channel; this counts five fixed steps for one import. Overloading one for
 * the other would make a channel's readiness and an import's readiness the same
 * number by accident, on a screen that shows both.
 */

export const IMPORT_STEP_KEYS = ["source", "listing", "buyerFiles", "license", "ownership"] as const
export type ImportStepKey = (typeof IMPORT_STEP_KEYS)[number]

export const IMPORT_STEP_COUNT = IMPORT_STEP_KEYS.length

/** Short, for the progress track, where five of them sit side by side. */
export const IMPORT_STEP_LABELS: Record<ImportStepKey, string> = {
  source: "Source",
  listing: "Listing",
  buyerFiles: "Buyer files",
  license: "License",
  ownership: "Ownership",
}

/** The imperative, for the checklist, where one of them is the next thing to do. */
export const IMPORT_STEP_ACTIONS: Record<ImportStepKey, string> = {
  source: "Add a source",
  listing: "Complete the listing",
  buyerFiles: "Upload customer files",
  license: "Choose license",
  ownership: "Confirm ownership",
}

export const IMPORT_STEP_DESCRIPTIONS: Record<ImportStepKey, string> = {
  source: "Paste a public link to the product you want to sell.",
  listing: "Name it, price it, and say what a buyer is getting.",
  buyerFiles: "Add the files buyers will receive (ZIP, PDF, etc.).",
  license: "Select or create a license for this product.",
  ownership: "Make sure you have the right to sell this product.",
}

export interface ImportStep {
  readonly key: ImportStepKey
  readonly label: string
  readonly action: string
  readonly description: string
  readonly complete: boolean
  /**
   * Why it is not complete, in one sentence a creator can act on. Null exactly
   * when `complete` is true, so a rendered step can never show both or neither.
   */
  readonly blockedBy: string | null
}

export interface ImportReadiness {
  /** Always five, always in `IMPORT_STEP_KEYS` order. */
  readonly steps: readonly ImportStep[]
  readonly completedCount: number
  readonly total: number
  /** `completedCount / 5` as a whole percentage: 0, 20, 40, 60, 80 or 100. */
  readonly percent: number
  readonly ready: boolean
  /** The first incomplete step. The checklist marks exactly this one. */
  readonly nextStep: ImportStepKey | null
  readonly remaining: number
  /**
   * The sentence shown beside a disabled action, or null when nothing is
   * blocked. Rendered next to the control, never instead of disabling it.
   */
  readonly blockedReason: string | null
}

/**
 * Everything the five steps are measured against.
 *
 * Every field is what was actually found, never what a screen believes. A
 * caller that cannot measure something passes the empty value and gets an
 * incomplete step, which is the honest answer.
 */
export interface ImportReadinessInput {
  /** The snapshot of a supported source, or null if nothing has been read. */
  readonly snapshot: SourceSnapshot | null
  readonly draft: ListingDraft
  readonly deliverables: readonly BuyerDeliverable[]
  /**
   * An approved way to deliver that is not a file Fanwise holds.
   *
   * Always null today: the canonical product model has no external-delivery
   * type, as `ASSET_TYPES` and `PRODUCT_TYPES` in `lib/products/types.ts` show.
   * The branch below is written as the conditional it is, rather than as a
   * count somebody must rewrite when such a type arrives.
   */
  readonly externalDelivery: ExternalDeliveryApproval | null
  readonly license: LicenseSelection | null
  readonly rights: RightsAttestation | null
}

function sourceStep(input: ImportReadinessInput): string | null {
  if (input.snapshot === null) return "No source has been analyzed yet."
  return null
}

function listingStep(input: ImportReadinessInput): string | null {
  const issues = listingIssues(input.draft)
  if (issues.length > 0) {
    const first = issues[0]!
    return issues.length === 1
      ? first.message
      : `${first.message} ${issues.length - 1} other field${issues.length === 2 ? "" : "s"} still needs attention.`
  }

  // Validation passing is not the whole of this step. A value a model proposed
  // is not a fact until a person has looked at it; see fieldsAwaitingReview().
  const awaiting = fieldsAwaitingReview(input.draft)
  if (awaiting.length > 0) {
    const names = awaiting.map((key) => LISTING_FIELD_LABELS[key].toLowerCase())
    const it = names.length === 1 ? "it" : "them"
    return `Review the suggested ${joinWords(names)} before Fanwise treats ${it} as yours.`
  }

  return null
}

function buyerFilesStep(input: ImportReadinessInput): string | null {
  if (input.externalDelivery !== null) return null
  // Only a measured file counts, exactly as the channel `asset` requirement
  // counts only `ready` rows. A pending upload is a promise about bytes nobody
  // has weighed.
  const ready = input.deliverables.filter((file) => file.state === "ready")
  if (ready.length > 0) return null

  const pending = input.deliverables.some((file) => file.state === "pending")
  if (pending) return "A file is still uploading. It counts once Fanwise has measured it."
  const failed = input.deliverables.some((file) => file.state === "failed")
  if (failed) return "The upload did not finish. Add the file buyers will receive."
  return "No buyer file yet. Add the file buyers will receive."
}

function licenseStep(input: ImportReadinessInput): string | null {
  if (input.license === null) return "No license chosen."
  if (input.license.summary.trim().length === 0) {
    return "The chosen license says nothing. Describe what a buyer may do."
  }
  return null
}

function ownershipStep(input: ImportReadinessInput): string | null {
  if (input.rights === null) return "You have not confirmed you can sell this."
  if (input.rights.attestedBy.trim().length === 0) {
    return "The rights confirmation records nobody. Confirm it while signed in."
  }
  return null
}

const CHECKS: Record<ImportStepKey, (input: ImportReadinessInput) => string | null> = {
  source: sourceStep,
  listing: listingStep,
  buyerFiles: buyerFilesStep,
  license: licenseStep,
  ownership: ownershipStep,
}

export function importReadiness(input: ImportReadinessInput): ImportReadiness {
  const steps: ImportStep[] = IMPORT_STEP_KEYS.map((key) => {
    const blockedBy = CHECKS[key](input)
    return {
      key,
      label: IMPORT_STEP_LABELS[key],
      action: IMPORT_STEP_ACTIONS[key],
      description: IMPORT_STEP_DESCRIPTIONS[key],
      complete: blockedBy === null,
      blockedBy,
    }
  })

  const completedCount = steps.filter((step) => step.complete).length
  const remaining = IMPORT_STEP_COUNT - completedCount
  const ready = remaining === 0

  return {
    steps,
    completedCount,
    total: IMPORT_STEP_COUNT,
    // Five steps divide 100 exactly, so this is already whole. Rounded anyway,
    // so that a sixth step added one day cannot produce 16.666 on the screen.
    percent: Math.round((completedCount / IMPORT_STEP_COUNT) * 100),
    ready,
    nextStep: steps.find((step) => !step.complete)?.key ?? null,
    remaining,
    blockedReason: ready
      ? null
      : `Complete ${remaining} required item${remaining === 1 ? "" : "s"} to continue.`,
  }
}

/**
 * Whether marketplace review may be reached. The one gate, and the only thing
 * any caller should ask.
 *
 * A separate exported function rather than `readiness.ready` read at each call
 * site, so that the rule has a name, a docstring and a test of its own, and so
 * that a component cannot accidentally gate on the percentage instead.
 */
export function canReviewMarketplaceDrafts(readiness: ImportReadiness): boolean {
  return readiness.ready
}
