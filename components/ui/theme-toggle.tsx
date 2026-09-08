"use client"

import { useSyncExternalStore } from "react"

export const THEME_KEY = "fw-theme"

const CHANGED = "fw-theme-change"
const DARK = "dark"
const LIGHT = "light"

type Theme = typeof DARK | typeof LIGHT

function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_KEY)

    // Migrate the values used by the original marketing-site inversion toggle.
    if (value === DARK || value === "flip") return DARK
    if (value === LIGHT || value === "base") return LIGHT
  } catch {
    // A browser refusing storage can still follow its system preference.
  }

  return null
}

function currentTheme(): Theme {
  const stored = storedTheme()
  if (stored) return stored

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? DARK : LIGHT
}

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme
}

function subscribe(onChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)")
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_KEY) return
    apply(currentTheme())
    onChange()
  }
  const onSystemChange = () => {
    if (!storedTheme()) {
      apply(currentTheme())
      onChange()
    }
  }

  window.addEventListener(CHANGED, onChange)
  window.addEventListener("storage", onStorage)
  media.addEventListener("change", onSystemChange)

  return () => {
    window.removeEventListener(CHANGED, onChange)
    window.removeEventListener("storage", onStorage)
    media.removeEventListener("change", onSystemChange)
  }
}

export function ThemeToggle({ variant = "light" }: { variant?: "light" | "dark" }) {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => LIGHT)
  const dark = theme === DARK
  const next = dark ? LIGHT : DARK

  function toggle() {
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      // The preference still applies for this page when storage is unavailable.
    }

    apply(next)
    window.dispatchEvent(new Event(CHANGED))
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={`Switch to ${next} mode`}
      aria-label={`Switch to ${next} mode`}
      aria-pressed={dark}
      className={variant === "dark" ? "theme-toggle theme-toggle--on-dark" : "theme-toggle"}
    >
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M10 2.5a7.5 7.5 0 0 1 0 15z" fill="currentColor" />
      </svg>
    </button>
  )
}

/** Apply the saved or system preference before the first paint. */
export function ThemeScript() {
  const source = `(function(){try{var v=localStorage.getItem(${JSON.stringify(THEME_KEY)});var t=v==="dark"||v==="flip"?"dark":v==="light"||v==="base"?"light":window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){}})()`
  return <script dangerouslySetInnerHTML={{ __html: source }} />
}
