import type { ListingLiveness } from "./manual-steps"

/**
 * When a product's first listing has been confirmed on a channel.
 *
 * There is no product-level publish status, by decision (ADR 0005), so the
 * question is asked of the listings: how many of this product's listings does
 * a channel now hold, on the channel's own word. A listing counts once its
 * status is `published` with a verified source — `published_not_live` and
 * `live` are both that, the difference being whether a buyer can reach it yet.
 * A self-reported status on an assisted channel is a creator's claim and the
 * card says so; nothing confirmed it, so nothing here counts it.
 *
 * The count is a fact about one server render. A first publication is the
 * step between two of them: the previous render held none and this one holds
 * some. Publication finishes in a background job after the action that queued
 * it has returned (rule 7), so the action's own response can never say a
 * listing landed. The refreshed render is the server's confirmation, and this
 * compares one to the next. Nothing is inferred from a click, a notice or a
 * URL.
 *
 * What follows from the shape: an edit sent to a listing already on a channel
 * moves the count from one to one; a second channel moves it from one to two;
 * a failure moves nothing; a retry that finally lands moves it from none to
 * one, which is the first publication it is. A different product is a
 * different question, so a summary never compares across product ids.
 */

export interface PublicationSummary {
  productId: string
  /** Listings a channel has confirmed it holds. */
  confirmed: number
}

export interface PublicationFacts {
  liveness: ListingLiveness
  statusSource: "verified" | "self_reported" | null
}

export function isConfirmedPublication(card: PublicationFacts): boolean {
  return (
    (card.liveness === "published_not_live" || card.liveness === "live") &&
    card.statusSource === "verified"
  )
}

export function summarizePublications(
  productId: string,
  cards: readonly PublicationFacts[],
): PublicationSummary {
  return { productId, confirmed: cards.filter(isConfirmedPublication).length }
}

export function firstPublicationLanded(
  previous: PublicationSummary | null,
  next: PublicationSummary,
): boolean {
  return (
    previous !== null &&
    previous.productId === next.productId &&
    previous.confirmed === 0 &&
    next.confirmed > 0
  )
}
