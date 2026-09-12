"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"

/**
 * Share, with a fallback for every case.
 *
 * Three paths, in order of how good they are, and each one is a real browser
 * somebody is using:
 *
 *   1. `navigator.share` — a phone, which is where sharing actually happens.
 *   2. `navigator.clipboard.writeText` — a desktop with a secure context.
 *   3. A visible, pre-selected input — an insecure context, an old browser, or
 *      a permission the visitor refused. The URL is on screen and already
 *      selected, so it is one keystroke from copied.
 *
 * The third path is the one that is usually skipped, and it is the reason this
 * component exists rather than a one-line `onClick`. `navigator.clipboard` is
 * `undefined` over plain http and can reject even over https, and a Share
 * button that silently does nothing is worse than no Share button.
 *
 * A cancelled share is not a failure. `navigator.share` rejects with
 * `AbortError` when somebody dismisses the sheet, and reporting that as an
 * error would tell a visitor something went wrong when they simply changed
 * their mind.
 */
export function ShareButton({ url, title }: { url: string; title: string }) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle")
  const inputRef = useRef<HTMLInputElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  // Focus and select the fallback input once it exists, not before.
  useEffect(() => {
    if (state !== "manual") return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [state])

  function flashCopied() {
    setState("copied")
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState("idle"), 2500)
  }

  async function onShare() {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url })
        return
      } catch (error) {
        // Dismissed rather than failed. Leave the button as it was.
        if (error instanceof DOMException && error.name === "AbortError") return
        // Anything else falls through to the clipboard.
      }
    }

    try {
      await navigator.clipboard.writeText(url)
      flashCopied()
    } catch {
      setState("manual")
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button type="button" variant="secondary" onClick={onShare}>
        <ShareIcon />
        {state === "copied" ? "Link copied" : "Share"}
      </Button>

      {/*
        Polite, not assertive: the confirmation is a courtesy and should wait
        for a pause rather than interrupt whatever is being read.
      */}
      <p aria-live="polite" className="sr-only">
        {state === "copied" ? "Link copied to the clipboard" : ""}
      </p>

      {state === "manual" ? (
        <label className="flex w-full max-w-[380px] flex-col gap-1">
          <span className="label-mono">Copy this link</span>
          <input
            ref={inputRef}
            readOnly
            value={url}
            onFocus={(event) => event.currentTarget.select()}
            className="w-full rounded-[10px] border border-[var(--color-rule)] bg-[var(--color-card)] px-3 py-2 text-[14px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
          />
        </label>
      ) : null}
    </div>
  )
}

function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3v12" />
      <path d="m8 7 4-4 4 4" />
      <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </svg>
  )
}
