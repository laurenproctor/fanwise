"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"

/**
 * The open/closed state behind a nav disclosure, and the four ways one closes.
 *
 * Shared by the marketing nav and the public-profile nav, which look nothing
 * alike — one is `fw-` classes from marketing.css, the other Tailwind on the
 * shared tokens — but close for identical reasons. Only the behaviour is here;
 * neither markup nor styling, so the two surfaces stay free to look different.
 *
 * `closeAbove` is the pixel width at which the surface shows its full nav row
 * again. A panel left open behind that row is the bug it prevents.
 */
export function useDisclosure({ closeAbove }: { closeAbove: number }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const pathname = usePathname()

  /*
   * A completed navigation closes the panel — mostly Back and Forward, since a
   * link inside the panel closes it on the way out, and in-page anchors change
   * no pathname at all.
   *
   * Adjusted during the render that sees the new path rather than in an effect.
   * React re-runs this component before touching the DOM, so the panel is never
   * painted open on the new page; an effect would paint it open and then close
   * it, and eslint's react-hooks/set-state-in-effect rejects that.
   */
  const [renderedPath, setRenderedPath] = useState(pathname)
  if (pathname !== renderedPath) {
    setRenderedPath(pathname)
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      setOpen(false)
      triggerRef.current?.focus()
    }

    function onPointerDown(event: PointerEvent) {
      if (containerRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }

    const wide = window.matchMedia(`(min-width: ${closeAbove}px)`)
    const onWiden = () => {
      if (wide.matches) setOpen(false)
    }

    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("pointerdown", onPointerDown)
    wide.addEventListener("change", onWiden)

    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("pointerdown", onPointerDown)
      wide.removeEventListener("change", onWiden)
    }
  }, [open, closeAbove])

  return {
    open,
    toggle: () => setOpen((value) => !value),
    close: () => setOpen(false),
    triggerRef,
    containerRef,
  }
}
