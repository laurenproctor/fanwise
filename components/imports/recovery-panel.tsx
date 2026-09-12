import Link from "next/link"
import type { RecoveryAction, RecoveryOption } from "@/lib/imports/types"

/**
 * The way out of a source that will not open.
 *
 * Every unhappy state on this screen carries this panel, and the reason is a
 * rule rather than a courtesy: a link that is private, gone or unreadable is
 * the common case, not the edge, and a dead end here is a creator who leaves.
 * `SourceAnalysis` makes the recoveries part of the failure itself, so no
 * caller has to remember to offer them.
 *
 * **What is wired and what is not is said plainly.** Pasting code and uploading
 * a project need somewhere to put the bytes, and the table that holds them is
 * phase 2 of `docs/product-link-import.md`. Until then those two are marked the
 * way `components/onboarding/import-listing-action.tsx` marks its own promise —
 * aria-disabled rather than disabled, so they stay in the tab order and a
 * keyboard user learns they are coming instead of never finding them.
 */

const TONE = {
  private: "border-[var(--color-warn)]",
  notFound: "border-[var(--color-warn)]",
  unsupported: "border-[var(--color-warn)]",
  failed: "border-[var(--color-bad)]",
} as const

export type RecoveryTone = keyof typeof TONE

const HEADINGS: Record<RecoveryTone, string> = {
  private: "That link needs permission",
  notFound: "Nothing is published there",
  unsupported: "Fanwise cannot read that link yet",
  failed: "That did not finish",
}

export interface RecoveryHandlers {
  onReplaceLink: () => void
  onRetry: () => void
  /** Where "continue manually" goes. The existing new-product form. */
  manualHref: string
}

/** Which recoveries have somewhere to go today. The rest say so. */
const WIRED: readonly RecoveryAction[] = ["replace_link", "retry", "continue_manually"]

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--color-accent)]"

export function RecoveryPanel({
  tone,
  message,
  recoveries,
  handlers,
}: {
  tone: RecoveryTone
  message: string
  recoveries: readonly RecoveryOption[]
  handlers: RecoveryHandlers
}) {
  return (
    <section
      aria-labelledby="import-recovery-heading"
      className={`flex flex-col gap-5 rounded-[16px] border-l-2 border-t border-r border-b border-[var(--color-rule)] bg-[var(--color-card)] px-6 py-7 ${TONE[tone]}`}
    >
      <div className="flex flex-col gap-2">
        <h2
          id="import-recovery-heading"
          className="font-display text-[22px] font-light tracking-[-0.02em]"
        >
          {HEADINGS[tone]}
        </h2>
        {/*
          Written by Fanwise, never a provider's own error text. Rule 8: the
          original is persisted and normalized before anybody reads it.
        */}
        <p className="max-w-prose text-[15px] leading-[1.6] text-[var(--color-ink-2)]">{message}</p>
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="label-mono">What you can do</h3>
        <ul className="flex flex-col divide-y divide-[var(--color-rule-2)]">
          {recoveries.map((option) => (
            <li key={option.action} className="flex flex-col gap-1 py-3.5">
              <RecoveryControl option={option} handlers={handlers} />
              <p className="text-[13px] leading-[1.5] text-[var(--color-ink-2)]">
                {option.description}
              </p>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-[13px] leading-[1.55] text-[var(--color-ink-3)]">
        Fanwise never asks for your password to another service, and never stores a cookie or a
        session from one.
      </p>
    </section>
  )
}

function RecoveryControl({
  option,
  handlers,
}: {
  option: RecoveryOption
  handlers: RecoveryHandlers
}) {
  const label = `text-[15px] font-medium ${FOCUS} inline-flex min-h-11 items-center rounded-[6px]`

  if (option.action === "continue_manually") {
    return (
      <Link
        href={handlers.manualHref}
        className={`${label} text-[var(--color-accent)] underline underline-offset-4 hover:text-[var(--color-ink)]`}
      >
        {option.label}
      </Link>
    )
  }

  if (option.action === "replace_link" || option.action === "retry") {
    return (
      <button
        type="button"
        onClick={option.action === "retry" ? handlers.onRetry : handlers.onReplaceLink}
        className={`${label} self-start text-[var(--color-accent)] underline underline-offset-4 hover:text-[var(--color-ink)]`}
      >
        {option.label}
      </button>
    )
  }

  // publish_public_link is guidance and has no control of its own by design:
  // the thing to press afterwards is Replace link, which is in this same list.
  if (option.action === "publish_public_link") {
    return <span className={`${label} text-[var(--color-ink)]`}>{option.label}</span>
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <button
        type="button"
        aria-disabled="true"
        aria-describedby={`recovery-${option.action}-availability`}
        className={`${label} cursor-not-allowed text-[var(--color-ink-2)]`}
      >
        {option.label}
      </button>
      <span
        id={`recovery-${option.action}-availability`}
        className="rounded-[var(--radius-pill)] border border-[var(--color-rule)] px-2 py-[3px] font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-2)]"
      >
        Not built yet
      </span>
    </span>
  )
}

export { WIRED as WIRED_RECOVERY_ACTIONS }
