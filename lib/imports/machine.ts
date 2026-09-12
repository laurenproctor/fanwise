import type {
  ListingDraft,
  RecoveryOption,
  SourceAnalysis,
  SourceSnapshot,
  UnavailableReason,
} from "./types"
import { validateSourceUrl } from "./url"

/**
 * The source panel's state machine.
 *
 * A reducer rather than a handful of booleans in a component, for the usual
 * reason and one specific one. The usual reason: `isLoading && !error &&
 * snapshot === null` is a state nobody named, and there are six of those here.
 * The specific one: every failure on this screen has to offer a way out of
 * itself, and a machine makes "which state has no exit" a question a test can
 * ask. `RECOVERABLE` just above the reducer is that test's subject.
 *
 * Pure and synchronous. The service that actually reads a link lives behind
 * `service.ts`; this only ever learns what it answered.
 */

/**
 * What the analyzer is doing right now.
 *
 * Named stages and no percentage, deliberately. A determinate bar over work
 * whose length is unknown is a number the screen made up, and the one thing a
 * creator remembers is the bar that sat at 90% for a minute. The stages say
 * what is happening; none of them claims how much is left.
 */
export const ANALYZING_STAGES = ["connecting", "reading", "extracting"] as const
export type AnalyzingStage = (typeof ANALYZING_STAGES)[number]

export const ANALYZING_STAGE_LABELS: Record<AnalyzingStage, string> = {
  connecting: "Opening the link",
  reading: "Reading the page",
  extracting: "Pulling out the details",
}

export type ImportState =
  | { readonly status: "empty"; readonly url: string; readonly error: string | null }
  | { readonly status: "validating"; readonly url: string }
  | { readonly status: "analyzing"; readonly url: string; readonly stage: AnalyzingStage }
  | {
      readonly status: "analyzed"
      readonly url: string
      readonly snapshot: SourceSnapshot
      readonly draft: ListingDraft
    }
  | {
      readonly status: "private"
      readonly url: string
      readonly reason: UnavailableReason
      readonly message: string
      readonly recoveries: readonly RecoveryOption[]
    }
  | {
      readonly status: "notFound"
      readonly url: string
      readonly reason: UnavailableReason
      readonly message: string
      readonly recoveries: readonly RecoveryOption[]
    }
  | {
      readonly status: "unsupported"
      readonly url: string
      readonly message: string
      readonly recoveries: readonly RecoveryOption[]
    }
  | {
      readonly status: "failed"
      readonly url: string
      readonly message: string
      readonly recoveries: readonly RecoveryOption[]
    }

export type ImportStatus = ImportState["status"]

export type ImportEvent =
  | { readonly type: "urlChanged"; readonly url: string }
  /** The creator asked for the link to be read. Validation runs next. */
  | { readonly type: "submitted" }
  | { readonly type: "validationFailed"; readonly message: string }
  | { readonly type: "validationPassed"; readonly url: string }
  | { readonly type: "stageAdvanced"; readonly stage: AnalyzingStage }
  | { readonly type: "analysisSettled"; readonly analysis: SourceAnalysis }
  /** Try the same link again, from a recoverable failure. */
  | { readonly type: "retried" }
  /** Put the field back, keeping what was typed, so a bad link can be corrected. */
  | { readonly type: "linkReplaced" }
  /** A field was edited on an analyzed draft. */
  | { readonly type: "draftChanged"; readonly draft: ListingDraft }

export function initialImportState(url = ""): ImportState {
  return { status: "empty", url, error: null }
}

/**
 * Which unavailable reasons belong to which screen.
 *
 * Two states rather than one, because the recovery differs in kind. A link
 * nobody but its owner can open is fixed by publishing it; a link that is gone
 * cannot be fixed at all, and offering "make it public" for a 404 sends a
 * creator to look for a setting that would not have helped.
 */
const LOCKED: readonly UnavailableReason[] = ["private", "login_required", "organization_only"]

function settle(url: string, analysis: SourceAnalysis): ImportState {
  switch (analysis.outcome) {
    case "analyzed":
      return { status: "analyzed", url, snapshot: analysis.snapshot, draft: analysis.draft }
    case "unavailable":
      return LOCKED.includes(analysis.reason)
        ? {
            status: "private",
            url,
            reason: analysis.reason,
            message: analysis.message,
            recoveries: analysis.recoveries,
          }
        : {
            status: "notFound",
            url,
            reason: analysis.reason,
            message: analysis.message,
            recoveries: analysis.recoveries,
          }
    case "unsupported":
      return {
        status: "unsupported",
        url,
        message: analysis.message,
        recoveries: analysis.recoveries,
      }
    case "failed":
      return { status: "failed", url, message: analysis.message, recoveries: analysis.recoveries }
  }
}

/**
 * The states a retry may be attempted from.
 *
 * `failed` alone. A private link retried unchanged is private again, and a
 * retry button that changes nothing is worse than no button: it reads as though
 * the creator did something wrong the first time. Those states offer a
 * different way out instead, which is what `recoveries` carries.
 */
export const RECOVERABLE: readonly ImportStatus[] = ["failed"]

export function importReducer(state: ImportState, event: ImportEvent): ImportState {
  switch (event.type) {
    case "urlChanged":
      // Typing clears the previous complaint. Leaving it up while the field
      // changes underneath it is how a form ends up scolding you for something
      // you already fixed.
      return { status: "empty", url: event.url, error: null }

    case "submitted":
      return state.status === "empty" ? { status: "validating", url: state.url } : state

    case "validationFailed":
      return state.status === "validating"
        ? { status: "empty", url: state.url, error: event.message }
        : state

    case "validationPassed":
      return state.status === "validating"
        ? { status: "analyzing", url: event.url, stage: "connecting" }
        : state

    case "stageAdvanced":
      return state.status === "analyzing" ? { ...state, stage: event.stage } : state

    case "analysisSettled":
      // Only an in-flight analysis may settle. An answer that arrives after the
      // creator has already replaced the link is an answer about a URL nobody
      // is looking at, and applying it would overwrite what they are typing.
      return state.status === "analyzing" ? settle(state.url, event.analysis) : state

    case "retried":
      return RECOVERABLE.includes(state.status)
        ? { status: "analyzing", url: state.url, stage: "connecting" }
        : state

    case "linkReplaced":
      return { status: "empty", url: state.url, error: null }

    case "draftChanged":
      return state.status === "analyzed" ? { ...state, draft: event.draft } : state
  }
}

/** Whether the screen is waiting on something. Drives the busy affordances. */
export function isBusy(state: ImportState): boolean {
  return state.status === "validating" || state.status === "analyzing"
}

/** The snapshot, when one has been read. Null in every other state. */
export function snapshotOf(state: ImportState): SourceSnapshot | null {
  return state.status === "analyzed" ? state.snapshot : null
}

/**
 * Runs the pasted URL through the shape check and turns the answer into the
 * next event. Separated from the component so a test can drive validation and
 * the reducer together without rendering anything.
 */
export function validationEvent(url: string): ImportEvent {
  const checked = validateSourceUrl(url)
  return checked.ok
    ? { type: "validationPassed", url: checked.url }
    : { type: "validationFailed", message: checked.message }
}
