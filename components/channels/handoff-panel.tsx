"use client"

import { useState, useSyncExternalStore, type MouseEvent } from "react"
import type { HandoffStep } from "@/lib/channels/handoff"
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
 */

const noSubscription = () => () => {}

const COPY_FAILED = "Could not copy from this window. Select the text and copy it by hand."

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

  async function copy(event: MouseEvent<HTMLButtonElement>, key: string, value: string) {
    // The clipboard of the window the button is in. In the companion that is
    // the companion's own, and the page's would refuse: a clipboard write needs
    // its document to have focus, and the click just gave focus to the other.
    const clipboard = event.currentTarget.ownerDocument.defaultView?.navigator.clipboard
    try {
      if (!clipboard) throw new Error("no clipboard")
      await clipboard.writeText(value)
      setCopied(key)
      setFailed(null)
    } catch {
      setFailed(key)
    }
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

      <ol className="grid gap-3">
        {steps.map((step, index) => {
          return (
            <li
              key={step.key}
              className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2 border-t border-[var(--color-rule-2)] pt-3"
            >
              <span className="tabular font-mono text-[11px] leading-5 text-[var(--color-ink-3)]">
                {index + 1}
              </span>
              <div className="grid min-w-0 gap-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-[var(--color-ink)]">
                    {step.label}
                  </span>
                  {step.kind === "copy" ? (
                    <button
                      type="button"
                      aria-label={`${copied === step.key ? "Copied" : "Copy"} ${step.label.charAt(0).toLowerCase()}${step.label.slice(1)}`}
                      onClick={(event) => copy(event, step.key, step.value)}
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
                {step.kind === "copy" && failed === step.key ? (
                  <p className="text-[12px] text-[var(--color-ink-2)]">{COPY_FAILED}</p>
                ) : null}

                {step.kind === "files" ? (
                  <>
                    <ul className="grid gap-1">
                      {step.files.map((file) => (
                        <li key={file.assetId} className="min-w-0 truncate text-[13px]">
                          <a
                            className="underline underline-offset-2 hover:text-[var(--color-accent)]"
                            href={`${origin}${routes.assetDownload(workspaceSlug, file.assetId)}`}
                            download={file.filename}
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
                    Not written yet. Add it to the listing and save.
                  </p>
                ) : null}

                {step.kind === "submit" ? (
                  <p className="text-[13px] text-[var(--color-ink-2)]">{step.text}</p>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
