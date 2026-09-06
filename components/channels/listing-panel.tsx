"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button, ButtonLink } from "@/components/ui/button"
import { FormError } from "@/components/ui/form-error"
import { buildListingAction } from "@/lib/channels/actions"
import { publishChangesAction, publishListingAction } from "@/lib/publishing/actions"
import { useBackgroundRefresh } from "@/lib/use-background-refresh"
import { resolveSend } from "@/lib/publishing/send-outcome"
import { ReadinessBar } from "./readiness-bar"
import { RequirementList } from "./requirement-list"
import { StatusPill } from "./status-pill"
import { ManualStepCard, type ManualStepCardData } from "./manual-step-card"
import type { Readiness, RequirementResult } from "@/lib/channels/types"
import { LIVENESS_MEANINGS, type ListingLiveness } from "@/lib/publishing/manual-steps"
import { routes } from "@/lib/routes"

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

/** Shown when a send has landed, and only then. See the effect that sets it. */
const SENT_NOTICE = "Sent."

/** How long "Sent" stays before the panel goes quiet again. */
const SENT_NOTICE_MS = 2500

/**
 * How long to keep watching a send. Slightly longer than useBackgroundRefresh
 * polls, so the last refresh is counted before this gives up on it.
 */
const SEND_WATCH_MS = 45000

export interface ChannelListingCard {
  connectionId: string
  channelName: string
  integrationType: "api" | "assisted"
  canPublish: boolean
  canPublishChanges: boolean
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

  /*
   * The listing whose changes are in flight, if any.
   *
   * A publish announces itself in the row — status goes to `publishing` and the
   * card says so — and an update deliberately does not, because the product is
   * live throughout and flipping the row would report a live product as not
   * live. That left the notice with nothing to end it: "Sending your changes"
   * was set when the job was queued and no later render had any reason to
   * replace it, so it sat there after the images had already arrived.
   *
   * Held in the client instead. The server-side fact that the send landed is
   * the listing's fingerprint matching what it holds, which is exactly what
   * clears `canPublishChanges`.
   */
  const [sending, setSending] = useState<string | null>(null)

  const publishing = cards.some((card) => card.liveness === "publishing")

  /*
   * Publishing happens in a background job, so the page that queued it does not
   * know when it finished. It asks, briefly. A7 replaces this with real
   * progress, which is where it belongs.
   */
  useBackgroundRefresh(publishing || sending !== null)

  /*
   * Ends the send, on evidence rather than on a timer.
   *
   * "Sent" is a claim about the channel, so it waits for the same fact the
   * button does: the listing no longer holds anything unsent, which only
   * recordSuccess can bring about. Saying it when the job was merely queued
   * would be the panel guessing, which is the habit this file is otherwise
   * careful not to have.
   *
   * Resolved while rendering rather than in an effect. The answer is a
   * function of the props that just arrived, so an effect would render the
   * stale message once and then correct it — and React's lint refuses a
   * synchronous setState in an effect for exactly that reason. The guard is
   * false on the pass this triggers, so it settles in one extra render and
   * cannot loop.
   */
  const outcome = resolveSend(
    sending === null ? undefined : cards.find((card) => card.listingId === sending),
  )
  if (sending !== null && outcome.kind !== "waiting") {
    setSending(null)
    if (outcome.kind === "failed") {
      setError(outcome.message)
      setNotice(null)
    } else {
      setNotice(SENT_NOTICE)
    }
  }

  /*
   * "Sent" is a moment, not a state. It says the thing that just happened and
   * then gets out of the way, rather than persisting into a page that no longer
   * has anything to do with it.
   */
  useEffect(() => {
    if (notice !== SENT_NOTICE) return
    const timer = setTimeout(() => setNotice(null), SENT_NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  /*
   * The send that never lands.
   *
   * useBackgroundRefresh gives up after forty seconds, and without this the
   * notice would go back to sitting there forever — the exact bug being fixed,
   * reached by a slower road. Says what is actually known: it was queued, and
   * this page stopped watching.
   */
  useEffect(() => {
    if (sending === null) return
    const timer = setTimeout(() => {
      setSending(null)
      setNotice("Still sending. Reload to see where it got to.")
    }, SEND_WATCH_MS)
    return () => clearTimeout(timer)
  }, [sending])

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

  /*
   * Same shape as publish, different verb. Kept separate rather than folded
   * into one handler with a flag, because the two call different server actions
   * with different guards and a shared wrapper would only hide which one ran.
   */
  function publishChanges(connectionId: string, listingId: string) {
    setError(null)
    setNotice(null)
    setActingOn(connectionId)
    startTransition(async () => {
      const result = await publishChangesAction(workspaceSlug, listingId)
      setError(result.error)
      setNotice(result.notice)
      setActingOn(null)
      // Only when something is actually on its way. `already_done` and a
      // refusal both return a notice and nothing to wait for, and watching for
      // a landing that will never come would hang the message again.
      if (result.sending) setSending(listingId)
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
                {/*
                  The pill is two words and the distinction that matters does
                  not fit in two words. Spelling it out beside the pill costs a
                  line and stops "Published, not live" being read as a slower
                  kind of live.
                */}
                {card.listingId ? (
                  <p className="max-w-prose text-[13px] text-[var(--color-ink-2)]">
                    {LIVENESS_MEANINGS[card.liveness]}
                  </p>
                ) : null}
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
                    href={routes.productChannel(workspaceSlug, productSlug, card.connectionId)}
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

                  {/*
                    Present only when the channel is behind what the listing
                    now holds. See canPublishChanges: a listing with nothing to
                    send offers nothing, because the only thing this could tell
                    that creator is `already_done`.
                  */}
                  {card.canPublishChanges ? (
                    <Button
                      onClick={() => publishChanges(card.connectionId, card.listingId!)}
                      disabled={pending || !card.readiness?.ready}
                    >
                      {busy ? "Sending…" : "Publish changes"}
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

                  {/*
                    A published listing that has drifted out of readiness. The
                    edit cannot be sent until it is fixed, and saying so is the
                    difference between a disabled button and a mystery.
                  */}
                  {card.canPublishChanges && card.readiness && !card.readiness.ready ? (
                    <span className="text-[13px] text-[var(--color-ink-3)]">
                      Resolve what is blocking before sending these changes.
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
