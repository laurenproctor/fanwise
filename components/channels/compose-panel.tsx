"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { FormError } from "@/components/ui/form-error"
import { composeListingAction } from "@/lib/ai/actions"
import { useBackgroundRefresh } from "@/lib/use-background-refresh"
import type { GenerationSummary } from "@/lib/ai/queries"

/**
 * Compose with AI, and what came of the last attempt.
 *
 * One button and one sentence. The sentence is the part that carries the
 * product's promise: a rejected generation says what the model claimed and
 * that nothing was changed, in those words, because the alternative is a
 * listing that quietly holds a number nobody can vouch for.
 *
 * The generation runs in a background job. While it is pending or running the
 * page refreshes itself until the row settles, the same way a publish is
 * watched, and the editor below remounts on the new copy when it lands.
 */

export interface ComposePanelProps {
  workspaceSlug: string
  listingId: string
  channelName: string
  /** False when the deployment has no model configured. The button is not offered. */
  configured: boolean
  generation: GenerationSummary | null
  /** True when composed copy is waiting for a person to read and save it. */
  awaitingReview: boolean
}

function when(iso: string | null): string {
  if (!iso) return ""
  const date = new Date(iso)
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export function ComposePanel({
  workspaceSlug,
  listingId,
  channelName,
  configured,
  generation,
  awaitingReview,
}: ComposePanelProps) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const inFlight = generation?.status === "pending" || generation?.status === "running"
  useBackgroundRefresh(inFlight)

  function compose() {
    setError(null)
    setNotice(null)
    start(async () => {
      const result = await composeListingAction(workspaceSlug, listingId)
      if (result.error) setError(result.error)
      else setNotice(result.notice)
    })
  }

  const hasCopy = generation?.status === "succeeded"

  return (
    <section
      aria-labelledby="compose-heading"
      className="flex flex-col gap-4 rounded-[14px] border border-[var(--color-rule)] bg-[var(--color-card)] p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <span id="compose-heading" className="label-mono">
            Compose with AI
          </span>
          <p className="max-w-prose text-[13px] text-[var(--color-ink-2)]">
            Writes this listing for {channelName} from your product&rsquo;s facts. It can change the
            wording; it cannot add a fact you have not entered, and a draft that tries is refused.
          </p>
        </div>

        {configured ? (
          <Button
            type="button"
            variant={hasCopy ? "secondary" : "primary"}
            onClick={compose}
            disabled={pending || inFlight}
          >
            {pending || inFlight ? "Composing…" : hasCopy ? "Compose again" : "Compose with AI"}
          </Button>
        ) : (
          <span className="label-mono text-[var(--color-ink-3)]">Not configured here</span>
        )}
      </div>

      <FormError message={error} />

      {notice && !error ? (
        <p className="label-mono text-[var(--color-ink-3)]" role="status">
          {notice}
        </p>
      ) : null}

      {generation && !inFlight ? <Outcome generation={generation} /> : null}

      {awaitingReview ? (
        <p
          className="border-l-2 border-[var(--color-warn)] pl-3 text-[13px] text-[var(--color-ink-2)]"
          role="status"
        >
          Composed copy is below. Read it, change what you like, and save. Publishing waits until
          you have.
        </p>
      ) : null}
    </section>
  )
}

function Outcome({ generation }: { generation: GenerationSummary }) {
  switch (generation.status) {
    case "succeeded":
      return (
        <p className="text-[13px] text-[var(--color-ink-2)]" role="status">
          Composed {when(generation.completedAt)}.
        </p>
      )
    case "rejected":
      return (
        <p
          className="border-l-2 border-[var(--color-bad)] pl-3 text-[13px] text-[var(--color-ink)]"
          role="status"
        >
          {generation.message ?? "The draft claimed something not in your product data."} Nothing
          was changed. Add the fact to the product if it is true, or compose again.
        </p>
      )
    case "failed":
      return <FormError message={generation.message ?? "Composing did not finish."} />
    default:
      return null
  }
}
