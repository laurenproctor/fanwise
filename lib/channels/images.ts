import type { ProductAsset } from "@/lib/products/types"
import type { AdapterSubject } from "./types"

/**
 * Which of a product's files are the images a channel should receive, and in
 * what order.
 *
 * Provider-neutral on purpose. Every channel that accepts images wants roughly
 * this set in roughly this order, and an adapter that reimplemented the
 * selection would be free to disagree with the requirements engine about what
 * "a cover image" means.
 *
 * Three filters, each of which would be a bug if it were missing:
 *
 *   ready only        a pending row is a promise the finalize job has not kept,
 *                     and handing a provider a URL for bytes that have not
 *                     arrived produces a broken image on someone's storefront.
 *   sources only      derivatives are renditions Fanwise generated for a spec.
 *                     Providers resize for themselves, so sending both the
 *                     source and its thumbnails uploads the same picture twice.
 *   image types only  the deliverable is not a picture, and a channel that
 *                     received it as one would publish the buyer's file as a
 *                     public product image. That is the worst failure available
 *                     here, so it is a filter rather than a convention.
 */
const CHANNEL_IMAGE_TYPES = ["cover_image", "preview_image"] as const

/**
 * Every image slot a creator should see, including ones still uploading.
 *
 * The display list and the send list are the same selection at different
 * moments, so they share one filter and one comparator. Two implementations
 * would eventually disagree about what counts, and the creator would arrange
 * images in an order the channel did not receive.
 */
export function listingImageSlots(assets: readonly ProductAsset[]): ProductAsset[] {
  return assets
    .filter(
      (asset) =>
        !asset.derived_from &&
        (CHANNEL_IMAGE_TYPES as readonly string[]).includes(asset.asset_type),
    )
    .sort(compareForChannel)
}

/** The subset a channel actually receives: the slots that are ready. */
export function listingImages(subject: AdapterSubject): ProductAsset[] {
  return listingImageSlots(subject.assets).filter((asset) => asset.asset_state === "ready")
}

/**
 * The cover image first, then previews in the creator's order.
 *
 * Position one is not decorative: on Shopify and every marketplace like it, the
 * first image is the one that appears in the storefront grid and in search.
 * Falling back to `created_at` keeps the order stable when two assets share a
 * `sort_order`, so republishing does not silently reshuffle a listing.
 */
function compareForChannel(a: ProductAsset, b: ProductAsset): number {
  const cover = Number(b.asset_type === "cover_image") - Number(a.asset_type === "cover_image")
  if (cover !== 0) return cover
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
}

/**
 * A stable fingerprint of the images that would be sent.
 *
 * Feeds the update idempotency key. Without it, adding or removing an image
 * produces the same key as the previous update, the insert collides, and the
 * change is reported as already done while never reaching the channel. Order is
 * included because reordering changes which image a shop shows first, which is
 * a real change and not a cosmetic one.
 */
export function imagesFingerprint(subject: AdapterSubject): string {
  return listingImages(subject)
    .map((asset) => asset.id)
    .join(",")
}
