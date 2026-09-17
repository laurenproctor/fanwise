/**
 * The mark a channel object carries so that Fanwise can recognise its own
 * create after the answer to it was lost. ADR 0005, the create guard.
 *
 * A transport failure on the one request that creates the external object is
 * the one failure whose retry is not idempotent: the request may have landed
 * and taken the response with it. So an adapter writes this stamp into
 * whatever field the channel exposes for a merchant reference on the create
 * itself, never in a second call, and looks for it before every create. Found,
 * the earlier create landed and the adapter adopts the object and proceeds as
 * an update. Not found, it creates.
 *
 * The stamp is the listing id, prefixed so a person reading it in a channel's
 * admin knows where it came from. It is per listing rather than per product
 * because two connections to one channel are two listings, and each must be
 * able to find its own object. A channel without a searchable reference field
 * matches on content instead, and its adapter says how.
 */

const PREFIX = "fanwise-"

export function listingStamp(listingId: string): string {
  return `${PREFIX}${listingId}`
}

/** True when a value read back from a channel is exactly this listing's stamp. */
export function carriesStamp(value: string | null | undefined, listingId: string): boolean {
  return typeof value === "string" && value.trim() === listingStamp(listingId)
}
