"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { FormError } from "@/components/ui/form-error"
import { publishEverywhereAction } from "@/lib/publishing/actions"
import { SKIP_REASON_TEXT, type SkipReason } from "@/lib/publishing/run"

/**
 * The central action: one product, every channel that can take it.
 *
 * The channels it would skip are named here, before the click, rather than
 * reported afterwards. A creator who presses this and sees two of four channels
 * go quiet deserves to have known that in advance, and the reason is the useful
 * half: "not connected" is a different afternoon's work from "not ready".
 *
 * What it never shows is a status for the product. The count is the headline
 * and the per-channel cards below carry the detail, per ADR 0005.
 */

export interface RunChannelSummary {
  channelName: string
  reason: SkipReason
}

export function PublishEverywhere({
  workspaceSlug,
  productId,
  attemptable,
  skips,
}: {
  workspaceSlug: string
  productId: string
  /** How many channels one click would actually send to, decided on the server. */
  attemptable: number
  skips: RunChannelSummary[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  function run() {
    setError(null)
    setNotice(null)
    startTransition(async () => {
      const result = await publishEverywhereAction(workspaceSlug, productId)
      setError(result.error)
      setNotice(result.notice)
      // The jobs settle in the background, so the cards below are what change.
      router.refresh()
    })
  }

  return (
    <section
      aria-labelledby="publish-everywhere-heading"
      className="flex flex-col gap-4 rounded-[14px] border border-[var(--color-rule)] bg-[var(--color-card)] p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h2
            id="publish-everywhere-heading"
            className="font-display text-[22px] font-normal tracking-[-0.02em]"
          >
            Publish everywhere
          </h2>
          <p className="text-[14px] text-[var(--color-ink-2)]">
            {attemptable === 0
              ? "No channel is ready to receive this product yet."
              : attemptable === 1
                ? "One channel is ready to receive this product."
                : `${attemptable} channels are ready to receive this product.`}
          </p>
        </div>

        {/*
          Disabled when there is nothing to send, rather than hidden: the
          channels below explain why, and a button that vanishes teaches
          nothing. It is the page's one primary action either way.
        */}
        <Button type="button" onClick={run} disabled={pending || attemptable === 0}>
          {pending ? "Starting…" : "Publish everywhere"}
        </Button>
      </div>

      <FormError message={error} />

      {notice ? (
        <p
          role="status"
          className="border-l-2 border-[var(--color-ok)] bg-[var(--color-paper-2)] py-2 pl-3 text-[14px] text-[var(--color-ink)]"
        >
          {notice}
        </p>
      ) : null}

      {skips.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="label-mono">Will be skipped</h3>
          <ul className="flex flex-col gap-1.5">
            {skips.map((skip) => (
              <li
                key={`${skip.channelName}:${skip.reason}`}
                className="flex flex-wrap items-baseline gap-x-2 text-[14px]"
              >
                <span className="text-[var(--color-ink)]">{skip.channelName}</span>
                <span className="text-[var(--color-ink-2)]">{SKIP_REASON_TEXT[skip.reason]}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
