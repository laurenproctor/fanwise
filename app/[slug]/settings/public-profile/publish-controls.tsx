"use client"

import { useEffect, useId, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { setProfilePublishedAction } from "@/lib/public/actions"
import { publicRoutes } from "@/lib/routes"
import type { PublicPageStatus } from "@/lib/public/types"

/**
 * The address, and the switch.
 *
 * Publishing is one deliberate act with its own button, never a side effect of
 * saving a field. The two are separated all the way down: the save action
 * never touches `status`, and this action never touches anything else.
 *
 * Unpublishing is the one that needs care, because a creator pressing it is
 * usually in a hurry and always means it. It is not behind a modal — a
 * confirmation dialog for an action that is instantly reversible is friction
 * pretending to be safety — but the button says what will happen to the
 * products beneath it, which is the part people do not expect.
 */
export function PublishControls({
  workspaceSlug,
  handle,
  status,
  appOrigin,
  publishedCount,
  draftCount,
}: {
  workspaceSlug: string
  handle: string
  status: PublicPageStatus
  appOrigin: string
  publishedCount: number
  draftCount: number
}) {
  const [pending, startTransition] = useTransition()
  const published = status === "published"
  const url = `${appOrigin}${publicRoutes.profile(handle)}`

  return (
    <div className="flex flex-col gap-7">
      <AddressRow url={url} />

      <div className="flex flex-col gap-4 rounded-[14px] border border-[var(--color-rule)] p-5">
        <div className="flex flex-wrap items-center gap-3">
          {/*
            A dot and a word, per docs/design-system.md: state has to be
            readable from form as well as colour, so the label is never the
            colour's only carrier.
          */}
          <span
            className={`inline-flex items-center gap-2 rounded-[var(--radius-pill)] border px-3 py-1 font-mono text-[10px] tracking-[0.12em] uppercase ${
              published
                ? "border-[var(--color-ok)]/30 bg-[var(--color-ok)]/[0.09] text-[var(--color-ok)]"
                : "border-[var(--color-rule)] bg-[var(--color-paper-2)] text-[var(--color-ink-3)]"
            }`}
          >
            <span
              aria-hidden
              className={`h-[5px] w-[5px] rounded-full ${
                published ? "bg-[var(--color-ok)]" : "bg-[var(--color-ink-3)]"
              }`}
            />
            {published ? "Live" : "Draft"}
          </span>

          <p className="text-[14px] text-[var(--color-ink-2)]">
            {published
              ? `Anyone with the link can see this profile${
                  publishedCount > 0
                    ? ` and the ${publishedCount} ${publishedCount === 1 ? "product" : "products"} published on it`
                    : ""
                }.`
              : "Only you can see this profile."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <form
            action={() => {
              startTransition(async () => {
                await setProfilePublishedAction(workspaceSlug, !published)
              })
            }}
          >
            <Button type="submit" variant={published ? "secondary" : "primary"} disabled={pending}>
              {pending
                ? published
                  ? "Unpublishing…"
                  : "Publishing…"
                : published
                  ? "Unpublish"
                  : "Publish profile"}
            </Button>
          </form>

          {published ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[14px] text-[var(--color-ink-2)] underline underline-offset-4 hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
            >
              View public profile
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : null}
        </div>

        <p className="text-[13px] text-[var(--color-ink-3)]">
          {published
            ? "Unpublishing hides the profile and every product page under it immediately, including ones you published individually. Nothing is deleted."
            : draftCount > 0
              ? `${draftCount} product ${draftCount === 1 ? "page is" : "pages are"} waiting. Publishing the profile does not publish them — each product has its own switch in its editor.`
              : "Publishing makes the profile visible. Products stay private until you publish each one from its editor."}
        </p>
      </div>
    </div>
  )
}

/**
 * The public URL, shown and copyable.
 *
 * Unlike the workspace address on the settings page, this one *can* change:
 * handles carry a redirect history, so an old address keeps working. The hint
 * says so, because a creator who has read the other page has been told the
 * opposite about a URL that looks much the same.
 */
function AddressRow({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  const labelId = useId()
  const hintId = useId()

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2500)
    return () => clearTimeout(timer)
  }, [copied])

  const display = url.replace(/^https?:\/\//, "")

  return (
    <div className="flex flex-col gap-2">
      <span className="label-mono" id={labelId}>
        Public address
      </span>
      <div className="flex items-stretch overflow-hidden rounded-[10px] border border-[var(--color-rule)] bg-[var(--color-paper-2)]">
        <output
          aria-labelledby={labelId}
          aria-describedby={hintId}
          className="min-w-0 flex-1 truncate px-3 py-2.5 font-mono text-[13px] text-[var(--color-ink-2)]"
        >
          {display}
        </output>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(url).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }}
          className="shrink-0 border-l border-[var(--color-rule)] px-4 text-[14px] text-[var(--color-ink)] hover:bg-[var(--color-rule-2)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p id={hintId} className="text-[13px] text-[var(--color-ink-3)]">
        Change your handle whenever you like: the old address keeps working and redirects here, so
        links you have already shared do not break.
      </p>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? "Public address copied to the clipboard." : ""}
      </span>
    </div>
  )
}
