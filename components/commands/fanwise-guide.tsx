"use client"

import { SEQUENCE_DESTINATIONS } from "@/lib/commands/navigation"
import { Kbd } from "./kbd"

/**
 * The bar along the bottom that appears after `F`, and the same bar when a
 * command has a sentence to say (why a shortcut did nothing).
 *
 * One live region, always in the DOM, so a screen reader is told once when
 * it fills and hears nothing while it is empty. The guide's own text is the
 * announcement — "Fanwise: P Products, C Channels…" — rather than a second
 * hidden sentence saying the same thing.
 *
 * No animation: it is up for a second and a half, and a fade would spend a
 * third of that arriving. Reduced motion therefore has nothing to reduce.
 */
export function FanwiseGuide({ open, message }: { open: boolean; message: string | null }) {
  const visible = open || message !== null
  return (
    <div
      role="status"
      aria-live="polite"
      className={
        visible
          ? "pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4"
          : "sr-only"
      }
    >
      {open ? (
        <div className="flex max-w-full flex-wrap items-center justify-center gap-x-4 gap-y-2 rounded-[var(--radius-pill)] border border-[var(--color-rule)] bg-[var(--color-card)] px-5 py-2.5 text-[14px] text-[var(--color-ink)] shadow-[0_12px_32px_rgba(4,6,13,0.18)]">
          <span className="font-display text-[15px] tracking-[-0.01em]">Fanwise:</span>
          {SEQUENCE_DESTINATIONS.map((destination) => (
            <span key={destination.key} className="inline-flex items-center gap-1.5">
              <Kbd>{destination.key.toUpperCase()}</Kbd> <span>{destination.label}</span>
            </span>
          ))}
        </div>
      ) : message ? (
        <div className="max-w-[560px] rounded-[var(--radius-pill)] border border-[var(--color-rule)] bg-[var(--color-card)] px-5 py-2.5 text-center text-[14px] text-[var(--color-ink)] shadow-[0_12px_32px_rgba(4,6,13,0.18)]">
          {message}
        </div>
      ) : null}
    </div>
  )
}
