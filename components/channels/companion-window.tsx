"use client"

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"
import {
  COMPANION_SIZE,
  companionApi,
  dressCompanionDocument,
  followTheme,
} from "@/lib/ui/companion"

/**
 * Shows its children in the page, or in a companion window beside the
 * marketplace's editor. docs/companion-window.md; ADR 0010.
 *
 * The children are rendered once, either inline or through a portal into the
 * window's document. There is no second copy of the handoff to keep in step,
 * which is constraint 5 of the ADR held by structure rather than by care.
 *
 * Moving between the page and the window remounts the children, so local
 * state such as the last-copied marker starts fresh on each move. Keeping it
 * would mean moving DOM nodes between documents by hand, and a creator pops
 * the handoff out before copying, not halfway through.
 *
 * Nothing in the window reaches for the marketplace. It is Fanwise's own
 * document; the creator does the typing on the other side.
 */

const noSubscription = () => () => {}

export function CompanionWindow({ title, children }: { title: string; children: ReactNode }) {
  // Read after hydration, never during the server render, which has no window.
  // The server answer is "not supported", so the button appears only once the
  // browser has said it can open one.
  const supported = useSyncExternalStore(
    noSubscription,
    () => companionApi(window) !== null,
    () => false,
  )
  const [companion, setCompanion] = useState<Window | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!companion) return
    // pagehide fires when the creator closes the window, and when a second
    // companion replaces this one: one per tab is the browser's rule.
    const onClosed = () => setCompanion(null)
    companion.addEventListener("pagehide", onClosed)
    const stopFollowing = followTheme(document, companion.document)
    return () => {
      companion.removeEventListener("pagehide", onClosed)
      stopFollowing()
    }
  }, [companion])

  // Leaving the page takes the window with it. A companion outliving the page
  // it belongs to would show a handoff nothing on screen explains.
  useEffect(() => {
    if (!companion) return
    return () => companion.close()
  }, [companion])

  async function popOut() {
    const api = companionApi(window)
    if (!api) return
    setError(null)
    try {
      // Called straight from the click, before any other await: the browser
      // opens the window only while the click's user activation lasts.
      const opened = await api.requestWindow(COMPANION_SIZE)
      dressCompanionDocument(document, opened.document, title)
      setCompanion(opened)
    } catch {
      setError("The companion window could not open. The handoff is still here on the page.")
    }
  }

  if (companion) {
    return (
      <>
        <div className="flex flex-wrap items-center gap-3 border-l-2 border-[var(--color-rule)] py-1.5 pl-3">
          <span className="text-[13px] text-[var(--color-ink-2)]">
            Open in the companion window.
          </span>
          <Button variant="secondary" onClick={() => companion.close()}>
            Bring it back
          </Button>
        </div>
        {createPortal(<div className="p-4">{children}</div>, companion.document.body)}
      </>
    )
  }

  return (
    <div className="grid gap-3">
      {supported ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={popOut}>
            Pop out ↗
          </Button>
          <span className="text-[12px] text-[var(--color-ink-3)]">
            Keeps this beside the marketplace&apos;s editor while you fill it in.
          </span>
        </div>
      ) : null}
      {error ? <p className="text-[13px] text-[var(--color-ink-2)]">{error}</p> : null}
      {children}
    </div>
  )
}
