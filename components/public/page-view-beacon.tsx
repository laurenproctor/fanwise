"use client"

import { useEffect } from "react"
import { publicMediaRoutes } from "@/lib/public/media-routes"
import { viewedKey } from "@/lib/public/page-views"

/**
 * Counts one view of a public page, once per tab.
 *
 * Renders nothing. After the page has hydrated it sends the profile id, the
 * product page id when there is one, and `document.referrer` with
 * `sendBeacon`, which neither waits for an answer nor holds up anything the
 * visitor does. The server reduces the referrer to a host and stores no
 * visitor identity (app/api/public/view/route.ts).
 *
 * The once-per-tab rule is kept here, in sessionStorage, rather than on the
 * server: the browser can remember "I already said this" without the server
 * ever needing to know who is asking. A private window, or storage that
 * throws, simply counts again.
 */
export function PageViewBeacon({
  profileId,
  pageId = null,
  campaign = null,
}: {
  profileId: string
  pageId?: string | null
  campaign?: string | null
}) {
  useEffect(() => {
    if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return

    const key = viewedKey(profileId, pageId)
    try {
      if (window.sessionStorage.getItem(key)) return
      window.sessionStorage.setItem(key, "1")
    } catch {
      // Storage unavailable: count it, and accept that a reload counts again.
    }

    try {
      const body = JSON.stringify({
        profileId,
        ...(pageId ? { pageId } : {}),
        ...(document.referrer ? { referrer: document.referrer } : {}),
        // The server refuses a malformed label along with the whole view, so
        // one it would refuse is left off rather than costing the count.
        ...(campaign && /^[A-Za-z0-9._-]{1,64}$/.test(campaign) ? { campaign } : {}),
      })
      navigator.sendBeacon(
        publicMediaRoutes.pageView(),
        new Blob([body], { type: "application/json" }),
      )
    } catch {
      // A view that goes uncounted is not worth an error on a stranger's screen.
    }
  }, [profileId, pageId, campaign])

  return null
}
