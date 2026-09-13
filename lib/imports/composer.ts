import { IMPORT_LIMITS, megabytes } from "./limits"
import { validateSourceUrl } from "./url"

/**
 * The composer's rules, without React.
 *
 * What counts as a link, which files are accepted, how many sources fit, and
 * the state of every pill. Pure and synchronous, so each rule is a table a test
 * can enumerate and the component is only ever rendering an answer.
 */

/* ------------------------------------------------------------ what was typed */

export type TypedInput =
  | { kind: "empty" }
  | { kind: "link"; url: string }
  /** It is shaped like a link and the importer refuses it; say why. */
  | { kind: "refused_link"; message: string }
  | { kind: "text"; text: string }

/**
 * Whether the whole input is one standalone link.
 *
 * Only an explicit scheme counts. `validateSourceUrl` helpfully reads
 * `example.com/a` as a link, which is right for a field labelled "Product
 * link" and wrong here: "notes.txt" and "Version 2.0" would become links. And
 * only the whole trimmed value counts, never a URL found inside prose — a
 * paragraph that mentions a link is still a paragraph the creator wrote.
 */
export function classifyInput(raw: string): TypedInput {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return { kind: "empty" }
  if (/\s/.test(trimmed) || !/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return { kind: "text", text: raw }
  }
  const checked = validateSourceUrl(trimmed)
  return checked.ok
    ? { kind: "link", url: checked.url }
    : { kind: "refused_link", message: checked.message }
}

/** How a link reads in a pill: host and path, no scheme, no query noise. */
export function linkLabel(url: string): string {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "")
    return `${parsed.hostname.replace(/^www\./, "")}${path}`.slice(0, 255)
  } catch {
    return url.slice(0, 255)
  }
}

/* ------------------------------------------------------------------- files */

export type FileSourceType = "pdf" | "html"

export type FileCheck = { ok: true; type: FileSourceType } | { ok: false; message: string }

/**
 * A chosen or dropped file, checked by name and size.
 *
 * A courtesy that saves an upload. The server sniffs the stored bytes and its
 * answer decides; a `.pdf` that is really a zip is refused there.
 */
export function checkFile(file: { name: string; size: number }): FileCheck {
  const name = file.name.toLowerCase()
  const type: FileSourceType | null = name.endsWith(".pdf")
    ? "pdf"
    : name.endsWith(".html") || name.endsWith(".htm")
      ? "html"
      : null
  if (!type) return { ok: false, message: `${file.name} is not a PDF or HTML file.` }
  if (file.size === 0) return { ok: false, message: `${file.name} is empty.` }
  const max = type === "pdf" ? IMPORT_LIMITS.maxPdfBytes : IMPORT_LIMITS.maxHtmlBytes
  if (file.size > max) {
    return {
      ok: false,
      message: `${file.name} is larger than ${megabytes(max)}, the most Fanwise reads from ${type === "pdf" ? "a PDF" : "an HTML file"}.`,
    }
  }
  return { ok: true, type }
}

/** `01:24`, for a recording's length. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

/* ------------------------------------------------------------------- pills */

/**
 * One source in the composer.
 *
 * The status is what is true now, in the creator's words. `Transcribed` exists
 * only after the server said so; a recording that has merely stopped is
 * `recorded`. A pill with no server row yet has no `sourceId`.
 */
export type PillStatus =
  | "ready"
  | "recorded"
  | "uploading"
  | "checking"
  | "transcribing"
  | "transcribed"
  | "needs_attention"

export type ComposerSource =
  | { key: string; type: "link"; url: string; label: string; status: "ready" }
  | {
      key: string
      type: FileSourceType
      label: string
      byteSize: number
      status: PillStatus
      sourceId: string | null
      message: string | null
      /** Whether trying the upload again could help. A refusal of the file itself could not. */
      retryable: boolean
    }
  | {
      key: string
      type: "audio"
      label: string
      durationMs: number
      status: PillStatus
      sourceId: string | null
      message: string | null
      retryable: boolean
    }

export const PILL_STATUS_WORDS: Record<PillStatus, string> = {
  ready: "Ready",
  recorded: "Recorded",
  uploading: "Uploading",
  checking: "Checking",
  transcribing: "Transcribing",
  transcribed: "Transcribed",
  needs_attention: "Needs attention",
}

/** The tone of a status dot. The word beside it carries the meaning. */
export function pillTone(status: PillStatus): "ok" | "busy" | "bad" {
  if (status === "ready" || status === "transcribed") return "ok"
  if (status === "needs_attention") return "bad"
  return "busy"
}

export interface ComposerState {
  sources: ComposerSource[]
  /** The last thing worth announcing, for the live region. */
  announcement: string
  /** A refusal that belongs to the composer rather than to one pill. */
  error: string | null
}

export type ComposerEvent =
  | { type: "linkAdded"; key: string; url: string }
  | { type: "fileAdded"; key: string; fileType: FileSourceType; name: string; byteSize: number }
  | { type: "recordingAdded"; key: string; label: string; durationMs: number }
  | { type: "uploadStarted"; key: string }
  | { type: "staged"; key: string; sourceId: string }
  | { type: "stageCleared"; key: string; sourceId: string }
  | { type: "transcriptionStarted"; key: string; sourceId: string }
  | { type: "transcribed"; key: string }
  | { type: "failed"; key: string; message: string; retryable: boolean }
  | { type: "removed"; key: string }
  | { type: "refused"; message: string }
  | { type: "announced"; message: string }
  | { type: "errorCleared" }

export const initialComposerState: ComposerState = { sources: [], announcement: "", error: null }

/** Sources counted against the limit. A pasted text is counted by the caller. */
export function sourceCount(state: ComposerState): number {
  return state.sources.length
}

function update(
  state: ComposerState,
  key: string,
  change: (source: ComposerSource) => ComposerSource,
  announcement?: (source: ComposerSource) => string,
): ComposerState {
  const target = state.sources.find((source) => source.key === key)
  // An event for a pill that was removed meanwhile changes nothing: the upload
  // that finishes after its pill is gone must not bring the pill back.
  if (!target) return state
  const next = change(target)
  return {
    ...state,
    sources: state.sources.map((source) => (source.key === key ? next : source)),
    announcement: announcement ? announcement(next) : state.announcement,
  }
}

function withStatus(
  source: ComposerSource,
  status: PillStatus,
  extra: { sourceId?: string | null; message?: string | null; retryable?: boolean } = {},
): ComposerSource {
  if (source.type === "link") return source
  return {
    ...source,
    status,
    ...(extra.sourceId !== undefined ? { sourceId: extra.sourceId } : {}),
    message: extra.message === undefined ? null : extra.message,
    retryable: extra.retryable ?? false,
  }
}

export function composerReducer(state: ComposerState, event: ComposerEvent): ComposerState {
  switch (event.type) {
    case "linkAdded": {
      const existing = state.sources.find((source) => source.type === "link")
      const link: ComposerSource = {
        key: event.key,
        type: "link",
        url: event.url,
        label: linkLabel(event.url),
        status: "ready",
      }
      if (existing) {
        // One link per import. A second one replaces the first, in place.
        return {
          ...state,
          error: null,
          sources: state.sources.map((source) => (source.key === existing.key ? link : source)),
          announcement: `Link replaced with ${link.label}.`,
        }
      }
      if (state.sources.length >= IMPORT_LIMITS.maxSources) {
        return { ...state, error: `An import takes up to ${IMPORT_LIMITS.maxSources} sources.` }
      }
      return {
        ...state,
        error: null,
        sources: [...state.sources, link],
        announcement: `Link added: ${link.label}.`,
      }
    }
    case "fileAdded":
    case "recordingAdded": {
      if (state.sources.length >= IMPORT_LIMITS.maxSources) {
        return { ...state, error: `An import takes up to ${IMPORT_LIMITS.maxSources} sources.` }
      }
      const source: ComposerSource =
        event.type === "fileAdded"
          ? {
              key: event.key,
              type: event.fileType,
              label: event.name,
              byteSize: event.byteSize,
              status: "uploading",
              sourceId: null,
              message: null,
              retryable: false,
            }
          : {
              key: event.key,
              type: "audio",
              label: event.label,
              durationMs: event.durationMs,
              status: "recorded",
              sourceId: null,
              message: null,
              retryable: false,
            }
      return {
        ...state,
        error: null,
        sources: [...state.sources, source],
        announcement:
          event.type === "fileAdded"
            ? `${event.name} added. Uploading.`
            : `${event.label} recorded.`,
      }
    }
    case "uploadStarted":
      return update(
        state,
        event.key,
        // A retry starts from nothing on the server: the failed row was removed.
        (source) => withStatus(source, "uploading", { sourceId: null }),
        (source) => `${source.label} uploading.`,
      )
    case "staged":
      return update(
        state,
        event.key,
        (source) => withStatus(source, "ready", { sourceId: event.sourceId }),
        (source) => `${source.label} ready.`,
      )
    case "stageCleared":
      return update(state, event.key, (source) =>
        withStatus(source, "checking", { sourceId: event.sourceId }),
      )
    case "transcriptionStarted":
      return update(
        state,
        event.key,
        (source) => withStatus(source, "transcribing", { sourceId: event.sourceId }),
        (source) => `${source.label} transcribing.`,
      )
    case "transcribed":
      return update(
        state,
        event.key,
        (source) => withStatus(source, "transcribed"),
        (source) => `${source.label} transcribed.`,
      )
    case "failed":
      return update(
        state,
        event.key,
        (source) =>
          withStatus(source, "needs_attention", {
            message: event.message,
            retryable: event.retryable,
          }),
        (source) => `${source.label} needs attention. ${event.message}`,
      )
    case "removed": {
      const target = state.sources.find((source) => source.key === event.key)
      if (!target) return state
      return {
        ...state,
        error: null,
        sources: state.sources.filter((source) => source.key !== event.key),
        announcement: `${target.label} removed.`,
      }
    }
    case "refused":
      return { ...state, error: event.message, announcement: event.message }
    case "announced":
      return { ...state, announcement: event.message }
    case "errorCleared":
      return { ...state, error: null }
  }
}

/**
 * Whether "Create draft" can be pressed, and if not, why.
 *
 * A pill still uploading or transcribing blocks the button rather than being
 * left behind, and a pill that needs attention blocks it until the creator
 * removes it: submitting around a failure would drop a source they added
 * without saying so.
 */
export function readiness(
  state: ComposerState,
  typed: TypedInput,
): { canSubmit: boolean; reason: string | null } {
  if (typed.kind === "refused_link") return { canSubmit: false, reason: typed.message }
  if (state.sources.some((source) => source.status === "needs_attention")) {
    return { canSubmit: false, reason: "Remove the source that needs attention to continue." }
  }
  if (
    state.sources.some((source) =>
      ["uploading", "checking", "transcribing", "recorded"].includes(source.status),
    )
  ) {
    return { canSubmit: false, reason: "Waiting for your sources to finish." }
  }
  const hasTyped = typed.kind === "text" || typed.kind === "link"
  const extra = typed.kind === "text" && typed.text.length > IMPORT_LIMITS.maxPasteCharacters
  if (extra) {
    return {
      canSubmit: false,
      reason: `Pasted text is limited to ${IMPORT_LIMITS.maxPasteCharacters.toLocaleString("en-US")} characters.`,
    }
  }
  const total = state.sources.length + (typed.kind === "text" ? 1 : 0)
  if (total > IMPORT_LIMITS.maxSources) {
    return {
      canSubmit: false,
      reason: `An import takes up to ${IMPORT_LIMITS.maxSources} sources.`,
    }
  }
  if (state.sources.length === 0 && !hasTyped) {
    return { canSubmit: false, reason: "Add a link, some text, a file or a recording." }
  }
  return { canSubmit: true, reason: null }
}
