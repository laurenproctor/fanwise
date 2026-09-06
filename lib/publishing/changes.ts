import { imagesFingerprint } from "@/lib/channels/images"
import type { AdapterSubject, ChannelListing, ChannelListingDraft } from "@/lib/channels/types"
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
  listing: Pick<ChannelListing, "last_sent_fingerprint">,
  draft: ChannelListingDraft,
  subject: AdapterSubject,
): boolean {
  const recorded = listing.last_sent_fingerprint
  if (!recorded) return true
  return recorded !== sentFingerprint(draft, imagesFingerprint(subject))
}
