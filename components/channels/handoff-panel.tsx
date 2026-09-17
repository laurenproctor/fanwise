"use client"

import { useState, useSyncExternalStore, type MouseEvent } from "react"
import type { HandoffFile, HandoffStep } from "@/lib/channels/handoff"
import { routes } from "@/lib/routes"

/**
 * The fields a creator copies into an assisted channel's own editor, in order.
 *
 * One component, and it assumes nothing about its width: it renders the same on
 * the listing page and in the companion window, at 320 pixels or at a full
 * column. That is the layout rule docs/companion-window.md §3 asks for.
 *
 * Nothing here says Publish, and nothing implies Fanwise did anything on the
 * channel. The creator submits; this is what they submit from.
 *
 * Steps that name a section are grouped under it, numbered as one, because a
 * channel whose editor has parts wants the creator to move through those
 * parts top to bottom in both windows. Steps that name none are numbered
 * themselves, as the generic handoff has always been.
 */

const noSubscription = () => () => {}

const COPY_FAILED = "Could not copy from this window. Select the text and copy it by hand."

interface Group {
  section: string | null
  steps: HandoffStep[]
}

/** Consecutive steps that share a section, in order. */
export function groupSteps(steps: readonly HandoffStep[]): Group[] {
  const groups: Group[] = []
  for (const step of steps) {
    const section = step.section ?? null
    const last = groups[groups.length - 1]
    if (last && last.section === section && section !== null) last.steps.push(step)
    else groups.push({ section, steps: [step] })
  }
  return groups
}

export function HandoffPanel({
  workspaceSlug,
  channelName,
  productName,
  readiness,
  steps,
}: {
  workspaceSlug: string
  channelName: string
  productName: string
  readiness: { resolved: number; total: number } | null
  steps: HandoffStep[]
}) {
  // Held until the next copy, so the creator can see where they are in the
  // sequence after looking away to the marketplace.
  const [copied, setCopied] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  // Downloads are absolute URLs once in the browser. The companion window's
  // document is not at the page's address, and a relative link resolved there
  // would go nowhere. The server render has no origin and keeps relative ones.
  const origin = useSyncExternalStore(
    noSubscription,
    () => window.location.origin,
    () => "",
  )

  async function copy(
    event: MouseEvent<HTMLButtonElement>,
    key: string,
    value: string,
    html?: string,
  ) {
    // The clipboard of the window the button is in. In the companion that is
    // the companion's own, and the page's would refuse: a clipboard write needs
    // its document to have focus, and the click just gave focus to the other.
    const clipboard = event.currentTarget.ownerDocument.defaultView?.navigator.clipboard
    try {
      if (!clipboard) throw new Error("no clipboard")
      // Formatted text where the step carries it, with the plain value as
      // the fallback for a field that takes only text. A browser without
      // ClipboardItem gets the plain value, which is still the right words.
      const view = event.currentTarget.ownerDocument.defaultView
      const Item = view && "ClipboardItem" in view ? view.ClipboardItem : undefined
      if (html && view && Item && typeof clipboard.write === "function") {
        await clipboard.write([
          new Item({
            "text/html": new view.Blob([html], { type: "text/html" }),
            "text/plain": new view.Blob([value], { type: "text/plain" }),
          }),
        ])
      } else {
        await clipboard.writeText(value)
      }
      setCopied(key)
      setFailed(null)
    } catch {
      setFailed(key)
    }
  }

  function downloadHref(file: HandoffFile): string {
    const base = `${origin}${routes.assetDownload(workspaceSlug, file.assetId)}`
    return file.downloadAs ? `${base}?name=${encodeURIComponent(file.downloadAs)}` : base
  }

  const groups = groupSteps(steps)
  const sectioned = groups.some((group) => group.section !== null)

  function renderStep(step: HandoffStep, index: number | null) {
    return (
      <li
        key={step.key}
        className={
          index === null
            ? "grid gap-1.5 border-t border-[var(--color-rule-2)] pt-3"
            : "grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2 border-t border-[var(--color-rule-2)] pt-3"
        }
      >
        {index === null ? null : (
          <span className="tabular font-mono text-[11px] leading-5 text-[var(--color-ink-3)]">
            {index + 1}
          </span>
        )}
        <div className="grid min-w-0 gap-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-medium text-[var(--color-ink)]">{step.label}</span>
            {step.kind === "copy" ? (
              <button
                type="button"
                aria-label={`${copied === step.key ? "Copied" : "Copy"} ${step.label.charAt(0).toLowerCase()}${step.label.slice(1)}`}
                onClick={(event) => copy(event, step.key, step.value, step.html)}
                className={
                  "label-mono rounded-[var(--radius-pill)] border px-2.5 py-1 transition-colors " +
                  (copied === step.key
                    ? "border-[var(--color-ok)] text-[var(--color-ok)]"
                    : "border-[var(--color-rule)] text-[var(--color-ink-2)] hover:border-[var(--color-ink-3)]")
                }
              >
                {copied === step.key ? "Copied" : "Copy"}
              </button>
            ) : null}
          </div>

          {step.kind === "copy" ? (
            <p
              className={
                "select-all text-[13px] break-words text-[var(--color-ink-2)] " +
                (step.multiline ? "line-clamp-4 whitespace-pre-wrap" : "")
              }
            >
              {step.value}
            </p>
          ) : null}
          {step.kind === "copy" && step.note ? (
            <p className="text-[12px] text-[var(--color-ink-3)]">{step.note}</p>
          ) : null}
          {step.kind === "copy" && failed === step.key ? (
            <p className="text-[12px] text-[var(--color-ink-2)]">{COPY_FAILED}</p>
          ) : null}

          {step.kind === "files" ? (
            <>
              <ul className="grid gap-1">
                {step.files.map((file) => (
                  <li
                    key={`${file.assetId}:${file.filename}`}
                    className="min-w-0 truncate text-[13px]"
                  >
                    <a
                      className="underline underline-offset-2 hover:text-[var(--color-accent)]"
                      href={downloadHref(file)}
                      download={file.downloadAs ?? file.filename}
                    >
                      {file.filename}
                    </a>
                  </li>
                ))}
              </ul>
              <p className="text-[12px] text-[var(--color-ink-3)]">{step.note}</p>
            </>
          ) : null}

          {step.kind === "missing" ? (
            <p className="text-[13px] text-[var(--color-ink-3)]">
              Not ready yet. Add it to the listing and save, or wait for the images to be prepared.
            </p>
          ) : null}

          {step.kind === "note" ? (
            <p className="text-[13px] text-[var(--color-ink-2)]">{step.text}</p>
          ) : null}

          {step.kind === "submit" ? (
            <p className="text-[13px] text-[var(--color-ink-2)]">{step.text}</p>
          ) : null}
        </div>
      </li>
    )
  }

  return (
    <section className="grid gap-4" aria-labelledby="handoff-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="grid gap-0.5">
          <span id="handoff-heading" className="label-mono text-[var(--color-ink)]">
            {channelName} handoff
          </span>
          <span className="text-[13px] text-[var(--color-ink-2)]">{productName}</span>
        </div>
        {readiness ? (
          <span className="label-mono tabular text-[var(--color-ink-3)]">
            Readiness {readiness.resolved}/{readiness.total}
          </span>
        ) : null}
      </div>

      {sectioned ? (
        <ol className="grid gap-5">
          {groups.map((group, index) => (
            <li key={group.section ?? `ungrouped-${index}`} className="grid gap-2">
              <div className="flex items-baseline gap-2">
                <span className="tabular font-mono text-[11px] leading-5 text-[var(--color-ink-3)]">
                  {index + 1}
                </span>
                <span className="label-mono text-[var(--color-ink)]">
                  {group.section ?? group.steps[0]?.label}
                </span>
              </div>
              <ul className="grid gap-3 pl-[1.25rem]">
                {group.steps.map((step) => renderStep(step, null))}
              </ul>
            </li>
          ))}
        </ol>
      ) : (
        <ol className="grid gap-3">{steps.map((step, index) => renderStep(step, index))}</ol>
      )}
    </section>
  )
}
