"use client"

import { useEffect, useId, useState, useTransition } from "react"
import { Button, ButtonLink } from "@/components/ui/button"
import { unpublishProfileAction } from "@/lib/public/publish-actions"
import { publicRoutes, routes } from "@/lib/routes"
import type { PublicPageStatus } from "@/lib/public/types"

/**
 * Where the public profile stands, and the two things to do about it.
 *
 * Editing and publishing both live in the builder, so this is an overview:
 * the address, whether it is live, a way into the builder, and Unpublish.
 * Unpublish stays here rather than in the builder because it is the one action
 * a creator in a hurry needs to find without walking three steps.
 *
 * Unpublishing is not behind a modal — a confirmation for an instantly
 * reversible action is friction pretending to be safety — but the copy says
 * what happens to the products beneath it, and that the draft is kept.
 */
export function PublishControls({
  workspaceSlug,
  handle,
  status,
  appOrigin,
  publishedCount,
  hasUnpublishedChanges,
}: {
  workspaceSlug: string
  handle: string
  status: PublicPageStatus
  appOrigin: string
  publishedCount: number
  hasUnpublishedChanges: boolean
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
            readable from form as well as colour.
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
            {published ? "Live" : "Not published"}
          </span>

          <p className="text-[14px] text-[var(--color-ink-2)]">
            {published
              ? `Anyone with the link can see this profile${
                  publishedCount > 0
                    ? ` and the ${publishedCount} ${publishedCount === 1 ? "product" : "products"} on it`
                    : ""
                }.`
              : "Only you can see this profile."}
          </p>
        </div>

        {published && hasUnpublishedChanges ? (
          <p className="border-l-2 border-[var(--color-warn)] bg-[var(--color-paper-2)] py-2 pl-3 text-[14px] text-[var(--color-ink)]">
            You have draft changes that aren&rsquo;t live yet. The public profile stays as it is
            until you publish them.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-4">
          <ButtonLink href={routes.publicProfileBuilder(workspaceSlug)}>
            {published ? "Edit public profile" : "Build your profile"}
          </ButtonLink>

          {published ? (
            <>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[14px] text-[var(--color-ink-2)] underline underline-offset-4 hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
              >
                View public profile
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              <form
                action={() => {
                  startTransition(async () => {
                    await unpublishProfileAction(workspaceSlug)
                  })
                }}
              >
                <Button type="submit" variant="secondary" disabled={pending}>
                  {pending ? "Unpublishing…" : "Unpublish"}
                </Button>
              </form>
            </>
          ) : null}
        </div>

        <p className="text-[13px] text-[var(--color-ink-3)]">
          {published
            ? "Unpublishing hides the profile and every product page under it immediately. Nothing is deleted, and your draft is kept."
            : "Publishing happens in the builder's last step, after you review the final preview."}
        </p>
      </div>
    </div>
  )
}

/** The public URL, shown and copyable. */
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
        Once your profile has been published, changing its address keeps the old one working as a
        redirect, so links you have already shared do not break.
      </p>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? "Public address copied to the clipboard." : ""}
      </span>
    </div>
  )
}
