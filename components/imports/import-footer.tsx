"use client"

import { Button } from "@/components/ui/button"
import { SaveStatusIndicator, type SaveStatus } from "@/components/ui/save-status"
import { canReviewMarketplaceDrafts, type ImportReadiness } from "@/lib/imports/readiness"

/**
 * The bar along the bottom: what will not happen, and the two things that can.
 *
 * **The gate is logic, not styling.** `canReviewMarketplaceDrafts(readiness)`
 * decides whether review may be reached, the handler refuses when it says no,
 * and the appearance follows that answer rather than standing in for it. A
 * disabled-looking button whose click still worked would be the exact failure
 * this screen exists to prevent — a listing reaching a marketplace queue before
 * anyone had said what license it carries or who owns it.
 *
 * `aria-disabled` rather than `disabled`, following
 * `components/onboarding/import-listing-action.tsx`: a `disabled` button leaves
 * the tab order, taking its own explanation with it, so a keyboard or screen
 * reader user meets a button that has vanished rather than a button that says
 * why it is waiting. The refusal in the handler is what makes it inert.
 */
export function ImportFooter({
  readiness,
  saveStatus,
  savedAt,
  onSaveDraft,
  onReviewDrafts,
}: {
  readiness: ImportReadiness
  saveStatus: SaveStatus
  savedAt: number | null
  onSaveDraft: () => void
  onReviewDrafts: () => void
}) {
  const allowed = canReviewMarketplaceDrafts(readiness)

  return (
    <div className="sticky bottom-0 z-20 mt-10 border-t border-[var(--color-rule)] bg-[var(--color-paper)]/95 backdrop-blur-sm">
      <div className="flex flex-col gap-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
        <p className="flex items-center gap-2.5 text-[14px] text-[var(--color-ink-2)]">
          <LockGlyph />
          Nothing publishes until you approve it.
        </p>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end sm:gap-4">
          <SaveStatusIndicator status={saveStatus} savedAt={savedAt} />

          {/*
            The reason sits beside the control rather than inside a tooltip, so
            it is read by someone who never hovers anything, and it is the id
            the button points at.
          */}
          {allowed ? null : (
            <p id="import-review-blocked" className="text-[13px] text-[var(--color-ink-2)]">
              {readiness.blockedReason}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" onClick={onSaveDraft}>
              Save draft
            </Button>
            <Button
              type="button"
              aria-disabled={allowed ? undefined : true}
              aria-describedby={allowed ? undefined : "import-review-blocked"}
              onClick={() => {
                // The gate, enforced. Styling is downstream of this line.
                if (!canReviewMarketplaceDrafts(readiness)) return
                onReviewDrafts()
              }}
              className={
                allowed
                  ? ""
                  : "cursor-not-allowed opacity-45 hover:border-[var(--color-action)] hover:bg-[var(--color-action)]"
              }
            >
              Review marketplace drafts
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function LockGlyph() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className="shrink-0 text-[var(--color-ink-3)]"
    >
      <rect x="3" y="7" width="10" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}
