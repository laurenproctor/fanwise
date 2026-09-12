import type { RecoveryAction } from "./types"

/**
 * Why an import did not produce a draft, as a code.
 *
 * Rule 8, applied to a page nobody owns: the code and a sentence Fanwise wrote
 * reach the creator, and the original — a status line, a body, a thrown socket
 * error — reaches a server log the browser cannot see. Nothing here is a
 * provider's own words, and nothing here is a status code.
 *
 * The set is closed and the database repeats it as a check constraint, because
 * an unknown code reaching the screen is a creator looking at a failure with no
 * way out of it, and that is the most likely way this feature fails a person.
 * `RECOVERIES` below is the other half: every code names what to do instead.
 *
 * `unavailable` and `failed` are not the same thing and the split is the whole
 * value of this file. Unavailable is the source: private, gone, not a page.
 * Retrying changes nothing and the creator needs a different door. Failed is
 * Fanwise or the network between: retrying is free and often works.
 */

export const IMPORT_ERROR_CODES = [
  /** The page asked whoever opened it to sign in. */
  "login_required",
  /** The page is shared inside an organization Fanwise is not in. */
  "organization_only",
  /** Nothing is published at that address. */
  "not_found",
  /** The link was published once and has lapsed. */
  "expired",
  /** Fanwise has no adapter that can read this kind of link. */
  "unsupported_source",
  /** The address answered with something that is not a web page. */
  "not_html",
  /** The answer was larger than the reader will hold. */
  "too_large",
  /** The host did not answer inside the deadline. */
  "timeout",
  /** The host could not be reached or resolved. */
  "unreachable",
  /** The address, or something it redirected to, is not on the public internet. */
  "blocked_address",
  /** The chain of redirects ran longer than the budget. */
  "too_many_redirects",
  /** The host answered, with an error of its own. */
  "provider_error",
  /** The page was read; no model is configured to draft from it. */
  "ai_unavailable",
  /** Anything that escaped the mapping. Always logged, never explained away. */
  "internal",
] as const

export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number]

/**
 * Which codes describe Fanwise rather than the source, and are therefore worth
 * trying again unchanged.
 *
 * `ai_unavailable` is here for a reason worth stating: the page was read and
 * the evidence is kept, so a retry composes a draft from evidence already in
 * hand rather than reading anything again.
 */
const RETRYABLE = new Set<ImportErrorCode>([
  "timeout",
  "unreachable",
  "provider_error",
  "ai_unavailable",
  "internal",
])

export function isRetryableImportError(code: ImportErrorCode): boolean {
  return RETRYABLE.has(code)
}

/**
 * Which of the two unhappy statuses a code belongs to.
 *
 * The database holds `(status in ('unavailable','failed')) = (error_code is not
 * null)`, and this is what decides which of the two a runner writes.
 */
export function statusForImportError(code: ImportErrorCode): "unavailable" | "failed" {
  return isRetryableImportError(code) ? "failed" : "unavailable"
}

/** The sentence a creator reads. Fanwise's words, every time. */
export const IMPORT_ERROR_MESSAGES: Record<ImportErrorCode, string> = {
  login_required: "That link asks whoever opens it to sign in, so Fanwise cannot read it.",
  organization_only:
    "That link is shared inside an organization only. Fanwise is not a member of it.",
  not_found: "Nothing is published at that link. It may have been deleted or renamed.",
  expired: "That link has expired. Publish it again and paste the new one.",
  unsupported_source:
    "Fanwise could not read anything from that page. Some pages only show their content once a browser runs their code, and Fanwise never runs a page's code.",
  not_html: "That address is a file rather than a page, so there is nothing to read from it.",
  too_large: "That page is larger than Fanwise will read. Try a link to the page itself.",
  timeout: "That page did not answer in time. Nothing was saved, so trying again is safe.",
  unreachable: "Fanwise could not reach that address. Check the link and try again.",
  blocked_address:
    "That link points somewhere Fanwise cannot reach from the internet, so it was not opened.",
  too_many_redirects: "That link redirected too many times for Fanwise to follow.",
  provider_error:
    "The site answered with an error of its own. Nothing was saved, so trying again is safe.",
  ai_unavailable:
    "Fanwise read the page but has no model configured to draft from it. The details are yours to write.",
  internal:
    "Fanwise could not finish reading that link. Nothing was saved, so trying again is safe.",
}

/**
 * What a creator can do about each code, in the order it should be offered.
 *
 * Every list ends with `continue_manually`, which is the one recovery that
 * cannot itself fail, and no list is empty. A test asserts both, because an
 * empty list here is a dead end on the screen.
 */
export const IMPORT_ERROR_RECOVERIES: Record<ImportErrorCode, readonly RecoveryAction[]> = {
  login_required: ["publish_public_link", "paste_code", "upload_files", "continue_manually"],
  organization_only: ["publish_public_link", "paste_code", "upload_files", "continue_manually"],
  not_found: ["replace_link", "upload_files", "continue_manually"],
  expired: ["publish_public_link", "replace_link", "continue_manually"],
  /*
    Only what is built. Pasting the code is the right answer for a page that
    renders in a browser, and it is listed here the day it exists; until then a
    row of "Not built yet" above the two working options makes a dead end out
    of a path that has one.
  */
  unsupported_source: ["replace_link", "continue_manually"],
  not_html: ["replace_link", "upload_files", "continue_manually"],
  too_large: ["replace_link", "upload_files", "continue_manually"],
  timeout: ["retry", "continue_manually"],
  unreachable: ["retry", "replace_link", "continue_manually"],
  blocked_address: ["replace_link", "continue_manually"],
  too_many_redirects: ["replace_link", "continue_manually"],
  provider_error: ["retry", "continue_manually"],
  ai_unavailable: ["retry", "continue_manually"],
  internal: ["retry", "continue_manually"],
}

/**
 * The error a failed import carries, with the original kept off it.
 *
 * The `cause` is passed to `Error` so a server log can print it; nothing
 * reading this for the screen ever looks past `code` and `userMessage`.
 */
export class ImportError extends Error {
  readonly code: ImportErrorCode
  readonly userMessage: string

  constructor(code: ImportErrorCode, cause?: unknown) {
    super(IMPORT_ERROR_MESSAGES[code], cause === undefined ? undefined : { cause })
    this.name = "ImportError"
    this.code = code
    this.userMessage = IMPORT_ERROR_MESSAGES[code]
  }

  get retryable(): boolean {
    return isRetryableImportError(this.code)
  }
}

/**
 * Anything that escaped a reader, as an `ImportError`.
 *
 * Keeps nothing of the original but its name. A thrown value from an HTTP
 * client can carry the request it was making, and that request carried a URL a
 * creator pasted; the log gets it, the row does not.
 */
export function normalizeImportError(error: unknown): ImportError {
  if (error instanceof ImportError) return error
  const name = error instanceof Error ? error.name : "unknown"
  return new ImportError("internal", { name })
}
