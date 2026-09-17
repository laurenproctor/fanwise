"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { FormError } from "@/components/ui/form-error"
import { setDeliverySetupAction } from "@/lib/channels/actions"
import type { DeliverySetupSpec } from "@/lib/channels/types"
import type { DeliveryAutomationState } from "@/lib/delivery/setup"

/**
 * A channel's one-time delivery setup, on its Channels card (ADR 0013).
 *
 * Declared by the adapter and rendered generically: a why, numbered steps, the
 * exact text to paste with a Copy button, and a confirmation. Confirming is a
 * claim the creator makes about their own shop — Fanwise has no way to read the
 * template — so the button says what it unlocks rather than "Done".
 */
export function DeliverySetup({
  workspaceSlug,
  connectionId,
  setup,
  confirmed,
  automation,
}: {
  workspaceSlug: string
  connectionId: string
  setup: DeliverySetupSpec
  confirmed: boolean
  /** What the channel switched on for itself at authorization (ADR 0015). */
  automation: DeliveryAutomationState
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(!confirmed)

  function record(next: boolean) {
    setError(null)
    startTransition(async () => {
      const result = await setDeliverySetupAction(workspaceSlug, connectionId, next)
      setError(result.error)
      if (!result.error) {
        setOpen(!next)
        router.refresh()
      }
    })
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(setup.snippet)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // A browser without clipboard access still shows the text to select by hand.
      setError("Copy is not available here. Select the snippet and copy it by hand.")
    }
  }

  if (confirmed && !open) {
    return (
      <div className="grid gap-1.5 border-l-2 border-[var(--color-ok)] py-1.5 pl-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="label-mono text-[var(--color-ok)]">Set up</span>
          <span className="text-[13px] text-[var(--color-ink-2)]">{setup.title}</span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-[13px] text-[var(--color-ink-3)] underline underline-offset-4 hover:text-[var(--color-ink)]"
          >
            Show instructions
          </button>
        </div>
        <AutomationNote setup={setup} confirmed={confirmed} automation={automation} />
      </div>
    )
  }

  return (
    <div className="grid gap-3 border-l-2 border-[var(--color-warn)] bg-[var(--color-paper-2)] p-4">
      <div className="grid gap-1">
        <span className="label-mono text-[var(--color-ink)]">{setup.title}</span>
        <p className="max-w-prose text-[13px] text-[var(--color-ink-2)]">{setup.description}</p>
      </div>

      <ol className="grid gap-1.5">
        {setup.steps.map((step, index) => (
          <li key={step} className="flex gap-2.5 text-[13px] text-[var(--color-ink)]">
            <span className="tabular font-mono text-[11px] text-[var(--color-ink-3)]">
              {index + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="label-mono">Snippet</span>
          <button
            type="button"
            onClick={copy}
            className="text-[13px] text-[var(--color-ink-2)] underline underline-offset-4 hover:text-[var(--color-ink)]"
          >
            {copied ? "Copied" : "Copy snippet"}
          </button>
        </div>
        <pre className="max-h-56 overflow-auto rounded-[8px] border border-[var(--color-rule)] bg-[var(--color-card)] p-3 font-mono text-[12px] leading-relaxed whitespace-pre text-[var(--color-ink)]">
          {setup.snippet}
        </pre>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {confirmed ? (
          <>
            <Button onClick={() => setOpen(false)} disabled={pending}>
              Hide instructions
            </Button>
            <button
              type="button"
              onClick={() => record(false)}
              disabled={pending}
              className="text-[13px] text-[var(--color-ink-3)] underline underline-offset-4 hover:text-[var(--color-ink)] disabled:opacity-50"
            >
              I removed it
            </button>
          </>
        ) : (
          <>
            <Button onClick={() => record(true)} disabled={pending}>
              {pending ? "Saving…" : "I've added it"}
            </Button>
            <span className="text-[12px] text-[var(--color-ink-3)]">
              Products can then go on sale here in one click.
            </span>
          </>
        )}
      </div>

      <AutomationNote setup={setup} confirmed={confirmed} automation={automation} />

      <FormError message={error} />
    </div>
  )
}

/**
 * What confirming switches on, and whether the switch took.
 *
 * The sentence is the adapter's. The state is what the channel recorded at
 * authorization: on, or the one-line reason it could not be, which is almost
 * always a store authorized before the permission existed and is answered by
 * the Reconnect the card already offers.
 */
function AutomationNote({
  setup,
  confirmed,
  automation,
}: {
  setup: DeliverySetupSpec
  confirmed: boolean
  automation: DeliveryAutomationState
}) {
  if (!setup.automation) return null

  if (automation.state === "failed") {
    return (
      <p className="max-w-prose text-[12px] text-[var(--color-warn)]">
        Marking orders fulfilled is not switched on for this store: {automation.message} Reconnect
        the store to switch it on.
      </p>
    )
  }

  return (
    <p className="max-w-prose text-[12px] text-[var(--color-ink-3)]">
      {setup.automation}
      {confirmed && automation.state === "unknown"
        ? " Reconnect the store once to switch this on."
        : null}
    </p>
  )
}
