"use client"

import { useSyncExternalStore } from "react"

/**
 * The light/dark view toggle.
 *
 * Ported from design/handoff/marketing-site/theme.js, which inverts the whole
 * document with a filter rather than swapping a palette. That is deliberately
 * kept: the handoff calls the pages pixel-exact, and an inverted page is what
 * the design shows. The README's own note — "in production, prefer real design
 * tokens (CSS variables with a dark palette) over the invert filter" — is the
 * right end state and is recorded in the step report as outstanding, not
 * silently half-done here.
 *
 * The storage key stays `fw-theme` so a visitor who set the preference on a
 * published mockup keeps it.
 */
const KEY = "fw-theme"

export const THEME_KEY = KEY

const CHANGED = "fw-theme-change"

function apply(theme: string) {
  document.documentElement.style.filter = theme === "flip" ? "invert(1) hue-rotate(180deg)" : ""
}

/**
 * The preference lives in localStorage, which is outside React, so it is read as
 * an external store rather than copied into state by an effect. That also
 * settles hydration: the server snapshot is always "not flipped", which is what
 * the markup says, and the real value arrives on the client without a cascading
 * render.
 */
function subscribe(onChange: () => void) {
  window.addEventListener(CHANGED, onChange)
  // Another tab is another copy of the same preference.
  window.addEventListener("storage", onChange)
  return () => {
    window.removeEventListener(CHANGED, onChange)
    window.removeEventListener("storage", onChange)
  }
}

function readStored(): boolean {
  try {
    return localStorage.getItem(KEY) === "flip"
  } catch {
    // A browser refusing storage still gets a working toggle, just not a
    // remembered one.
    return false
  }
}

export function ThemeToggle({ variant = "light" }: { variant?: "light" | "dark" }) {
  const flipped = useSyncExternalStore(subscribe, readStored, () => false)

  function toggle() {
    const next = flipped ? "base" : "flip"
    try {
      localStorage.setItem(KEY, next)
    } catch {
      // Ignored for the same reason as above.
    }
    apply(next)
    window.dispatchEvent(new Event(CHANGED))
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title="Toggle light / dark view"
      aria-label="Toggle light and dark view"
      aria-pressed={flipped}
      className={variant === "dark" ? "fw-theme-toggle fw-theme-toggle--dark" : "fw-theme-toggle"}
    >
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M10 2.5a7.5 7.5 0 0 1 0 15z" fill="currentColor" />
      </svg>
    </button>
  )
}

/**
 * Applies the stored preference before first paint.
 *
 * Without this the page renders un-inverted and flips once React mounts, which
 * is a full-screen flash of the wrong theme on every navigation. It has to be a
 * blocking inline script for that reason; a client component runs too late.
 */
export function ThemeScript() {
  const source = `try{if(localStorage.getItem(${JSON.stringify(KEY)})==="flip"){document.documentElement.style.filter="invert(1) hue-rotate(180deg)"}}catch(e){}`
  return <script dangerouslySetInnerHTML={{ __html: source }} />
}
