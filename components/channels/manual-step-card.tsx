"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { FormError } from "@/components/ui/form-error"
import { completeManualStepAction } from "@/lib/publishing/actions"

/**
 * One thing a channel's API cannot do, and the creator can.
 *
 * The shape is ADR 0001's: honest about why the step exists, specific about
 * what to do, and short enough to actually be done. The "why" line is not
 * apology copy. A creator who does not know Shopify has no digital-file API
 * reasonably assumes Fanwise is being lazy, and will assume it again on every
 * product.
 *
 * Completing the last gating step takes the product live on the channel, so the
 * button says so. A button labelled "Mark done" that quietly publishes to a
 * storefront is a button that gets clicked to see what it does.
 */

export interface ManualStepCardData {
  key: string
  label: string
  description: string
  instructions: string[]
  completed: boolean
  needsDeliverable: boolean
}

export function ManualStepCard({
  workspaceSlug,
  listingId,
  step,
  deliverable,
  activates,
  onDone,
}: {
  workspaceSlug: string
  listingId: string
  step: ManualStepCardData
  deliverable: { assetId: string; filename: string } | null
  /** True when completing this step is what takes the product live. */
  activates: boolean
  onDone: (notice: string | null) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function complete() {
    setError(null)
    startTransition(async () => {
      const result = await completeManualStepAction(workspaceSlug, listingId, step.key)
      setError(result.error)
      if (!result.error) onDone(result.notice)
    })
  }

  if (step.completed) {
    return (
      <div className="flex items-center gap-2 border-l-2 border-[var(--color-ok)] py-1.5 pl-3">
        <span className="label-mono text-[var(--color-ok)]">Done</span>
        <span className="text-[13px] text-[var(--color-ink-2)]">{step.label}</span>
      </div>
    )
  }

  return (
    <div className="grid gap-3 border-l-2 border-[var(--color-warn)] bg-[var(--color-paper-2)] p-4 pl-4">
      <div className="grid gap-1">
        <span className="label-mono text-[var(--color-ink)]">{step.label}</span>
        <p className="max-w-prose text-[13px] text-[var(--color-ink-2)]">{step.description}</p>
      </div>

      <ol className="grid gap-1.5">
        {step.instructions.map((instruction, index) => (
          <li key={instruction} className="flex gap-2.5 text-[13px] text-[var(--color-ink)]">
            <span className="tabular font-mono text-[11px] text-[var(--color-ink-3)]">
              {index + 1}
            </span>
            <span>
              {instruction}
              {/*
                The download sits on the step that needs it rather than in a
                files section three screens away. A step that sends someone
                looking for a file is a step that does not get finished.
              */}
              {index === 0 && step.needsDeliverable && deliverable ? (
                <>
                  {" "}
                  <a
                    className="underline underline-offset-2 hover:text-[var(--color-accent)]"
                    href={`/w/${workspaceSlug}/assets/${deliverable.assetId}/download`}
                  >
                    {deliverable.filename}
                  </a>
                </>
              ) : null}
            </span>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={complete} disabled={pending}>
          {pending ? "Saving…" : activates ? "I've attached it, take it live" : "Mark done"}
        </Button>
        {activates ? (
          <span className="text-[12px] text-[var(--color-ink-3)]">
            This puts the product on sale.
          </span>
        ) : null}
      </div>

      <FormError message={error} />
    </div>
  )
}
