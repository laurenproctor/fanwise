"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button, ButtonLink } from "@/components/ui/button"
import { FormError } from "@/components/ui/form-error"
import { buildListingAction } from "@/lib/channels/actions"
import { publishListingAction } from "@/lib/publishing/actions"
import { ReadinessBar } from "./readiness-bar"
import { RequirementList } from "./requirement-list"
import { StatusPill } from "./status-pill"
import { ManualStepCard, type ManualStepCardData } from "./manual-step-card"
import type { Readiness, RequirementResult } from "@/lib/channels/types"
import type { ListingLiveness } from "@/lib/publishing/manual-steps"

/**
 * One product, its channels, and what each of them would reject or has done.
 *
 * The shape follows the workspace window in design/marketing/landing.html:
 * canonical product on the left, derived channel listings on the right, each
 * with its own status.
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
  liveness: ListingLiveness
  externalUrl: string | null
  manualSteps: ManualStepCardData[]
  /** The last normalized failure, if the most recent attempt failed. */
  lastError: string | null
  deliverable: { assetId: string; filename: string } | null
}

/** How long to keep asking whether a publication finished, and how often. */
const POLL_MS = 2000
const POLL_LIMIT = 20

export function ListingPanel({
  workspaceSlug,
  productSlug,
  productId,
  cards,
}: {
  workspaceSlug: string
  productSlug: string
  productId: string
  cards: ChannelListingCard[]
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [actingOn, setActingOn] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const publishing = cards.some((card) => card.liveness === "publishing")

  /**
   * Publishing happens in a background job, so the page that queued it does not
   * know when it finished. It asks, briefly.
   *
   * Bounded rather than indefinite: a job that has not landed in forty seconds
   * has failed in a way polling will not discover, and a tab that refreshes
   * itself forever is worse than one that stops. A7 replaces this with real
   * progress, which is where it belongs.
   */
  useEffect(() => {
    if (!publishing) return
    let ticks = 0
    const timer = setInterval(() => {
      ticks += 1
      if (ticks > POLL_LIMIT) {
        clearInterval(timer)
        return
      }
      router.refresh()
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [publishing, router])

  function build(connectionId: string) {
    setError(null)
    setNotice(null)
    setActingOn(connectionId)
    startTransition(async () => {
      const result = await buildListingAction(workspaceSlug, productId, connectionId)
      setError(result.error)
      setActingOn(null)
      // As publish() does. These routes are dynamically rendered, so there is
      // no cached entry for revalidatePath to invalidate and the client is
      // never told to refetch: the listing is built, the card goes on saying
      // "Build listing", and the creator reasonably reads that as a hang.
      router.refresh()
    })
  }

  function publish(connectionId: string, listingId: string) {
    setError(null)
    setNotice(null)
    setActingOn(connectionId)
    startTransition(async () => {
      const result = await publishListingAction(workspaceSlug, listingId)
      setError(result.error)
      setNotice(result.notice)
      setActingOn(null)
      router.refresh()
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
      {notice ? (
        <p className="border-l-2 border-[var(--color-accent)] bg-[var(--color-paper-2)] py-2 pl-3 text-[14px] text-[var(--color-ink)]">
          {notice}
        </p>
      ) : null}

      {cards.map((card) => {
        const busy = pending && actingOn === card.connectionId
        const outstanding = card.manualSteps.filter((step) => !step.completed)

        return (
          <section
            key={card.connectionId}
            className="grid gap-4 rounded-[14px] border border-[var(--color-rule)] bg-[var(--color-card)] p-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="grid gap-1.5">
                <h3 className="font-display text-[19px] font-normal tracking-[-0.02em]">
                  {card.channelName}
                </h3>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="label-mono">
                    {card.integrationType === "api" ? "Automatic" : "Assisted"}
                  </span>
                  {card.listingId ? <StatusPill liveness={card.liveness} /> : null}
                </div>
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

                {card.externalUrl ? (
                  <a
                    className="justify-self-start text-[13px] underline underline-offset-2 hover:text-[var(--color-accent)]"
                    href={card.externalUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    View on {card.channelName} ↗
                  </a>
                ) : null}

                {/*
                  A failure is shown where the thing that failed is, and it is
                  the normalized message: the provider's own words are on the
                  job row and stay there.
                */}
                {card.lastError ? <FormError message={card.lastError} /> : null}

                {outstanding.length === 0 ? (
                  <RequirementList results={card.results} />
                ) : (
                  <div className="grid gap-3">
                    {card.manualSteps.map((step) => (
                      <ManualStepCard
                        key={step.key}
                        workspaceSlug={workspaceSlug}
                        listingId={card.listingId!}
                        step={step}
                        deliverable={card.deliverable}
                        activates={outstanding.length === 1 && !step.completed}
                        onDone={(message) => {
                          setNotice(message)
                          router.refresh()
                        }}
                      />
                    ))}
                  </div>
                )}

                {/*
                  Assisted channels report their own status, and nothing that
                  implies verification may read those as equal to an API
                  confirmation. Saying so on the card is cheaper than explaining
                  it after someone has trusted the wrong one.
                */}
                {card.statusSource === "self_reported" && card.integrationType === "assisted" ? (
                  <p className="border-l-2 border-[var(--color-rule)] pl-3 text-[13px] text-[var(--color-ink-3)]">
                    Status here is self-reported. Nothing confirms it, because this channel has no
                    API to confirm it with.
                  </p>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  <ButtonLink
                    variant="secondary"
                    href={`/w/${workspaceSlug}/products/${productSlug}/channels/${card.connectionId}`}
                  >
                    Edit listing
                  </ButtonLink>
                  <Button
                    variant="secondary"
                    onClick={() => build(card.connectionId)}
                    disabled={pending}
                  >
                    {busy ? "Rebuilding…" : "Rebuild"}
                  </Button>

                  {/*
                    The publish affordance exists only where the adapter says it
                    can, and only where there is nothing already on the channel.
                    A published listing offers no second Publish: the operation
                    is idempotent on the server, and offering a button whose
                    only outcome is "already published" is offering a lie.
                  */}
                  {card.canPublish && card.liveness === "unpublished" ? (
                    <Button
                      onClick={() => publish(card.connectionId, card.listingId!)}
                      disabled={pending || !card.readiness?.ready}
                    >
                      {busy ? "Publishing…" : "Publish"}
                    </Button>
                  ) : null}

                  {card.canPublish && card.liveness === "failed" ? (
                    <Button
                      onClick={() => publish(card.connectionId, card.listingId!)}
                      disabled={pending}
                    >
                      {busy ? "Retrying…" : "Try again"}
                    </Button>
                  ) : null}

                  {card.canPublish &&
                  card.liveness === "unpublished" &&
                  card.readiness &&
                  !card.readiness.ready ? (
                    <span className="text-[13px] text-[var(--color-ink-3)]">
                      Resolve what is blocking before publishing.
                    </span>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => build(card.connectionId)} disabled={pending}>
                  {busy ? "Building…" : "Build listing"}
                </Button>
                <span className="text-[13px] text-[var(--color-ink-2)]">
                  Derives a listing for this channel from the canonical product.
                </span>
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
