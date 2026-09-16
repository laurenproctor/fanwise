import { imagesFingerprint } from "@/lib/channels/images"
import type {
  AdapterSubject,
  ChannelAdapter,
  ChannelListing,
  ChannelListingDraft,
} from "@/lib/channels/types"
import { sentFingerprint } from "./idempotency"

/**
 * True when the listing holds something the channel has not been sent.
 *
 * The predicate behind the "Publish changes" button, and the reason the
 * fingerprint is persisted at all. The panel already refuses to offer a second
 * Publish on the grounds that a button whose only outcome is "already
 * published" is a lie; an update button that is always present tells the same
 * lie with `already_done`, so it is offered only when there is something to
 * send.
 *
 * A null fingerprint means nothing was recorded, which is every listing
 * published before the column existed. That reads as "cannot prove there is
 * nothing to send" and offers the action rather than hiding it: wrongly
 * offering costs a creator one click and a job that reports already_done,
 * while wrongly hiding it strands an edit with no way to send it.
 *
 * Not in actions.ts, and not because of taste: that module is "use server", so
 * every export in it must be an async server action.
 */
export function hasUnsentChanges(
  listing: Pick<ChannelListing, "last_sent_fingerprint"> &
    Partial<Pick<ChannelListing, "status" | "metadata" | "public_url">>,
  draft: ChannelListingDraft,
  subject: AdapterSubject,
  adapter?: Pick<ChannelAdapter, "manualSteps">,
): boolean {
  /*
   * Published, known not to be on sale, and no step the creator must finish
   * first: sending the listing again is the way forward, so it is offered.
   * The case this exists for is a listing published under a channel's old
   * manual file step, which the channel no longer has (ADR 0012) — without
   * this it would read "not on sale there yet" with nothing on the card to do.
   */
  const metadata = (listing.metadata as Record<string, unknown> | null) ?? {}
  if (
    adapter &&
    listing.status === "published" &&
    metadata["purchasable"] === false &&
    !adapter.manualSteps.some((step) => step.gatesActivation)
  ) {
    return true
  }

  /*
   * Published, on sale, and no address for a buyer. The public page shows a
   * channel only through `public_url`, which the runner writes from what the
   * provider reports on every publish or update. A listing published before
   * that column existed and never sent since is live on its channel and
   * missing from the creator's page; sending it again is the whole fix, so it
   * is offered rather than left for someone to notice.
   */
  if (
    listing.status === "published" &&
    listing.public_url === null &&
    metadata["externalState"] === "live" &&
    metadata["purchasable"] !== false
  ) {
    return true
  }

  const recorded = listing.last_sent_fingerprint
  if (!recorded) return true
  return recorded !== sentFingerprint(draft, imagesFingerprint(subject))
}
