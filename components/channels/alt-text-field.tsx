"use client"

import { useEffect, useId, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { setImageAltTextAction, suggestImageAltTextAction } from "@/lib/products/actions"
import { ALT_TEXT_MAX, type AltTextSource } from "@/lib/products/image-metadata"

/**
 * Alt text for one product image: read, written, or asked for.
 *
 * One field used in two places, so that the tile on the product page and the
 * detail row in the font workspace cannot disagree about what alt text is or
 * how it saves. Typing saves after a pause and on blur. A suggestion is a job
 * (ADR 0014): the button queues it, and the field polls the page until the
 * words land or half a minute passes, whichever is first.
 *
 * Where the words came from is said out loud. A buyer's screen reader will
 * read them either way, and a creator deciding whether to trust a sentence
 * about their own work should know whether a model wrote it.
 */

const SAVE_DELAY_MS = 900
const POLL_MS = 2000
const POLL_LIMIT = 15

export function AltTextField({
  workspaceSlug,
  assetId,
  filename,
  altText,
  altTextSource,
  ready,
  variant,
  refresh,
}: {
  workspaceSlug: string
  assetId: string
  filename: string
  altText: string
  altTextSource: AltTextSource | null
  /** False while the upload is still being measured; nothing can be described yet. */
  ready: boolean
  /** `compact` sits inside a grid tile; `full` has room for guidance. */
  variant: "compact" | "full"
  /** How to re-read the page. Defaults to the router. */
  refresh?: () => void
}) {
  const router = useRouter()
  const id = useId()
  const [value, setValue] = useState(altText)
  const [state, setState] = useState<"idle" | "saving" | "saved" | "suggesting" | "error">("idle")
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** What the server holds, as far as this field knows. State, not a ref: it decides what renders. */
  const [savedValue, setSavedValue] = useState(altText)

  /*
   * Adopt a new value from the server, most often a suggestion that has just
   * landed, unless the creator has typed something the server has not seen.
   * Re-synced during render rather than in an effect, so the field never
   * paints the old words first.
   */
  const [lastSeen, setLastSeen] = useState(altText)
  if (lastSeen !== altText) {
    setLastSeen(altText)
    if (value === savedValue) setValue(altText)
    setSavedValue(altText)
    if (altText.trim().length > 0 && state === "suggesting") setState("idle")
  }

  const reload = refresh ?? (() => router.refresh())

  useEffect(() => {
    if (state !== "suggesting") return
    let ticks = 0
    const poll = setInterval(() => {
      ticks += 1
      if (ticks > POLL_LIMIT) {
        clearInterval(poll)
        setState("error")
        setMessage("No suggestion arrived. You can write one, or try again.")
        return
      }
      reload()
    }, POLL_MS)
    return () => clearInterval(poll)
    // reload is stable for the life of the field; re-subscribing on it would
    // restart the count every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  function save(next: string) {
    if (next === savedValue) return
    setState("saving")
    void setImageAltTextAction(workspaceSlug, assetId, next).then(
      (result) => {
        if (result.error) {
          setState("error")
          setMessage(result.error)
          return
        }
        setSavedValue(next)
        setMessage(null)
        setState("saved")
        reload()
      },
      () => {
        setState("error")
        setMessage("Couldn't save. Check your connection and try again.")
      },
    )
  }

  function suggest() {
    setMessage(null)
    setState("suggesting")
    void suggestImageAltTextAction(workspaceSlug, assetId).then(
      (result) => {
        if (result.error) {
          setState("error")
          setMessage(result.error)
        }
      },
      () => {
        setState("error")
        setMessage("Couldn't ask for a suggestion. Try again.")
      },
    )
  }

  const empty = value.trim().length === 0
  const status =
    state === "saving"
      ? "Saving…"
      : state === "saved"
        ? "Saved"
        : state === "suggesting"
          ? "Writing a description from the image…"
          : state === "error"
            ? message
            : altTextSource === "generated" && value === savedValue
              ? "Suggested from the image. Edit it if it is wrong."
              : variant === "full"
                ? "Describe what the image shows, including any words set in it."
                : null

  const compact = variant === "compact"
  const inputClass = compact
    ? "w-full min-w-0 rounded-[6px] border border-[var(--color-rule)] bg-[var(--color-card)] px-2 py-1 text-[12px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-3)] focus-visible:border-[var(--color-accent)]"
    : "w-full rounded-[10px] border border-[var(--color-rule)] bg-[var(--color-card)] px-3 py-2 text-[14.5px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-3)] focus-visible:border-[var(--color-accent)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent-soft)]"

  return (
    <div className={`grid min-w-0 ${compact ? "gap-1" : "gap-2"}`}>
      <label htmlFor={id} className={compact ? "sr-only" : "text-[14px]"}>
        Alt text{compact ? ` for ${filename}` : ""}
      </label>
      <textarea
        id={id}
        rows={compact ? 2 : 2}
        maxLength={ALT_TEXT_MAX}
        value={value}
        disabled={!ready}
        aria-describedby={`${id}-status`}
        aria-invalid={state === "error" || undefined}
        placeholder={
          compact ? "Alt text" : "Blimp Display set large in black on white, spelling “Blimp”."
        }
        onChange={(event) => {
          const next = event.target.value
          setValue(next)
          if (state !== "suggesting") setState("idle")
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => save(next), SAVE_DELAY_MS)
        }}
        onBlur={() => {
          if (timer.current) clearTimeout(timer.current)
          save(value)
        }}
        className={`${inputClass} resize-none`}
      />
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {empty && ready && state !== "suggesting" ? (
          <button
            type="button"
            onClick={suggest}
            className={
              compact
                ? "text-[12px] text-[var(--color-ink-3)] underline underline-offset-2 hover:text-[var(--color-ink)]"
                : "inline-flex min-h-9 items-center justify-center rounded-[var(--radius-pill)] border border-[var(--color-rule)] bg-transparent px-3.5 text-[13.5px] text-[var(--color-ink)] transition-colors hover:border-[var(--color-ink-3)] hover:bg-[var(--color-paper-2)]"
            }
          >
            Suggest from the image
            <span className="sr-only"> for {filename}</span>
          </button>
        ) : null}
        {state === "error" && !empty ? (
          <button
            type="button"
            onClick={() => save(value)}
            className="text-[12px] text-[var(--color-ink-3)] underline underline-offset-2 hover:text-[var(--color-ink)]"
          >
            Try again
          </button>
        ) : null}
        <p
          id={`${id}-status`}
          role="status"
          className={`min-w-0 text-[12px] ${
            state === "error" ? "text-[var(--color-bad)]" : "text-[var(--color-ink-3)]"
          }`}
        >
          {status}
        </p>
      </div>
    </div>
  )
}
