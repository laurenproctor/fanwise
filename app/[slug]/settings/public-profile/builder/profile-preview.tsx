"use client"

import { useEffect, useRef, useState } from "react"
import { PublicProfile } from "@/components/public/public-profile"
import type { ProfilePresentation } from "@/lib/public/profile-presentation"

/**
 * The browser-shaped frame the builder's preview sits in.
 *
 * The profile inside is the shared `PublicProfile` component, not a mock of
 * it. This file adds only the frame: the address bar, Share, and the
 * desktop/mobile switch.
 *
 * The scroll container is the same element for the life of the preview, and
 * nothing here keys it on a field's value, so typing in the form re-renders
 * the profile without resetting how far down the creator had scrolled it.
 * The mode is state here rather than in the form, for the same reason: an
 * unrelated field change cannot touch it.
 */

export type PreviewMode = "desktop" | "mobile"

export function ProfilePreview({
  heading,
  subheading,
  origin,
  presentation,
  published,
  emptyProductsMessage,
  initialMode = "desktop",
}: {
  heading: string
  subheading: string
  /** The app origin, e.g. "https://fanwise.com". Shown without its scheme. */
  origin: string
  presentation: ProfilePresentation
  published: boolean
  emptyProductsMessage: string
  initialMode?: PreviewMode
}) {
  const [mode, setMode] = useState<PreviewMode>(initialMode)
  const path = `/@${presentation.handle || "your-address"}`
  const address = `${origin.replace(/^https?:\/\//, "")}${path}`

  return (
    <section aria-labelledby="profile-preview-heading" className="flex min-w-0 flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h2 id="profile-preview-heading" className="label-mono text-[var(--color-accent)]">
            {heading}
          </h2>
          <p className="flex items-center gap-2 text-[13px] text-[var(--color-ink-2)]">
            <span aria-hidden className="h-2 w-2 rounded-full bg-[var(--color-ok)]" />
            {subheading}
          </p>
        </div>
        <DeviceSwitch mode={mode} onChange={setMode} />
      </div>

      <div className="overflow-hidden rounded-[12px] border border-[var(--color-rule)] bg-[var(--color-card)]">
        <div className="flex items-center gap-3 border-b border-[var(--color-rule)] px-4 py-2.5">
          <span
            aria-hidden
            className="h-3 w-3 shrink-0 rounded-full border border-[var(--color-rule)]"
          />
          <span
            className="min-w-0 flex-1 truncate font-mono text-[13px] text-[var(--color-ink)]"
            aria-label={`Public address: ${address}`}
          >
            {address}
          </span>
          <PreviewShare url={`${origin}${path}`} published={published} />
        </div>

        <div
          data-testid="profile-preview-viewport"
          className="max-h-[640px] overflow-auto bg-[var(--color-paper-2)]"
        >
          <div
            data-mode={mode}
            className={
              mode === "mobile"
                ? "mx-auto my-4 w-[375px] max-w-full overflow-hidden rounded-[18px] border border-[var(--color-rule)]"
                : "w-full"
            }
          >
            <PublicProfile
              profile={presentation}
              layout={mode}
              interactive={false}
              nameAs="h3"
              placeholders
              emptyProductsMessage={emptyProductsMessage}
            />
          </div>
        </div>
      </div>
    </section>
  )
}

function DeviceSwitch({
  mode,
  onChange,
}: {
  mode: PreviewMode
  onChange: (mode: PreviewMode) => void
}) {
  return (
    <div role="group" aria-label="Preview size" className="flex items-center gap-1">
      {(["desktop", "mobile"] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={mode === option}
          aria-label={option === "desktop" ? "Desktop preview" : "Mobile preview"}
          onClick={() => onChange(option)}
          className={`flex h-11 w-11 items-center justify-center rounded-[10px] border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${
            mode === option
              ? "border-[var(--color-rule)] bg-[var(--color-paper-2)] text-[var(--color-ink)]"
              : "border-transparent text-[var(--color-ink-2)] hover:text-[var(--color-ink)]"
          }`}
        >
          {option === "desktop" ? <DesktopGlyph /> : <MobileGlyph />}
        </button>
      ))}
    </div>
  )
}

/**
 * Copies the public address. Small enough to live in the address bar, which
 * the shared ShareButton, with its full-width fallback field, is not.
 *
 * An unpublished profile's address does not open yet, and copying it without
 * saying so would send somebody a link that 404s.
 */
function PreviewShare({ url, published }: { url: string; published: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle")
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setState("copied")
    } catch {
      setState("failed")
    }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState("idle"), 3000)
  }

  const note = published ? "" : " It opens once your profile is published."

  return (
    <>
      <button
        type="button"
        onClick={copy}
        className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-[6px] px-1 text-[13px] text-[var(--color-ink)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
      >
        {state === "copied" ? "Copied" : "Share"}
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M7 17 17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <span aria-live="polite" className="sr-only">
        {state === "copied"
          ? `Link copied.${note}`
          : state === "failed"
            ? "Couldn't copy. The address is shown in the preview bar."
            : ""}
      </span>
    </>
  )
}

function DesktopGlyph() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M9 20h6M12 16v4" strokeLinecap="round" />
    </svg>
  )
}

function MobileGlyph() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <rect x="7" y="3" width="10" height="18" rx="2" />
      <path d="M11 18h2" strokeLinecap="round" />
    </svg>
  )
}
