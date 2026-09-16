/**
 * The one signal the favicon listens for from the rest of the product.
 *
 * A DOM event rather than a store or a context, so the component that plays
 * the animation and the component that knows a publication landed need not
 * know about each other: the favicon lives in the root layout, the listing
 * panel lives three layouts down, and a window event crosses that distance
 * with no plumbing. Nothing else subscribes to it and nothing else should.
 *
 * The name is the one the favicon package shipped with. In Fanwise's own
 * vocabulary the thing being announced is a product's first listing confirmed
 * on a channel (ADR 0005: listings are published, products are not), and
 * `lib/publishing/first-publication.ts` is what decides when that has
 * happened. Nothing may call this from a click, a toast or a URL.
 */
export const FANWISE_PRODUCT_PUBLISHED_EVENT = "fanwise:product-published"

export function notifyFanwiseProductPublished(): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event(FANWISE_PRODUCT_PUBLISHED_EVENT))
}
