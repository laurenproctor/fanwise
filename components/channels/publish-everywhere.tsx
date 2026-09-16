"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { FormError } from "@/components/ui/form-error"
import { publishEverywhereAction } from "@/lib/publishing/actions"
import { SKIP_REASON_TEXT, type SkipReason } from "@/lib/publishing/run"
import { useRegisterCommands } from "@/components/commands/command-provider"
import { ShortcutHint, useAriaKeyShortcuts } from "@/components/commands/shortcut-hint"
import { EDITOR_COMMAND_IDS, PUBLISH_SHORTCUT } from "@/lib/commands/workspace"

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
  /** What a not-ready channel still needs, one sentence each. */
  needs: string[]
}

export function PublishEverywhere({
  workspaceSlug,
  productId,
  attemptable,
  skips,
  blocker = null,
}: {
  workspaceSlug: string
  productId: string
  /**
   * Why the product may not go to any channel yet, before any channel's own
   * rules (a font's readiness blockers). The action refuses the same thing.
   */
  blocker?: string | null
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

  /*
   * The shortcut is the button: same `run`, same server action, same
   * refusal. When the button is disabled the palette says why, in the words
   * the skip list already uses — the first thing a channel still needs, or
   * the blocker that stops every channel at once.
   */
  const firstNeed = skips.flatMap((skip) => skip.needs)[0] ?? null
  const disabledReason = pending
    ? "Publishing is starting."
    : (blocker ??
      (attemptable === 0
        ? (firstNeed ?? "No channel is ready to receive this product yet.")
        : null))
  useRegisterCommands([
    {
      id: EDITOR_COMMAND_IDS.publish,
      label: "Publish everywhere",
      description:
        attemptable === 1
          ? "Send this product to the one channel that is ready."
          : `Send this product to the ${attemptable} channels that are ready.`,
      group: "page",
      scope: "page",
      keywords: ["publish", "send", "channels", "listing"],
      shortcuts: [PUBLISH_SHORTCUT],
      enabled: disabledReason === null,
      disabledReason: disabledReason ?? undefined,
      execute: run,
    },
  ])
  const publishKeys = useAriaKeyShortcuts(EDITOR_COMMAND_IDS.publish)

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
        <span className="inline-flex items-center gap-3">
          <ShortcutHint commandId={EDITOR_COMMAND_IDS.publish} />
          <Button
            type="button"
            onClick={run}
            disabled={pending || attemptable === 0 || blocker !== null}
            aria-keyshortcuts={publishKeys}
          >
            {pending ? "Starting…" : "Publish everywhere"}
          </Button>
        </span>
      </div>

      {blocker ? <p className="text-[14px] text-[var(--color-ink-2)]">{blocker}</p> : null}

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
                {skip.needs.length > 0 ? (
                  <ul className="mt-1 flex w-full list-disc flex-col gap-0.5 pl-5 text-[13px] text-[var(--color-ink-2)]">
                    {skip.needs.map((need) => (
                      <li key={need}>{need}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
