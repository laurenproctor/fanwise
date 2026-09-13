"use client"

import type { AutosaveStatus } from "@/lib/public/draft-autosave"

/**
 * Pieces every builder step shares: the draft-save status and the two status
 * glyphs. One copy, so "Draft saved" reads and behaves the same on each step.
 *
 * The status pairs an icon with words in every state, so nothing is carried by
 * colour alone. Saving and saved are announced politely; a failed save or a
 * conflict is an alert, because both need the creator to act.
 */

export function DraftStatus({ status, onRetry }: { status: AutosaveStatus; onRetry: () => void }) {
  return (
    <div className="flex min-h-11 items-center text-[14px] sm:ml-auto">
      <span role="status" aria-live="polite" className="flex items-center gap-2">
        {status === "pending" || status === "saving" ? (
          <span className="text-[var(--color-ink-3)]">Saving…</span>
        ) : status === "saved" ? (
          <span className="flex items-center gap-2 text-[var(--color-ink-2)]">
            <OkGlyph />
            Draft saved
          </span>
        ) : null}
      </span>
      {status === "error" ? (
        <span role="alert" className="flex items-center gap-2 text-[var(--color-ink)]">
          <ErrorGlyph />
          Couldn&rsquo;t save your draft. Your changes are still here.
          <button
            type="button"
            onClick={onRetry}
            className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          >
            Retry
          </button>
        </span>
      ) : status === "conflict" ? (
        <span role="alert" className="flex items-center gap-2 text-[var(--color-ink)]">
          <ErrorGlyph />
          Changed in another tab. Reload to continue.
        </span>
      ) : null}
    </div>
  )
}

export function OkGlyph() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" width="20" height="20">
      <circle cx="12" cy="12" r="10" fill="var(--color-ok)" />
      <path
        d="m7.5 12.5 3 3 6-6.5"
        fill="none"
        stroke="var(--color-paper)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function ErrorGlyph() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" width="18" height="18" className="shrink-0">
      <circle cx="12" cy="12" r="10" fill="none" stroke="var(--color-bad)" strokeWidth="2" />
      <path
        d="M12 7v6M12 16.5v.5"
        stroke="var(--color-bad)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}
