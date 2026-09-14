"use client"

import { track } from "@vercel/analytics"
import { useEffect } from "react"

/**
 * The directory's two small browser-side duties: analytics, and telling a
 * screen reader how many creators a search found.
 *
 * Neither holds any state of the directory. The cards are server-rendered
 * links, so opening a product or a profile is counted by listening at the
 * document for a click on a link marked `data-directory-link`, and the cards
 * stay free of client code.
 *
 * Analytics payloads name the kind of thing opened and the section it was in.
 * Never a query, a handle or a product: a visitor's search history is not
 * something the directory keeps.
 */
export function DirectoryAnalytics() {
  useEffect(() => {
    track("Creator marketplace viewed")

    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.("a[data-directory-link]")
      if (!(link instanceof HTMLAnchorElement)) return
      const section = link.dataset.directorySection ?? "directory"
      track(
        link.dataset.directoryLink === "product"
          ? "Product opened from creator marketplace"
          : "Creator profile opened from creator marketplace",
        { section },
      )
    }
    document.addEventListener("click", onClick)
    return () => document.removeEventListener("click", onClick)
  }, [])

  return null
}

export const DIRECTORY_STATUS_ID = "creator-directory-status"

/**
 * Writes the result count into the page's one polite live region.
 *
 * The region itself lives outside the results' Suspense boundary, because a
 * live region that is mounted together with its text is not announced — the
 * results are re-mounted on every search. The first count of a visit is not
 * announced at all: it is already on the screen as the page loads, and
 * reading it out would be noise.
 */
export function AnnounceCount({ text }: { text: string }) {
  useEffect(() => {
    const region = document.getElementById(DIRECTORY_STATUS_ID)
    if (!region) return
    if (region.dataset.primed !== "true") {
      region.dataset.primed = "true"
      return
    }
    if (region.textContent !== text) region.textContent = text
  }, [text])
  return null
}
