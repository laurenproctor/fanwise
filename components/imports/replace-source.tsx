"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { FormError } from "@/components/ui/form-error"
import { FIELD_INPUT_CLASS } from "@/components/ui/field"
import { validateSourceUrl } from "@/lib/imports/url"

/**
 * Pointing this import at a different link.
 *
 * Two things a creator is entitled to know before they press anything, and both
 * are said here rather than discovered afterwards:
 *
 *   - **Nothing they have done is lost.** The product, their edits, the
 *     uploaded files, the licence and the attestation all stay. Only the page
 *     the evidence came from changes, and the screen shows what is different
 *     about it before any of it is accepted.
 *   - **Discarding is a different thing**, and it is offered separately rather
 *     than being what Replace quietly does. It deletes the product, which is
 *     the right answer for a paste that was a mistake and the wrong one for a
 *     link that has simply moved.
 *
 * The shape check runs here as well as on the server, to save a round trip on
 * an obvious mistake. The boundary is `lib/net/outbound.ts` and its answer is
 * the one that decides whether anything is fetched.
 */
export function ReplaceSourceDialog({
  currentUrl,
  onReplace,
  onCancel,
  onDiscard,
}: {
  currentUrl: string
  onReplace: (url: string) => Promise<string | null>
  onCancel: () => void
  onDiscard: () => void
}) {
  const [url, setUrl] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <section
      aria-labelledby="replace-source-heading"
      className="flex flex-col gap-4 rounded-[16px] border border-[var(--color-rule)] bg-[var(--color-card)] px-5 py-5"
    >
      <div className="flex flex-col gap-1.5">
        <h2
          id="replace-source-heading"
          className="font-display text-[20px] font-light tracking-[-0.02em]"
        >
          Use a different link
        </h2>
        <p className="max-w-prose text-[14px] leading-[1.55] text-[var(--color-ink-2)]">
          Your listing, your files, your licence and your ownership confirmation all stay exactly as
          they are. Fanwise reads the new page and shows you what is different; nothing is replaced
          until you edit a field yourself.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="replace-source-url" className="label-mono">
          New product link
        </label>
        <input
          id="replace-source-url"
          type="url"
          inputMode="url"
          spellCheck={false}
          value={url}
          autoFocus
          disabled={pending}
          aria-describedby="replace-source-current"
          onChange={(event) => {
            setUrl(event.target.value)
            setError(null)
          }}
          placeholder="https://"
          className={FIELD_INPUT_CLASS}
        />
        <span
          id="replace-source-current"
          className="truncate text-[13px] text-[var(--color-ink-3)]"
        >
          Currently reading {currentUrl}
        </span>
      </div>

      <FormError message={error} />

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={pending}
          onClick={() => {
            const checked = validateSourceUrl(url)
            if (!checked.ok) {
              setError(checked.message)
              return
            }
            startTransition(() => {
              void onReplace(checked.url).then(setError)
            })
          }}
        >
          {pending ? "Reading…" : "Read this link instead"}
        </Button>
        <Button type="button" variant="secondary" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
        <button
          type="button"
          disabled={pending}
          onClick={onDiscard}
          className="ml-auto min-h-11 rounded-[6px] text-[13px] text-[var(--color-ink-2)] underline underline-offset-4 hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--color-accent)]"
        >
          Discard this import and its product
        </button>
      </div>
    </section>
  )
}
