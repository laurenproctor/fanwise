"use client"

import Link from "next/link"
import { useCallback, useEffect, useId, useReducer, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  checkFile,
  classifyInput,
  composerReducer,
  formatDuration,
  initialComposerState,
  readiness,
  type ComposerSource,
} from "@/lib/imports/composer"
import { IMPORT_LIMITS, megabytes } from "@/lib/imports/limits"
import {
  createImportDraftAction,
  removeStagedSourceAction,
  stagedSourceStatusesAction,
} from "@/lib/imports/composer-actions"
import { uploadComposerSource } from "@/lib/products/upload-client"
import { routes } from "@/lib/routes"
import { SourcePill } from "./source-pill"
import { useRecorder, type Recording } from "./use-recorder"

/**
 * One surface for everything a creator already has.
 *
 * A real textarea, real buttons and a real file input, laid out to read as one
 * field. Not a chat: nothing here is a message, nothing answers back, and the
 * only action is "Create draft".
 *
 * **What becomes a source, and when.** A link pasted or entered on its own
 * becomes a pill at once, and there is at most one. Anything else typed stays
 * text, and becomes a "Pasted text" source when the draft is created — a
 * paragraph that mentions a URL is still a paragraph. Files and recordings are
 * uploaded the moment they are added, so a pill's status is what the server
 * found, not what the browser hoped.
 *
 * The file bytes of each pill are kept in memory until the draft is created, so
 * a failed upload can be retried without choosing the file again.
 */

const POLL_MS = 1_500

/** An import id is a uuid; anything else is not somewhere to navigate. */
const isImportId = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

let keyCounter = 0
const nextKey = () => `source-${Date.now().toString(36)}-${(keyCounter += 1)}`

export function UniversalComposer({ workspaceSlug }: { workspaceSlug: string }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [state, dispatch] = useReducer(composerReducer, initialComposerState)
  const [text, setText] = useState("")
  const [submitError, setSubmitError] = useState<{ message: string; href?: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [submissionId] = useState(() => crypto.randomUUID())

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pillListRef = useRef<HTMLUListElement>(null)
  const bodies = useRef(new Map<string, { body: Blob; name: string }>())
  const stagedIds = useRef(new Map<string, string>())
  const dragDepth = useRef(0)
  // The poll reads the latest pills without re-arming its timer on every change.
  const sourcesRef = useRef(state.sources)
  useEffect(() => {
    sourcesRef.current = state.sources
  }, [state.sources])

  const textareaId = useId()
  const helperId = useId()
  const limitsId = useId()
  const errorId = useId()

  const typed = classifyInput(text)
  const gate = readiness(state, typed)

  /* ------------------------------------------------------------ uploads */

  const upload = useCallback(
    async (
      key: string,
      body: Blob,
      source: Parameters<typeof uploadComposerSource>[0]["source"],
    ) => {
      dispatch({ type: "uploadStarted", key })
      const result = await uploadComposerSource({
        workspaceSlug,
        body,
        source,
        onStaged: (sourceId) => stagedIds.current.set(key, sourceId),
      })

      // Removed while it uploaded: the row the server just made has no pill.
      if (!bodies.current.has(key)) {
        const orphan = "error" in result ? result.sourceId : result.sourceId
        if (orphan) void removeStagedSourceAction(workspaceSlug, orphan)
        return
      }
      if ("error" in result) {
        dispatch({
          type: "failed",
          key,
          message: result.error,
          retryable: result.sourceId !== null,
        })
        return
      }
      if (result.status === "failed") {
        dispatch({
          type: "failed",
          key,
          message: result.message ?? "That file could not be used.",
          retryable: false,
        })
        return
      }
      if (result.status === "transcribing") {
        dispatch({ type: "transcriptionStarted", key, sourceId: result.sourceId })
        return
      }
      dispatch({ type: "staged", key, sourceId: result.sourceId })
    },
    [workspaceSlug],
  )

  const addFiles = useCallback(
    (files: Iterable<File>) => {
      let added = 0
      for (const file of files) {
        const checked = checkFile(file)
        if (!checked.ok) {
          dispatch({ type: "refused", message: checked.message })
          continue
        }
        if (state.sources.length + added >= IMPORT_LIMITS.maxSources) {
          dispatch({
            type: "refused",
            message: `An import takes up to ${IMPORT_LIMITS.maxSources} sources.`,
          })
          break
        }
        const key = nextKey()
        bodies.current.set(key, { body: file, name: file.name })
        dispatch({
          type: "fileAdded",
          key,
          fileType: checked.type,
          name: file.name,
          byteSize: file.size,
        })
        void upload(key, file, { type: checked.type, filename: file.name })
        added += 1
      }
    },
    [state.sources.length, upload],
  )

  const onRecorded = useCallback(
    (recording: Recording) => {
      const key = nextKey()
      const label = `Product notes · ${formatDuration(recording.durationMs)}`
      bodies.current.set(key, { body: recording.blob, name: label })
      dispatch({ type: "recordingAdded", key, label, durationMs: recording.durationMs })
      void upload(key, recording.blob, {
        type: "audio",
        label,
        durationMs: Math.round(recording.durationMs),
        mimeType: recording.mimeType,
      })
    },
    [upload],
  )

  const recorder = useRecorder(onRecorded)

  const retry = useCallback(
    (source: ComposerSource) => {
      const kept = bodies.current.get(source.key)
      if (!kept || source.type === "link") return
      const staged = stagedIds.current.get(source.key)
      if (staged) {
        stagedIds.current.delete(source.key)
        void removeStagedSourceAction(workspaceSlug, staged)
      }
      void upload(
        source.key,
        kept.body,
        source.type === "audio"
          ? {
              type: "audio",
              label: source.label,
              durationMs: Math.round(source.durationMs),
              mimeType: kept.body.type || "audio/webm",
            }
          : { type: source.type, filename: kept.name },
      )
    },
    [upload, workspaceSlug],
  )

  const remove = useCallback(
    (source: ComposerSource, index: number) => {
      const staged = stagedIds.current.get(source.key)
      if (staged) void removeStagedSourceAction(workspaceSlug, staged)
      stagedIds.current.delete(source.key)
      bodies.current.delete(source.key)
      dispatch({ type: "removed", key: source.key })

      // Focus stays in the list: the pill that took this one's place, the one
      // before it, or the text box when the list is empty.
      requestAnimationFrame(() => {
        const buttons =
          pillListRef.current?.querySelectorAll<HTMLButtonElement>("button[data-remove]")
        const target = buttons?.[Math.min(index, (buttons?.length ?? 1) - 1)]
        if (target) target.focus()
        else textareaRef.current?.focus()
      })
    },
    [workspaceSlug],
  )

  /* -------------------------------------------------------- transcription */

  const transcribingKey = transcribingSources(state.sources)
    .map((source) => source.key)
    .join(",")

  useEffect(() => {
    if (!transcribingKey) return
    const timer = setInterval(async () => {
      const watched = transcribingSources(sourcesRef.current)
      const statuses = await stagedSourceStatusesAction(
        workspaceSlug,
        watched.map((source) => source.sourceId),
      )
      for (const status of statuses) {
        const source = watched.find((candidate) => candidate.sourceId === status.sourceId)
        if (!source) continue
        if (status.status === "staged" && status.transcribed) {
          dispatch({ type: "transcribed", key: source.key })
        } else if (status.status === "failed" || status.status === "removed") {
          dispatch({
            type: "failed",
            key: source.key,
            message: status.message ?? "That recording could not be transcribed.",
            retryable: false,
          })
        }
      }
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [transcribingKey, workspaceSlug])

  /* ---------------------------------------------------------- the text box */

  const takeLink = useCallback((value: string): boolean => {
    const classified = classifyInput(value)
    if (classified.kind === "link") {
      dispatch({ type: "linkAdded", key: nextKey(), url: classified.url })
      setText("")
      return true
    }
    if (classified.kind === "refused_link") {
      dispatch({ type: "refused", message: classified.message })
      return true
    }
    return false
  }, [])

  /* ------------------------------------------------------------ submitting */

  const submit = useCallback(async () => {
    if (submitting) return
    setSubmitError(null)
    if (!gate.canSubmit) {
      dispatch({ type: "announced", message: gate.reason ?? "" })
      return
    }

    const link = state.sources.find((source) => source.type === "link")
    const url = typed.kind === "link" ? typed.url : link && link.type === "link" ? link.url : null
    const stagedSourceIds = state.sources.flatMap((source) =>
      source.type !== "link" && source.sourceId ? [source.sourceId] : [],
    )

    setSubmitting(true)
    dispatch({ type: "announced", message: "Creating your draft." })
    const result = await createImportDraftAction(workspaceSlug, {
      submissionId,
      url,
      text: typed.kind === "text" ? text : null,
      stagedSourceIds,
    })

    if ("error" in result) {
      setSubmitting(false)
      setSubmitError(
        result.existingImportId && isImportId(result.existingImportId)
          ? {
              message: result.error,
              href: routes.productImport(workspaceSlug, result.existingImportId),
            }
          : { message: result.error },
      )
      dispatch({ type: "announced", message: result.error })
      return
    }
    if (!isImportId(result.importId)) {
      setSubmitting(false)
      setSubmitError({ message: "That draft could not be opened. Try again." })
      return
    }
    const href = routes.productImport(workspaceSlug, result.importId)
    startTransition(() => router.push(href))
  }, [gate, router, state.sources, submissionId, submitting, text, typed, workspaceSlug])

  /* ----------------------------------------------------------------- drop */

  const recording = recorder.state.kind === "recording" || recorder.state.kind === "paused"
  const recorderMessage =
    recorder.state.kind === "denied"
      ? "Microphone access was denied. Allow it in your browser's site settings, or type instead."
      : recorder.state.kind === "unsupported"
        ? "This browser cannot record audio here. Type or paste instead."
        : recorder.state.kind === "failed"
          ? "The recording did not work. Try again, or type instead."
          : null

  const error = submitError?.message ?? state.error ?? recorderMessage

  return (
    <div className="flex flex-col gap-5">
      <form
        aria-label="Product sources"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        onDragEnter={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return
          dragDepth.current += 1
          if (!dragging) {
            setDragging(true)
            dispatch({ type: "announced", message: "Drop PDF or HTML files to add them." })
          }
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) event.preventDefault()
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setDragging(false)
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.files.length) return
          event.preventDefault()
          dragDepth.current = 0
          setDragging(false)
          addFiles(Array.from(event.dataTransfer.files))
        }}
        className={`flex flex-col rounded-[18px] border bg-[var(--color-card)] px-4 pb-4 pt-5 transition-colors motion-reduce:transition-none sm:px-6 sm:pb-5 sm:pt-6 ${
          dragging
            ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
            : "border-[color-mix(in_srgb,var(--color-accent)_45%,var(--color-rule))] focus-within:border-[var(--color-accent)]"
        }`}
      >
        <label htmlFor={textareaId} className="sr-only">
          Product link or description
        </label>
        <textarea
          id={textareaId}
          ref={textareaRef}
          value={text}
          rows={1}
          autoFocus
          spellCheck
          aria-describedby={`${helperId} ${limitsId}${error ? ` ${errorId}` : ""}`}
          aria-invalid={typed.kind === "refused_link" || Boolean(state.error)}
          placeholder="Paste a product link or description…"
          onChange={(event) => {
            setText(event.target.value)
            if (state.error) dispatch({ type: "errorCleared" })
            setSubmitError(null)
          }}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData("text")
            const replacesAll =
              text.length === 0 ||
              (event.currentTarget.selectionStart === 0 &&
                event.currentTarget.selectionEnd === text.length)
            if (replacesAll && classifyInput(pasted).kind === "link") {
              event.preventDefault()
              takeLink(pasted)
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              void submit()
              return
            }
            if (event.key === "Enter" && !event.shiftKey && classifyInput(text).kind !== "text") {
              if (takeLink(text)) event.preventDefault()
            }
          }}
          className="max-h-[40vh] min-h-[2.25rem] w-full resize-none bg-transparent [field-sizing:content] font-display text-[clamp(1.125rem,2.2vw,1.375rem)] font-light leading-[1.4] tracking-[-0.01em] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-3)]"
        />
        <p id={helperId} className="mt-1 text-[14px] text-[var(--color-ink-2)]">
          Or attach a PDF or HTML file, or describe the product aloud.
        </p>
        <p id={limitsId} className="sr-only">
          Up to {IMPORT_LIMITS.maxSources} sources: one public link, PDFs up to{" "}
          {megabytes(IMPORT_LIMITS.maxPdfBytes)}, HTML files up to{" "}
          {megabytes(IMPORT_LIMITS.maxHtmlBytes)}, and recordings up to ten minutes.
        </p>

        {state.sources.length > 0 ? (
          <ul ref={pillListRef} aria-label="Added sources" className="mt-5 flex flex-wrap gap-3">
            {state.sources.map((source, index) => (
              <SourcePill
                key={source.key}
                source={source}
                onRemove={() => remove(source, index)}
                onRetry={source.type !== "link" && source.retryable ? () => retry(source) : null}
              />
            ))}
          </ul>
        ) : null}

        {recording ? (
          <RecordingStrip
            elapsedMs={
              recorder.state.kind === "recording" || recorder.state.kind === "paused"
                ? recorder.state.elapsedMs
                : 0
            }
            paused={recorder.state.kind === "paused"}
            onStop={recorder.stop}
            onCancel={() => {
              recorder.cancel()
              dispatch({ type: "announced", message: "Recording cancelled." })
            }}
            onPause={recorder.pause}
            onResume={recorder.resume}
          />
        ) : null}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.html,.htm,application/pdf,text/html"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(event) => {
                if (event.target.files) addFiles(Array.from(event.target.files))
                event.target.value = ""
                textareaRef.current?.focus()
              }}
            />
            <ToolButton
              label="Add PDF or HTML"
              onClick={() => fileInputRef.current?.click()}
              disabled={submitting}
              icon={<PlusGlyph />}
            />
            <ToolButton
              label={
                recorder.state.kind === "requesting"
                  ? "Allow the microphone…"
                  : recorder.state.kind === "processing"
                    ? "Finishing…"
                    : "Record"
              }
              onClick={() => void recorder.start()}
              disabled={
                submitting ||
                recording ||
                recorder.state.kind === "requesting" ||
                recorder.state.kind === "processing"
              }
              icon={<MicGlyph />}
            />
          </div>
          <button
            type="submit"
            aria-disabled={!gate.canSubmit || submitting}
            aria-describedby={gate.reason ? `${errorId}-gate` : undefined}
            className={`inline-flex min-h-[48px] items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--color-action)] bg-[var(--color-action)] px-[22px] text-[15px] font-medium text-[var(--color-on-action)] transition-colors hover:border-[var(--color-action-hover)] hover:bg-[var(--color-action-hover)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--color-accent)] motion-reduce:transition-none ${
              !gate.canSubmit || submitting ? "cursor-not-allowed opacity-50" : ""
            }`}
          >
            {submitting ? "Creating draft…" : "Create draft"}
            <ArrowGlyph />
          </button>
        </div>

        {gate.reason && (state.sources.length > 0 || typed.kind !== "empty") ? (
          <p
            id={`${errorId}-gate`}
            className="mt-3 text-right text-[13px] text-[var(--color-ink-3)]"
          >
            {gate.reason}
          </p>
        ) : gate.reason ? (
          <p id={`${errorId}-gate`} className="sr-only">
            {gate.reason}
          </p>
        ) : null}

        {error ? (
          <p id={errorId} role="alert" className="mt-3 text-[14px] text-[var(--color-ink)]">
            <span
              aria-hidden
              className="mr-2 inline-block h-[6px] w-[6px] rounded-full bg-[var(--color-bad)] align-middle"
            />
            {error}
            {submitError?.href ? (
              <>
                {" "}
                <Link
                  href={submitError.href}
                  className="font-medium text-[var(--color-accent)] underline underline-offset-4"
                >
                  Open that import
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
      </form>

      <p className="text-[13px] text-[var(--color-ink-2)]">
        PDF, HTML, public links, pasted text, and voice · Nothing is published until you review it.
      </p>

      {/* One polite region for everything that changes without a page load. */}
      <p role="status" aria-live="polite" className="sr-only">
        {recorder.state.kind === "recording"
          ? `Recording, ${formatDuration(recorder.state.elapsedMs).replace(":", " minutes ")} seconds.`
          : recorder.state.kind === "requesting"
            ? "Asking for the microphone."
            : state.announcement}
      </p>
    </div>
  )
}

/** Recordings the server is transcribing, with the row id the poll asks about. */
function transcribingSources(sources: readonly ComposerSource[]) {
  return sources.flatMap((source) =>
    source.type === "audio" && source.status === "transcribing" && source.sourceId
      ? [{ key: source.key, sourceId: source.sourceId }]
      : [],
  )
}

function ToolButton({
  label,
  onClick,
  disabled,
  icon,
}: {
  label: string
  onClick: () => void
  disabled: boolean
  icon: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group inline-flex min-h-11 items-center gap-3 rounded-[var(--radius-pill)] pr-2 text-[14px] text-[var(--color-ink-2)] hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        aria-hidden
        className="grid h-11 w-11 place-items-center rounded-full border border-[var(--color-rule)] bg-[var(--color-paper-2)] text-[var(--color-ink)] group-hover:border-[var(--color-ink-3)]"
      >
        {icon}
      </span>
      {label}
    </button>
  )
}

function RecordingStrip({
  elapsedMs,
  paused,
  onStop,
  onCancel,
  onPause,
  onResume,
}: {
  elapsedMs: number
  paused: boolean
  onStop: () => void
  onCancel: () => void
  onPause: () => void
  onResume: () => void
}) {
  const stopRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    stopRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onCancel])

  return (
    <div className="mt-5 flex flex-wrap items-center gap-3 rounded-[var(--radius-pill)] border border-[var(--color-rule)] py-1.5 pl-4 pr-1.5">
      <span
        aria-hidden
        className={`h-[8px] w-[8px] rounded-full bg-[var(--color-bad)] ${paused ? "" : "animate-pulse motion-reduce:animate-none"}`}
      />
      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-ink-2)]">
        {paused ? "Paused" : "Recording"}
      </span>
      <span className="font-mono text-[13px] tabular-nums text-[var(--color-ink)]">
        {formatDuration(elapsedMs)}
      </span>
      <span className="ml-auto flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={paused ? onResume : onPause}
          className="min-h-11 rounded-[var(--radius-pill)] px-4 text-[14px] text-[var(--color-ink-2)] hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        >
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded-[var(--radius-pill)] px-4 text-[14px] text-[var(--color-ink-2)] hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        >
          Cancel
        </button>
        <button
          ref={stopRef}
          type="button"
          onClick={onStop}
          className="min-h-11 rounded-[var(--radius-pill)] border border-[var(--color-rule)] px-4 text-[14px] font-medium text-[var(--color-ink)] hover:border-[var(--color-ink-3)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        >
          Stop
        </button>
      </span>
    </div>
  )
}

function PlusGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function MicGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect
        x="5.5"
        y="1.75"
        width="5"
        height="8"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        d="M3.25 7.5a4.75 4.75 0 0 0 9.5 0M8 12.25v2"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  )
}

function ArrowGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 8h10M9 4l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
