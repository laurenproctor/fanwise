"use client"

import { useCallback, useEffect, useId, useRef, useState } from "react"
import { GLOSSARY, type GlossaryTerm } from "@/lib/ui/glossary"

/**
 * A small "i" beside a word the interface has not earned the right to assume,
 * and the explanation it opens.
 *
 * Three decisions worth keeping:
 *
 * The panel is `position: fixed` and placed from a measured rectangle rather
 * than absolutely positioned inside its parent. Half these icons sit in table
 * headers and card bodies whose ancestors scroll, and an absolutely positioned
 * panel is clipped by the first of those it meets. Fixed positioning is not
 * clipped by an ancestor's overflow, so the same component works everywhere
 * without every caller knowing what it was dropped into.
 *
 * The text is in the DOM at all times, in a visually hidden span the trigger
 * points at with aria-describedby. A panel that only exists while open is a
 * panel a screen reader can only reach by hovering something, which is to say
 * not at all. What is visible on hover is decoration over that, and marked
 * aria-hidden so it is not announced twice.
 *
 * Opening is bound to hover and to focus, never to click. A tap on a touch
 * device focuses and then clicks, so a click handler that toggles would open
 * the panel and close it again in the same gesture. Focus alone opens on touch,
 * on keyboard and on mouse, and blur, Escape or the pointer leaving closes it.
 */

/** Distance from the trigger, and the closest the panel may come to an edge. */
const OFFSET = 8
const MARGIN = 12
const MAX_WIDTH = 288
/** With less room than this underneath, the panel opens upward instead. */
const FLIP_THRESHOLD = 180

interface Placement {
  left: number
  width: number
  top?: number
  bottom?: number
}

export function InfoTip({ term, className = "" }: { term: GlossaryTerm; className?: string }) {
  const { label, body } = GLOSSARY[term]
  const descriptionId = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const [placement, setPlacement] = useState<Placement | null>(null)

  const place = useCallback(() => {
    const rect = trigger.current?.getBoundingClientRect()
    if (!rect) return

    // Narrow windows get a narrower panel rather than one that hangs off the
    // side, and the clamp keeps a centred panel inside the viewport when the
    // trigger is near either edge.
    const width = Math.min(MAX_WIDTH, window.innerWidth - MARGIN * 2)
    const centred = rect.left + rect.width / 2 - width / 2
    const left = Math.min(Math.max(centred, MARGIN), window.innerWidth - width - MARGIN)

    const roomBelow = window.innerHeight - rect.bottom
    setPlacement(
      roomBelow < FLIP_THRESHOLD && rect.top > roomBelow
        ? { left, width, bottom: window.innerHeight - rect.top + OFFSET }
        : { left, width, top: rect.bottom + OFFSET },
    )
  }, [])

  const dismiss = useCallback(() => setPlacement(null), [])

  useEffect(() => {
    if (!placement) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") dismiss()
    }

    // Viewport coordinates go stale the moment anything moves, so the panel is
    // replaced on scroll and resize. Scroll is captured because the thing that
    // scrolls is usually an ancestor element, not the window, and a scroll
    // event on a div does not bubble.
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("scroll", place, true)
    window.addEventListener("resize", place)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("scroll", place, true)
      window.removeEventListener("resize", place)
    }
  }, [placement, place, dismiss])

  return (
    <span className={`inline-flex items-center align-middle ${className}`}>
      <button
        ref={trigger}
        type="button"
        /*
          The name says which word this explains. A row of identical "More
          information" buttons is a row a screen reader user cannot tell apart,
          which is the same mistake as an unlabelled icon, one step later.
        */
        aria-label={`What ${label.toLowerCase()} means`}
        aria-describedby={descriptionId}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") place()
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") dismiss()
        }}
        onFocus={place}
        onBlur={dismiss}
        className="inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border border-[var(--color-rule)] bg-transparent font-mono text-[9px] leading-none text-[var(--color-ink-3)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] focus-visible:border-[var(--color-accent)] focus-visible:text-[var(--color-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
      >
        <span aria-hidden>i</span>
      </button>

      {/* The copy, always present, for anything not driven by a pointer. */}
      <span id={descriptionId} className="sr-only">
        {body}
      </span>

      {placement ? (
        <span
          aria-hidden
          style={{
            left: placement.left,
            top: placement.top,
            bottom: placement.bottom,
            width: placement.width,
          }}
          /*
            Dark panel on light paper. The design system keeps a full dark
            palette for exactly this: a floating surface has to separate from
            the page underneath it, and a hairline border on white does not.
          */
          className="fixed z-50 flex flex-col gap-1.5 rounded-[10px] border border-[var(--color-navy)] bg-[var(--color-panel)] px-3.5 py-3 text-left shadow-[0_12px_32px_-14px_rgba(4,6,13,0.55)]"
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-on-dark-2)]">
            {label}
          </span>
          <span className="text-[13px] leading-[1.55] font-normal text-[var(--color-on-dark)]">
            {body}
          </span>
        </span>
      ) : null}
    </span>
  )
}
