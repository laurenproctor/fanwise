"use client"

import { useEffect, useState } from "react"

/**
 * What the form has done with your typing, said in the corner where you can
 * see it.
 *
 * Autosave without a status indicator is worse than an explicit Save button:
 * it removes the moment that told you your work was safe and puts nothing in
 * its place. So the four states are always distinguishable, and the two that
 * matter — unsaved work, and a save that failed — are the two that never fade.
 *
 * aria-live is polite rather than assertive. A screen reader user typing into
 * the field below should not be interrupted mid-word by "saving", but should
 * hear it at the next natural pause.
 */
export type SaveStatus = "clean" | "dirty" | "saving" | "saved" | "error"

/** Turns a save time into something that stays true without a re-render. */
function agoLabel(savedAt: number | null): string {
  if (savedAt === null) return "Saved"
  const seconds = Math.round((Date.now() - savedAt) / 1000)
  if (seconds < 45) return "Saved just now"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `Saved ${minutes} minute${minutes === 1 ? "" : "s"} ago`
  return "Saved"
}

export function SaveStatusIndicator({
  status,
  savedAt,
}: {
  status: SaveStatus
  savedAt: number | null
}) {
  // "Saved just now" stops being true after a minute. Re-render occasionally so
  // the corner never states something the clock has made false.
  const [, tick] = useState(0)
  useEffect(() => {
    if (status !== "saved") return
    const timer = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(timer)
  }, [status])

  const { text, tone } = {
    clean: { text: "", tone: "" },
    dirty: { text: "Unsaved changes", tone: "text-[var(--color-ink-3)]" },
    saving: { text: "Saving…", tone: "text-[var(--color-ink-3)]" },
    saved: { text: agoLabel(savedAt), tone: "text-[var(--color-ok)]" },
    error: { text: "Couldn't save", tone: "text-[var(--color-ink)]" },
  }[status]

  return (
    <span
      role="status"
      aria-live="polite"
      className={`label-mono inline-flex items-center gap-1.5 ${tone}`}
    >
      {status !== "clean" ? (
        <span
          aria-hidden
          className={`h-[5px] w-[5px] shrink-0 rounded-full ${
            status === "saved"
              ? "bg-[var(--color-ok)]"
              : status === "error"
                ? "bg-[var(--color-bad)]"
                : status === "saving"
                  ? "bg-[var(--color-accent)]"
                  : "bg-[var(--color-ink-3)]"
          }`}
        />
      ) : null}
      {text}
    </span>
  )
}
