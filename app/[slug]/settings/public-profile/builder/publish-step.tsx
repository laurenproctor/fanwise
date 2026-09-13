"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { publishProfileAction, type PublishResult } from "@/lib/public/publish-actions"
import type { ProfilePresentation } from "@/lib/public/profile-presentation"
import { issueHref, type ReadinessIssue } from "@/lib/public/publish-readiness"
import { publicRoutes, routes } from "@/lib/routes"
import { DraftStatus, ErrorGlyph, OkGlyph } from "./builder-status"
import { ProfilePreview } from "./profile-preview"

/**
 * Step 3 of the builder: review, then publish.
 *
 * The screen states two things that must never be confused: what the draft
 * is, shown in the final preview, and what the live profile is, stated in
 * words beside the button. Until Publish succeeds the live profile is
 * untouched, and the copy says so whenever there is a live profile to protect.
 *
 * Publish is enabled only when the server found nothing blocking. Pressing it
 * does not trust that: the action re-derives the same readiness against the
 * draft it is about to lock, and a draft changed since this page rendered is
 * refused rather than published unseen.
 */

export interface PublishSummary {
  detailsComplete: boolean
  selectedCount: number
  publicPath: string
}

export function PublishStep({
  workspaceSlug,
  origin,
  presentation,
  issues: initialIssues,
  summary,
  expectedDraftUpdatedAt,
  live,
}: {
  workspaceSlug: string
  origin: string
  presentation: ProfilePresentation
  issues: ReadinessIssue[]
  summary: PublishSummary
  expectedDraftUpdatedAt: string
  live: {
    status: "draft" | "published"
    handle: string
    hasUnpublishedChanges: boolean
  }
}) {
  const router = useRouter()
  const [issues, setIssues] = useState(initialIssues)
  const [publishing, setPublishing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [justPublished, setJustPublished] = useState<string | null>(null)
  const resultRef = useRef<HTMLDivElement>(null)

  const livePublished = live.status === "published"
  const upToDate = livePublished && !live.hasUnpublishedChanges
  const showPublished = justPublished !== null || upToDate
  const publishedPath = justPublished ?? publicRoutes.profile(live.handle)
  const ready = issues.length === 0

  useEffect(() => {
    if (justPublished) resultRef.current?.focus()
  }, [justPublished])

  const hrefs = {
    details: routes.publicProfileBuilder(workspaceSlug),
    products: routes.publicProfileBuilderProducts(workspaceSlug),
  }

  async function onPublish() {
    setPublishing(true)
    setMessage(null)
    let result: PublishResult
    try {
      result = await publishProfileAction(workspaceSlug, { expectedDraftUpdatedAt })
    } catch {
      result = {
        ok: false,
        kind: "failed",
        message: "Your profile could not be published. Nothing changed; try again.",
      }
    }
    setPublishing(false)

    if (result.ok) {
      setJustPublished(result.path)
      router.refresh()
      return
    }
    if (result.kind === "not_ready") setIssues(result.issues)
    else setMessage(result.message)
  }

  const heading = !ready
    ? "A few things need attention"
    : livePublished
      ? upToDate
        ? "Your profile is live"
        : "Your updates are ready"
      : "Your profile is ready"

  return (
    <div className="grid grid-cols-1 overflow-hidden rounded-[16px] border border-[var(--color-rule)] bg-[var(--color-card)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <section
        aria-labelledby="publish-heading"
        className="flex min-w-0 flex-col gap-6 px-5 py-8 sm:px-10"
      >
        <div className="flex flex-col gap-2">
          <span className="label-mono">Ready to publish</span>
          <h2
            id="publish-heading"
            className="font-display text-[32px] leading-[1.1] font-light tracking-[-0.03em] sm:text-[38px]"
          >
            {justPublished ? "Your profile is live" : heading}
          </h2>
          <p className="text-[16px] text-[var(--color-ink-2)]">
            Review the final details, then publish when everything looks right.
          </p>
        </div>

        <dl className="flex flex-col border-t border-[var(--color-rule)]">
          <SummaryRow
            ok={summary.detailsComplete && !issues.some((i) => i.step === 1)}
            term="Profile details"
            value={
              summary.detailsComplete && !issues.some((i) => i.step === 1)
                ? "Complete"
                : "Needs attention"
            }
            detail="Image, name, introduction, website, and social links"
          />
          <SummaryRow
            ok={!issues.some((i) => i.step === 2)}
            term="Products"
            value={`${summary.selectedCount} selected`}
            detail="Displayed in the chosen order"
          />
          <SummaryRow
            ok={!issues.some((i) => i.field === "handle")}
            term="Public address"
            value={issues.some((i) => i.field === "handle") ? "Unavailable" : "Available"}
            detail={`${origin.replace(/^https?:\/\//, "")}${summary.publicPath}`}
            breakAnywhere
          />
        </dl>

        {issues.length > 0 ? (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-[12px] border border-[var(--color-bad)] px-5 py-4"
          >
            <p className="text-[15px] text-[var(--color-ink)]">
              Fix {issues.length === 1 ? "this" : "these"} before publishing:
            </p>
            <ul className="flex flex-col gap-2">
              {issues.map((issue, index) => (
                <li key={`${issue.field}-${index}`} className="flex items-start gap-2 text-[14px]">
                  <ErrorGlyph />
                  <span>
                    {issue.message}{" "}
                    <Link
                      href={issueHref(issue, hrefs)}
                      className="whitespace-nowrap underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                    >
                      {issue.step === 1 ? "Go to Profile details" : "Go to Manage products"}
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {showPublished ? (
          <div
            ref={resultRef}
            tabIndex={-1}
            role="status"
            className="flex flex-col gap-4 rounded-[12px] border border-[var(--color-ok)] px-5 py-4 outline-none"
          >
            <p className="flex items-center gap-2 text-[16px] text-[var(--color-ink)]">
              <OkGlyph />
              {justPublished
                ? "Published. Your profile is live."
                : "Your live profile matches this draft."}
            </p>
            <p className="font-mono text-[14px] break-all text-[var(--color-ink)]">
              {origin.replace(/^https?:\/\//, "")}
              {publishedPath}
            </p>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <a
                href={publishedPath}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[15px] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
              >
                View public profile
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              <CopyLink url={`${origin}${publishedPath}`} />
              <Link
                href={hrefs.details}
                className="text-[15px] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
              >
                Edit profile
              </Link>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3 rounded-[12px] border border-[var(--color-rule)] bg-[var(--color-paper-2)] px-5 py-4">
            <InfoGlyph />
            <div className="flex flex-col gap-1">
              <p className="text-[15px] text-[var(--color-ink)]">What happens next</p>
              <p className="text-[14px] text-[var(--color-ink-2)]">
                Publishing makes this profile visible at your public address. Future edits stay in
                draft until you publish them.
              </p>
              {livePublished ? (
                <p className="text-[14px] text-[var(--color-ink-2)]">
                  Your live profile stays exactly as it is until you publish these updates.
                </p>
              ) : null}
            </div>
          </div>
        )}

        {message ? (
          <p
            role="alert"
            className="border-l-2 border-[var(--color-bad)] bg-[var(--color-paper-2)] py-2 pl-3 text-[14px]"
          >
            {message}{" "}
            <button
              type="button"
              onClick={() => router.refresh()}
              className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
            >
              Reload
            </button>
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 pt-2">
          {showPublished ? null : (
            <Button
              type="button"
              onClick={() => void onPublish()}
              disabled={!ready || publishing}
              aria-describedby={!ready ? "publish-blocked" : undefined}
              className="min-w-[180px] max-sm:w-full"
            >
              {publishing ? "Publishing…" : livePublished ? "Publish updates" : "Publish profile"}
            </Button>
          )}
          <Link
            href={hrefs.products}
            className="inline-flex min-h-11 items-center rounded-[6px] text-[15px] text-[var(--color-ink)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          >
            Back
          </Link>
          <DraftStatus status="saved" onRetry={() => {}} />
        </div>
        {!ready ? (
          <p id="publish-blocked" className="sr-only">
            Publishing is unavailable until the issues above are fixed.
          </p>
        ) : null}
      </section>

      <div className="min-w-0 border-t border-[var(--color-rule)] px-5 py-8 sm:px-8 lg:border-t-0 lg:border-l">
        <ProfilePreview
          heading="Final preview"
          subheading="This is what customers will see"
          origin={origin}
          presentation={presentation}
          published={showPublished}
          emptyProductsMessage="No products selected. Your profile will show an empty product section."
        />
      </div>
    </div>
  )
}

function SummaryRow({
  ok,
  term,
  value,
  detail,
  breakAnywhere = false,
}: {
  ok: boolean
  term: string
  value: string
  detail: string
  /** For a URL, which has no spaces to wrap at. Prose wraps at words. */
  breakAnywhere?: boolean
}) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 border-b border-[var(--color-rule)] py-4 sm:grid-cols-[auto_9rem_minmax(0,1fr)]">
      <span className="row-span-2 pt-0.5 sm:row-span-1">{ok ? <OkGlyph /> : <ErrorGlyph />}</span>
      <dt className="text-[16px] text-[var(--color-ink)]">{term}</dt>
      <dd className="flex min-w-0 flex-col gap-0.5 sm:col-start-3">
        <span className="text-[15px] text-[var(--color-ink)]">
          {value}
          <span className="sr-only">{ok ? "" : ", needs attention"}</span>
        </span>
        <span
          className={`text-[13px] text-[var(--color-ink-3)] ${breakAnywhere ? "break-all" : "break-words"}`}
        >
          {detail}
        </span>
      </dd>
    </div>
  )
}

function CopyLink({ url }: { url: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle")
  useEffect(() => {
    if (state === "idle") return
    const timer = setTimeout(() => setState("idle"), 2500)
    return () => clearTimeout(timer)
  }, [state])
  return (
    <>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(url).then(
            () => setState("copied"),
            () => setState("failed"),
          )
        }}
        className="text-[15px] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
      >
        {state === "copied" ? "Copied" : "Copy link"}
      </button>
      <span aria-live="polite" className="sr-only">
        {state === "copied"
          ? "Link copied."
          : state === "failed"
            ? "Couldn't copy. The address is shown above."
            : ""}
      </span>
    </>
  )
}

function InfoGlyph() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className="mt-0.5 shrink-0 text-[var(--color-accent)]"
    >
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 11v6M12 7.5v.5" strokeLinecap="round" />
    </svg>
  )
}
