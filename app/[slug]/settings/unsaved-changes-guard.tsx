"use client"

import { useEffect } from "react"

/**
 * Warns before a full page unload while a section has unsaved changes.
 *
 * beforeunload covers a closed tab, a reload and a typed URL. It does not cover
 * a client-side navigation inside the app, which App Router performs without
 * unloading the document; Next exposes no supported hook for interrupting one,
 * and the alternatives on offer — patching history, or wrapping every Link on
 * the page — are worse than the gap they close. Both sections mount one of
 * these, and the browser shows its own dialog once however many are dirty.
 */
export function UnsavedChangesGuard({ when }: { when: boolean }) {
  useEffect(() => {
    if (!when) return

    function onBeforeUnload(event: BeforeUnloadEvent) {
      // The modern signal. The legacy returnValue is still what some browsers
      // read, and setting both is the only way to get the dialog everywhere.
      event.preventDefault()
      event.returnValue = ""
    }

    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [when])

  return null
}
