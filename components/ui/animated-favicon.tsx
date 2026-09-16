"use client"

import { useEffect } from "react"
import {
  createFaviconAnimator,
  FAVICON_FRAMES,
  FAVICON_INACTIVE_INTERVAL_MS,
  FAVICON_LOAD_DELAY_MS,
  FAVICON_RESTING_FRAME,
} from "@/lib/favicon/animation"
import { FANWISE_PRODUCT_PUBLISHED_EVENT } from "@/lib/favicon/events"

/**
 * The Fanwise mark in the browser tab, and the three moments it moves.
 *
 * Renders nothing. On mount it appends its own `<link rel="icon">` after the
 * ones the root layout's metadata emits, so the frame swaps touch an element
 * this component owns and never one React manages; on unmount it takes that
 * link away and the metadata icons are what remain. Ordinary SVG files, one
 * per frame, because an animated SVG or GIF in a favicon is honoured by some
 * browsers and frozen by others, and a link whose href changes is honoured by
 * all of them.
 *
 * The schedule itself is lib/favicon/animation.ts, tested with fake timers.
 * What this file adds is the browser: the link element, the Page Visibility
 * API, the reduced-motion query, the published event, and the one fact a pure
 * function cannot hold — whether this page load has already had its opening
 * fan. That lives at module level so it survives a remount and dies with a
 * full reload, which is the exact lifetime "once per application load" names.
 * A client-side route change never remounts the root layout, so it never
 * reaches this at all.
 */

let loadSequencePlayed = false

export function AnimatedFavicon({
  intervalMs = FAVICON_INACTIVE_INTERVAL_MS,
  loadDelayMs = FAVICON_LOAD_DELAY_MS,
}: {
  intervalMs?: number
  loadDelayMs?: number
}) {
  useEffect(() => {
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)")

    const icon = document.createElement("link")
    icon.rel = "icon"
    icon.type = "image/svg+xml"
    icon.setAttribute("sizes", "any")
    icon.dataset.fanwiseAnimated = "true"
    icon.href = FAVICON_RESTING_FRAME
    document.head.appendChild(icon)

    // Fetched once here so the first swap is served from cache. Held for the
    // life of the effect so nothing collects them before the sequence runs.
    const preloaded = FAVICON_FRAMES.map((src) => {
      const image = new Image()
      image.src = src
      return image
    })

    const animator = createFaviconAnimator(
      {
        showFrame: (href) => {
          icon.href = href
        },
        hidden: () => document.hidden,
        reducedMotion: () => motionPreference.matches,
        loadSequenceStarted: () => {
          loadSequencePlayed = true
        },
      },
      { intervalMs, loadDelayMs: loadSequencePlayed ? null : loadDelayMs },
    )

    const sync = () => animator.syncWithPageActivity()
    const published = () => animator.productPublished()

    document.addEventListener("visibilitychange", sync)
    motionPreference.addEventListener("change", sync)
    window.addEventListener(FANWISE_PRODUCT_PUBLISHED_EVENT, published)
    animator.start()

    return () => {
      animator.stop()
      document.removeEventListener("visibilitychange", sync)
      motionPreference.removeEventListener("change", sync)
      window.removeEventListener(FANWISE_PRODUCT_PUBLISHED_EVENT, published)
      icon.remove()
      preloaded.length = 0
    }
  }, [intervalMs, loadDelayMs])

  return null
}
