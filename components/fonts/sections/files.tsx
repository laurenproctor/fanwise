"use client"

import { useEffect, useRef, useState, type DragEvent } from "react"
import { deleteAssetAction } from "@/lib/products/actions"
import { uploadProductFile } from "@/lib/products/upload-client"
import { useBackgroundRefresh } from "@/lib/use-background-refresh"
import {
  FONT_PROBLEM_TEXT,
  WIDTH_NAMES,
  formatFromFilename,
  weightLabel,
} from "@/lib/fonts/detected"
import { FIELD_IDS } from "@/lib/fonts/readiness"
import type { FontFileView } from "@/lib/fonts/workspace"
import type { AssetType } from "@/lib/products/types"
import type { SectionContext } from "../context"
import {
  LINK_BUTTON_CLASS,
  QUIET_BUTTON_CLASS,
  SectionHeading,
  StatusIcon,
  formatBytes,
} from "../controls"
import type { SectionStatus } from "@/lib/fonts/readiness"

/**
 * The files a buyer downloads.
 *
 * Each upload is its own small state machine, kept here and not in the
 * product autosave: a four-megabyte family uploading does not hold up a typo
 * fix in the description, and a failed upload never marks the form unsaved.
 *
 *   uploading   bytes going to storage, straight from the browser
 *   processing  stored; the finalize job is measuring and reading it
 *   failed      the transfer did not complete; the file is still in the queue
 *
 * Once the job has settled, the row is the server's and the local entry goes.
 *
 * Replacing is upload-first. The old file is removed only after the new one is
 * ready, which is also the only order the database allows for a product's last
 * buyer file.
 */

const ACCEPT = ".otf,.ttf,.woff,.woff2,.zip,.pdf"

type Accepted = { assetType: AssetType } | { rejected: string }

function classify(file: File): Accepted {
  const name = file.name.toLowerCase()
  if (formatFromFilename(name)) return { assetType: "deliverable" }
  if (name.endsWith(".zip")) return { assetType: "archive" }
  if (name.endsWith(".pdf")) {
    return { assetType: /licen[cs]e|eula|terms/.test(name) ? "license" : "documentation" }
  }
  if (name.endsWith(".ttc") || name.endsWith(".otc")) {
    return { rejected: "Font collections are not supported. Upload each face as OTF or TTF." }
  }
  return { rejected: "Not a font file. Upload OTF, TTF, WOFF, WOFF2, a ZIP package or a PDF." }
}

interface LocalUpload {
  localId: string
  file: File
  assetType: AssetType
  state: "uploading" | "processing" | "failed"
  assetId: string | null
  error: string | null
  /** The file this one replaces, removed once this one is ready. */
  replaces: string | null
}

interface Notice {
  id: string
  filename: string
  message: string
  /** A file skipped as a likely duplicate can still be uploaded on purpose. */
  retry?: File
}

export function FontFilesSection({ ctx }: { ctx: SectionContext }) {
  const { files, family } = ctx
  const [uploads, setUploads] = useState<LocalUpload[]>([])
  const [notices, setNotices] = useState<Notice[]>([])
  const [dragging, setDragging] = useState(false)
  const [confirming, setConfirming] = useState<FontFileView | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const [announcement, setAnnouncement] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const replaceRef = useRef<HTMLInputElement>(null)
  const replaceTarget = useRef<FontFileView | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)

  const serverById = new Map(files.map((file) => [file.id, file]))
  const processing =
    uploads.some((u) => u.state === "processing") || files.some((f) => f.state === "pending")
  useBackgroundRefresh(processing)

  // Queued means started and not yet settled: a batch still going through
  // `startAll` counts here before its later files have a row at all.
  const [queued, setQueued] = useState(0)
  const inFlight = queued > 0 || uploads.some((u) => u.state !== "failed")
  const transferring = uploads.some((u) => u.state === "uploading")
  const { setUploadsBusy } = ctx
  useEffect(() => setUploadsBusy(inFlight), [inFlight, setUploadsBusy])

  // Bytes still leaving the browser are lost with the tab. Processing is not:
  // the stored file finishes on the server whether or not anyone is watching.
  useEffect(() => {
    if (!transferring && queued === 0) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [transferring, queued])

  const patch = (localId: string, changes: Partial<LocalUpload>) =>
    setUploads((current) => current.map((u) => (u.localId === localId ? { ...u, ...changes } : u)))

  /*
   * Settle local rows against what the server now says, whenever a refresh
   * brings new rows. Adjusted during render rather than in an effect, so the
   * finished upload's row and the server's row are never both on screen. A
   * replacement that is ready queues the removal of the file it replaces; the
   * removal itself is a server call, so it runs in the effect below.
   */
  const [seenFiles, setSeenFiles] = useState(files)
  const [removals, setRemovals] = useState<Array<{ assetId: string; filename: string }>>([])
  if (seenFiles !== files) {
    setSeenFiles(files)
    const byId = new Map(files.map((file) => [file.id, file]))
    const settled = uploads.filter((u) => {
      if (u.state !== "processing" || !u.assetId) return false
      const server = byId.get(u.assetId)
      return server !== undefined && server.state !== "pending"
    })
    if (settled.length > 0) {
      setUploads((current) => current.filter((u) => !settled.includes(u)))
      setRemovals((current) => [
        ...current,
        ...settled.flatMap((u) =>
          u.replaces && byId.get(u.assetId!)?.state === "ready"
            ? [{ assetId: u.replaces, filename: u.file.name }]
            : [],
        ),
      ])
      setAnnouncement(
        settled
          .map((u) =>
            byId.get(u.assetId!)?.state === "ready"
              ? `${u.file.name} is ready.`
              : `${u.file.name} could not be processed.`,
          )
          .join(" "),
      )
    }
  }

  const removalsStarted = useRef(new Set<string>())
  const { workspaceSlug, refresh } = ctx
  useEffect(() => {
    for (const removal of removals) {
      if (removalsStarted.current.has(removal.assetId)) continue
      removalsStarted.current.add(removal.assetId)
      void deleteAssetAction(workspaceSlug, removal.assetId).then((result) => {
        setRemovals((current) => current.filter((r) => r.assetId !== removal.assetId))
        if (result.error) {
          setNotices((n) => [
            ...n,
            {
              id: crypto.randomUUID(),
              filename: removal.filename,
              message: `Uploaded, but the file it replaces could not be removed: ${result.error}`,
            },
          ])
        }
        refresh()
      })
    }
  }, [removals, workspaceSlug, refresh])

  async function start(file: File, options: { replaces?: string; allowDuplicate?: boolean } = {}) {
    const accepted = classify(file)
    if ("rejected" in accepted) {
      setNotices((n) => [
        ...n,
        { id: crypto.randomUUID(), filename: file.name, message: accepted.rejected },
      ])
      return
    }

    if (!options.allowDuplicate && !options.replaces) {
      const twin = files.find((f) => f.filename === file.name && f.byteSize === file.size)
      const queued = uploads.find((u) => u.file.name === file.name && u.file.size === file.size)
      if (twin || queued) {
        setNotices((n) => [
          ...n,
          {
            id: crypto.randomUUID(),
            filename: file.name,
            message: "Skipped: a file with this name and size is already here.",
            retry: file,
          },
        ])
        return
      }
    }

    const localId = crypto.randomUUID()
    setUploads((current) => [
      ...current,
      {
        localId,
        file,
        assetType: accepted.assetType,
        state: "uploading",
        assetId: null,
        error: null,
        replaces: options.replaces ?? null,
      },
    ])
    setAnnouncement(`Uploading ${file.name}.`)

    try {
      const result = await uploadProductFile({
        workspaceSlug: ctx.workspaceSlug,
        productId: ctx.productId,
        assetType: accepted.assetType,
        file,
      })
      if (result.error) {
        patch(localId, { state: "failed", assetId: result.assetId, error: result.error })
        setAnnouncement(`${file.name} did not upload.`)
        return
      }
      patch(localId, { state: "processing", assetId: result.assetId })
      ctx.refresh()
    } catch {
      patch(localId, {
        state: "failed",
        error: "The upload was interrupted. Check your connection and try again.",
      })
      setAnnouncement(`${file.name} did not upload.`)
    }
  }

  async function startAll(list: FileList | File[]) {
    // One at a time: a family is many small files, and parallel PUTs mostly
    // compete with each other on a creator's upload link.
    const batch = Array.from(list)
    setQueued((n) => n + batch.length)
    for (const file of batch) {
      try {
        await start(file)
      } finally {
        setQueued((n) => n - 1)
      }
    }
  }

  async function discard(upload: LocalUpload) {
    setUploads((current) => current.filter((u) => u.localId !== upload.localId))
    // An interrupted upload leaves a pending row with no bytes behind it.
    if (upload.assetId) {
      await deleteAssetAction(ctx.workspaceSlug, upload.assetId)
      ctx.refresh()
    }
  }

  async function retry(upload: LocalUpload) {
    await discard(upload)
    await start(upload.file, { replaces: upload.replaces ?? undefined, allowDuplicate: true })
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    if (event.dataTransfer.files.length > 0) void startAll(event.dataTransfer.files)
  }

  async function confirmRemove() {
    if (!confirming) return
    setRemoving(true)
    setRemoveError(null)
    const result = await deleteAssetAction(ctx.workspaceSlug, confirming.id)
    setRemoving(false)
    if (result.error) {
      setRemoveError(result.error)
      return
    }
    setAnnouncement(`${confirming.filename} removed.`)
    dialogRef.current?.close()
    setConfirming(null)
    ctx.refresh()
  }

  // A local row until the server lists the asset; after that the server row,
  // which says "Processing…" itself while the job runs, is the only one shown.
  // A failed transfer keeps its local row (with Try again) even though its
  // empty pending asset is listed, and that asset's own row is hidden.
  const localOnly = uploads.filter(
    (u) => u.state === "failed" || !(u.assetId && serverById.has(u.assetId)),
  )
  const failedAssetIds = new Set(
    uploads.flatMap((u) => (u.state === "failed" && u.assetId ? [u.assetId] : [])),
  )
  const fonts = files.filter((file) => file.kind === "font")
  const readable = fonts.filter((file) => file.reading.kind === "font")

  return (
    <div
      className="flex flex-col gap-6"
      onDragOver={(event) => {
        // The whole section accepts a drop, so a near miss never navigates the
        // browser to the file and away from unsaved work.
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <SectionHeading
        title="Font files"
        description="What buyers download. Fanwise reads each file for its family, style and coverage."
      />

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <div
        id={FIELD_IDS.fileDrop}
        tabIndex={-1}
        className={`flex flex-col items-center gap-3 rounded-[12px] border border-dashed px-6 py-8 text-center outline-none transition-colors ${
          dragging
            ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
            : "border-[var(--color-rule)]"
        }`}
      >
        <p className="text-[15px]">Drop font files here</p>
        <p className="text-[13px] text-[var(--color-ink-3)]">
          OTF, TTF, WOFF and WOFF2, including variable fonts. A ZIP package or a PDF specimen or
          license can go here too.
        </p>
        <button
          type="button"
          className={QUIET_BUTTON_CLASS}
          onClick={() => inputRef.current?.click()}
        >
          Choose files
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            if (event.target.files) void startAll(event.target.files)
            event.target.value = ""
          }}
        />
        <input
          ref={replaceRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            const target = replaceTarget.current
            event.target.value = ""
            if (file && target) void start(file, { replaces: target.id })
          }}
        />
      </div>

      {notices.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label="Upload notices">
          {notices.map((notice) => (
            <li
              key={notice.id}
              className="flex flex-wrap items-center justify-between gap-2 border-l-2 border-[var(--color-warn)] bg-[var(--color-paper-2)] py-2 pr-2 pl-3 text-[13.5px]"
            >
              <span>
                <span className="font-medium">{notice.filename}</span> — {notice.message}
              </span>
              <span className="flex gap-2">
                {notice.retry ? (
                  <button
                    type="button"
                    className={LINK_BUTTON_CLASS}
                    onClick={() => {
                      setNotices((n) => n.filter((x) => x.id !== notice.id))
                      void start(notice.retry!, { allowDuplicate: true })
                    }}
                  >
                    Upload anyway
                  </button>
                ) : null}
                <button
                  type="button"
                  className={LINK_BUTTON_CLASS}
                  onClick={() => setNotices((n) => n.filter((x) => x.id !== notice.id))}
                >
                  Dismiss<span className="sr-only"> notice about {notice.filename}</span>
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {readable.length > 0 ? (
        <p className="text-[14px] text-[var(--color-ink-2)]">
          Detected from {readable.length} {readable.length === 1 ? "file" : "files"}:{" "}
          <span className="text-[var(--color-ink)]">
            {[
              family.familyNames.join(" / "),
              `${family.styles.length} ${family.styles.length === 1 ? "style" : "styles"}`,
              family.glyphCount ? `${family.glyphCount.toLocaleString()} glyphs` : null,
              family.isVariable ? "variable" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </p>
      ) : null}

      <div id={FIELD_IDS.fileList} tabIndex={-1} className="outline-none">
        {files.length === 0 && localOnly.length === 0 ? (
          <p className="text-[14px] text-[var(--color-ink-3)]">No files uploaded yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--color-rule-2)] border-y border-[var(--color-rule)]">
            {localOnly.map((upload) => (
              <LocalRow
                key={upload.localId}
                upload={upload}
                onRetry={() => void retry(upload)}
                onDiscard={() => void discard(upload)}
              />
            ))}
            {files
              .filter((file) => !failedAssetIds.has(file.id))
              .map((file) => (
                <FileRow
                  key={file.id}
                  file={file}
                  replacing={uploads.some((u) => u.replaces === file.id)}
                  onReplace={() => {
                    replaceTarget.current = file
                    replaceRef.current?.click()
                  }}
                  onRemove={() => {
                    setConfirming(file)
                    setRemoveError(null)
                    dialogRef.current?.showModal()
                  }}
                />
              ))}
          </ul>
        )}
      </div>

      <p className="text-[12.5px] text-[var(--color-ink-3)]">
        ZIP packages are delivered as uploaded. Fanwise does not unpack them, so upload the font
        files themselves as well if you want their details detected.
      </p>

      <dialog
        ref={dialogRef}
        aria-labelledby="remove-file-title"
        onClose={() => setConfirming(null)}
        className="m-auto w-[min(460px,calc(100vw-2rem))] rounded-[14px] border border-[var(--color-rule)] bg-[var(--color-paper)] p-6 text-[var(--color-ink)] backdrop:bg-black/30"
      >
        <h2 id="remove-file-title" className="font-display text-[20px] font-light">
          Remove {confirming?.filename}?
        </h2>
        <p className="mt-2 text-[14px] text-[var(--color-ink-2)]">
          Buyers will no longer receive this file. Listings already published keep what they were
          sent until you publish again.
        </p>
        {removeError ? (
          <p role="alert" className="mt-3 text-[13.5px] text-[var(--color-danger)]">
            {removeError}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <form method="dialog">
            <button type="submit" className={QUIET_BUTTON_CLASS} autoFocus>
              Cancel
            </button>
          </form>
          <button
            type="button"
            disabled={removing}
            onClick={() => void confirmRemove()}
            className="inline-flex min-h-9 items-center rounded-[var(--radius-pill)] border border-[var(--color-danger)] bg-[var(--color-danger)] px-3.5 text-[13.5px] text-[var(--color-on-danger)] hover:bg-[var(--color-danger-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:opacity-50"
          >
            {removing ? "Removing…" : "Remove file"}
          </button>
        </div>
      </dialog>
    </div>
  )
}

function rowStatus(file: FontFileView): { status: SectionStatus; text: string } {
  if (file.state === "pending") return { status: "incomplete", text: "Processing…" }
  if (file.state === "failed") {
    return { status: "error", text: file.failureReason ?? "The upload could not be verified." }
  }
  if (file.duplicateOf) return { status: "attention", text: `Duplicate of ${file.duplicateOf}` }
  if (file.reading.kind === "problem") {
    return { status: "error", text: FONT_PROBLEM_TEXT[file.reading.problem] }
  }
  if (file.kind === "archive") return { status: "complete", text: "Package, not inspected" }
  if (file.kind === "document") {
    return {
      status: "complete",
      text: file.assetType === "license" ? "License document" : "Document",
    }
  }
  if (file.reading.kind === "font") return { status: "complete", text: "Valid font" }
  return { status: "incomplete", text: "Not read yet" }
}

function FileRow({
  file,
  replacing,
  onReplace,
  onRemove,
}: {
  file: FontFileView
  replacing: boolean
  onReplace: () => void
  onRemove: () => void
}) {
  const { status, text } = rowStatus(file)
  const font = file.reading.kind === "font" ? file.reading.font : null
  const style = font ? [font.familyName, font.styleName].filter(Boolean).join(" · ") : null

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-[14rem] flex-col gap-0.5">
          <p className="break-all text-[14px]">{file.filename}</p>
          <p className="text-[12.5px] text-[var(--color-ink-3)]">
            <span className="font-mono text-[11px] tracking-[0.08em] uppercase">
              {file.format ??
                (file.kind === "archive" ? "zip" : file.kind === "document" ? "pdf" : "—")}
            </span>
            <span className="tabular-nums"> · {formatBytes(file.byteSize)}</span>
            {" · "}
            {style ?? (file.kind === "font" ? "Family and style unknown" : "Not a font file")}
          </p>
        </div>
        <span className="flex shrink-0 gap-1.5">
          <button
            type="button"
            className={QUIET_BUTTON_CLASS}
            onClick={onReplace}
            disabled={replacing || file.state === "pending"}
            aria-label={`Replace ${file.filename}`}
          >
            Replace
          </button>
          <button
            type="button"
            className={QUIET_BUTTON_CLASS}
            onClick={onRemove}
            aria-label={`Remove ${file.filename}`}
          >
            Remove
          </button>
        </span>
      </div>
      <p className="flex items-start gap-1.5 text-[13px] text-[var(--color-ink-2)]">
        <StatusIcon status={status} size={16} />
        <span>{replacing ? "Replacement uploading…" : text}</span>
      </p>

      {font ? (
        <details className="text-[12.5px]">
          <summary className="w-fit cursor-pointer text-[var(--color-ink-3)] hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]">
            Detected details<span className="sr-only"> for {file.filename}</span>
          </summary>
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-[var(--color-ink-2)] sm:grid-cols-3">
            <Detail term="PostScript name" value={font.postscriptName} />
            <Detail term="Weight" value={weightLabel(font.weight)} />
            <Detail term="Width" value={font.width ? WIDTH_NAMES[font.width] : undefined} />
            <Detail
              term="Italic"
              value={font.italic === undefined ? undefined : font.italic ? "Yes" : "No"}
            />
            <Detail term="Version" value={font.version} />
            <Detail term="Glyphs" value={font.glyphCount?.toLocaleString()} />
            <Detail
              term="Variable axes"
              value={
                font.axes.length > 0
                  ? font.axes.map((a) => `${a.tag} ${a.min}–${a.max}`).join(", ")
                  : "None"
              }
            />
            <Detail term="Scripts" value={font.scripts.join(", ") || undefined} />
            <Detail
              term="OpenType features"
              value={font.features.length ? String(font.features.length) : "None"}
            />
            <Detail
              term="Embedding"
              value={
                font.embedding
                  ? {
                      installable: "Installable",
                      editable: "Editable",
                      preview_print: "Preview & print",
                      restricted: "Restricted",
                    }[font.embedding]
                  : undefined
              }
            />
          </dl>
        </details>
      ) : null}
    </li>
  )
}

function Detail({ term, value }: { term: string; value: string | undefined }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-[var(--color-ink-3)]">{term}</dt>
      <dd className="truncate text-[var(--color-ink)]">{value ?? "Not found"}</dd>
    </div>
  )
}

function LocalRow({
  upload,
  onRetry,
  onDiscard,
}: {
  upload: LocalUpload
  onRetry?: () => void
  onDiscard?: () => void
}) {
  const label =
    upload.state === "uploading"
      ? upload.replaces
        ? "Uploading replacement…"
        : "Uploading…"
      : upload.state === "processing"
        ? "Processing…"
        : (upload.error ?? "The upload did not complete.")
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-[14px]">{upload.file.name}</p>
        <p className="text-[12.5px] text-[var(--color-ink-3)] tabular-nums">
          {formatBytes(upload.file.size)}
        </p>
      </div>
      <span className="flex items-center gap-1.5 text-[12.5px] text-[var(--color-ink-2)]">
        {upload.state === "failed" ? (
          <StatusIcon status="error" size={16} />
        ) : (
          <span
            aria-hidden
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--color-rule)] border-t-[var(--color-accent)] motion-reduce:animate-none"
          />
        )}
        {label}
      </span>
      {upload.state === "failed" ? (
        <span className="flex gap-1.5">
          <button type="button" className={QUIET_BUTTON_CLASS} onClick={onRetry}>
            Try again<span className="sr-only"> uploading {upload.file.name}</span>
          </button>
          <button type="button" className={QUIET_BUTTON_CLASS} onClick={onDiscard}>
            Dismiss<span className="sr-only"> {upload.file.name}</span>
          </button>
        </span>
      ) : null}
    </li>
  )
}
