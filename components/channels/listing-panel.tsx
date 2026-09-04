"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { FormError } from "@/components/ui/form-error"
import { buildListingAction } from "@/lib/channels/actions"
import { ReadinessBar } from "./readiness-bar"
import { RequirementList } from "./requirement-list"
import type { Readiness, RequirementResult } from "@/lib/channels/types"

/**
 * One product, its channels, and what each of them would reject.
 *
 * The shape follows the workspace window in design/marketing/landing.html:
 * canonical product on the left, derived channel listings on the right, each
 * with its own status. Editing a listing by hand is A4; this builds and judges.
 *
 * The action row is derived from capabilities, which is the whole point. An
 * assisted channel renders no publish affordance at all, rather than a disabled
 * one, because a greyed-out button still says "this will work later" and here
 * it never will.
 */

export interface ChannelListingCard {
  connectionId: string
  channelName: string
  integrationType: "api" | "assisted"
  canPublish: boolean
  listingId: string | null
  title: string | null
  statusSource: "verified" | "self_reported" | null
  readiness: Readiness | null
  results: RequirementResult[]
}

export function ListingPanel({
  workspaceSlug,
  productId,
  cards,
}: {
  workspaceSlug: string
  productId: string
  cards: ChannelListingCard[]
}) {
  const [error, setError] = useState<string | null>(null)
  const [buildingFor, setBuildingFor] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function build(connectionId: string) {
    setError(null)
    setBuildingFor(connectionId)
    startTransition(async () => {
      const result = await buildListingAction(workspaceSlug, productId, connectionId)
      setError(result.error)
      setBuildingFor(null)
    })
  }

  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-start gap-4 rounded-[14px] border border-dashed border-[var(--color-rule)] p-8">
        <span className="label-mono">No channels connected</span>
        <p className="max-w-prose text-[15px] text-[var(--color-ink-2)]">
          Connect a channel and Fanwise will build this product a listing for it, then tell you
          exactly what that channel would reject.
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      <FormError message={error} />

      {cards.map((card) => (
        <section
          key={card.connectionId}
          className="grid gap-4 rounded-[14px] border border-[var(--color-rule)] bg-[var(--color-card)] p-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="grid gap-1">
              <h3 className="font-display text-[19px] font-normal tracking-[-0.02em]">
                {card.channelName}
              </h3>
              <span className="label-mono">
                {card.integrationType === "api" ? "Automatic" : "Assisted"}
              </span>
            </div>

            {card.readiness ? (
              <div className="min-w-[180px]">
                <ReadinessBar readiness={card.readiness} />
              </div>
            ) : null}
          </div>

          {card.listingId ? (
            <>
              <div className="grid gap-1">
                <span className="label-mono">Listing title</span>
                <p className="text-[15px] text-[var(--color-ink)]">{card.title ?? "Untitled"}</p>
              </div>

              <RequirementList results={card.results} />

              {/*
                Assisted channels report their own status, and nothing that
                implies verification may read those as equal to an API
                confirmation. Saying so on the card is cheaper than explaining it
                after someone has trusted the wrong one.
              */}
              {card.statusSource === "self_reported" && card.integrationType === "assisted" ? (
                <p className="border-l-2 border-[var(--color-rule)] pl-3 text-[13px] text-[var(--color-ink-3)]">
                  Status here is self-reported. Nothing confirms it, because this channel has no API
                  to confirm it with.
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={() => build(card.connectionId)}
                  disabled={pending}
                >
                  {pending && buildingFor === card.connectionId ? "Rebuilding…" : "Rebuild"}
                </Button>
                {/*
                  Publishing arrives at A7. The button is absent rather than
                  disabled for a channel that can never have one.
                */}
                {card.canPublish ? (
                  <span className="inline-flex items-center font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
                    Publishing arrives at step A7
                  </span>
                ) : null}
              </div>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => build(card.connectionId)} disabled={pending}>
                {pending && buildingFor === card.connectionId ? "Building…" : "Build listing"}
              </Button>
              <span className="text-[13px] text-[var(--color-ink-2)]">
                Derives a listing for this channel from the canonical product.
              </span>
            </div>
          )}
        </section>
      ))}
    </div>
  )
}
