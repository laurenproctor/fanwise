import { describe, expect, it } from "vitest"
import { imagesFingerprint, listingImageSlots, listingImages } from "@/lib/channels/images"
import { publishKey, updateKey } from "@/lib/publishing/idempotency"
import type { AdapterSubject, ChannelListingDraft } from "@/lib/channels/types"
import type { Product, ProductAsset } from "@/lib/products/types"

/**
 * Which images a channel receives, in what order, and how a change to them
 * reaches the channel at all.
 *
 * The last one is the subtle one. Images are product assets rather than listing
 * columns, so a listing whose only change is a new photograph produces a byte
 * identical draft. Without the image fingerprint in the update key, the second
 * update collides with the first, is answered "already done", and the image
 * never leaves Fanwise.
 */

let counter = 0

function asset(overrides: Partial<ProductAsset> = {}): ProductAsset {
  counter += 1
  return {
    id: `asset-${counter}`,
    workspace_id: "ws-1",
    product_id: "product-1",
    asset_type: "preview_image",
    asset_state: "ready",
    derived_from: null,
    sort_order: 0,
    filename: `image-${counter}.png`,
    mime_type: "image/png",
    storage_path: `ws-1/product-1/asset-${counter}.png`,
    created_at: `2026-09-0${counter}T00:00:00Z`,
    ...overrides,
  } as unknown as ProductAsset
}

function subject(assets: ProductAsset[]): AdapterSubject {
  return { product: { id: "product-1" } as unknown as Product, assets }
}

describe("which images a channel receives", () => {
  it("takes cover and preview images", () => {
    const cover = asset({ asset_type: "cover_image" })
    const preview = asset({ asset_type: "preview_image" })
    expect(listingImages(subject([cover, preview])).map((a) => a.id)).toEqual([
      cover.id,
      preview.id,
    ])
  })

  it("never sends the deliverable as a picture", () => {
    // The worst failure available here: the buyer's file published as a public
    // product image. A filter rather than a convention, for that reason.
    const deliverable = asset({ asset_type: "deliverable", filename: "aster.zip" })
    const archive = asset({ asset_type: "archive", filename: "aster.zip" })
    expect(listingImages(subject([deliverable, archive]))).toEqual([])
  })

  it("skips a file that is still being measured", () => {
    // A pending row is a promise the finalize job has not kept, and a provider
    // handed a URL for bytes that have not arrived shows a broken image.
    const pending = asset({ asset_state: "pending" })
    const failed = asset({ asset_state: "failed" })
    expect(listingImages(subject([pending, failed]))).toEqual([])
  })

  it("skips derivatives, so the same picture is not uploaded twice", () => {
    const source = asset({ asset_type: "cover_image" })
    const thumb = asset({ asset_type: "thumbnail", derived_from: source.id })
    expect(listingImages(subject([source, thumb])).map((a) => a.id)).toEqual([source.id])
  })

  it("ignores other image-ish types the channel was never promised", () => {
    const specimen = asset({ asset_type: "specimen" })
    const promo = asset({ asset_type: "promotional" })
    expect(listingImages(subject([specimen, promo]))).toEqual([])
  })
})

describe("order", () => {
  it("puts the cover first whatever order the assets arrive in", () => {
    // Position one is the storefront grid and search. Not decorative.
    const preview = asset({ asset_type: "preview_image", sort_order: 0 })
    const cover = asset({ asset_type: "cover_image", sort_order: 9 })
    expect(listingImages(subject([preview, cover])).map((a) => a.id)).toEqual([
      cover.id,
      preview.id,
    ])
  })

  it("then follows the creator's sort order", () => {
    const third = asset({ sort_order: 3 })
    const first = asset({ sort_order: 1 })
    const second = asset({ sort_order: 2 })
    expect(listingImages(subject([third, first, second])).map((a) => a.id)).toEqual([
      first.id,
      second.id,
      third.id,
    ])
  })

  it("is stable when two assets share a sort order", () => {
    // Otherwise republishing silently reshuffles a listing.
    const a = asset({ sort_order: 1, created_at: "2026-09-01T00:00:00Z" })
    const b = asset({ sort_order: 1, created_at: "2026-09-02T00:00:00Z" })
    expect(listingImages(subject([b, a])).map((x) => x.id)).toEqual([a.id, b.id])
  })
})

describe("what the creator sees", () => {
  it("includes files still uploading, which the send list excludes", () => {
    const ready = asset({ asset_type: "cover_image" })
    const uploading = asset({ asset_state: "pending" })
    const assets = [ready, uploading]

    expect(listingImageSlots(assets).map((a) => a.id)).toEqual([ready.id, uploading.id])
    expect(listingImages(subject(assets)).map((a) => a.id)).toEqual([ready.id])
  })

  it("orders the display list exactly as the send list", () => {
    // One comparator, so a creator cannot arrange images into an order the
    // channel does not receive.
    const preview = asset({ asset_type: "preview_image" })
    const cover = asset({ asset_type: "cover_image" })
    const assets = [preview, cover]
    expect(listingImageSlots(assets).map((a) => a.id)).toEqual(
      listingImages(subject(assets)).map((a) => a.id),
    )
  })
})

describe("an image change reaches the channel", () => {
  const draft: ChannelListingDraft = {
    title: "Aster Grotesk",
    description: "A grotesque in nine weights.",
    shortDescription: null,
    price: 48,
    currency: "USD",
    category: "font",
    tags: [],
    metadata: {},
  }

  it("changes the update key when an image is added", () => {
    const one = subject([asset({ asset_type: "cover_image" })])
    const two = subject([...one.assets, asset()])

    expect(updateKey("ws-1", "listing-1", draft, imagesFingerprint(one))).not.toBe(
      updateKey("ws-1", "listing-1", draft, imagesFingerprint(two)),
    )
  })

  it("changes the update key when an image is removed", () => {
    const cover = asset({ asset_type: "cover_image" })
    const extra = asset()
    const before = subject([cover, extra])
    const after = subject([cover])

    expect(updateKey("ws-1", "listing-1", draft, imagesFingerprint(before))).not.toBe(
      updateKey("ws-1", "listing-1", draft, imagesFingerprint(after)),
    )
  })

  it("changes the update key when images are reordered", () => {
    // Reordering changes which image a shop shows first, which is a real change.
    const a = asset({ sort_order: 1 })
    const b = asset({ sort_order: 2 })
    const before = imagesFingerprint(subject([a, b]))
    const after = imagesFingerprint(subject([{ ...a, sort_order: 3 } as ProductAsset, b]))
    expect(before).not.toBe(after)
  })

  it("leaves the key alone when nothing about the images changed", () => {
    const one = subject([asset({ asset_type: "cover_image" })])
    const same = subject([...one.assets])
    expect(updateKey("ws-1", "listing-1", draft, imagesFingerprint(one))).toBe(
      updateKey("ws-1", "listing-1", draft, imagesFingerprint(same)),
    )
  })

  it("still distinguishes two different edits with identical images", () => {
    const s = subject([asset({ asset_type: "cover_image" })])
    expect(updateKey("ws-1", "listing-1", draft, imagesFingerprint(s))).not.toBe(
      updateKey("ws-1", "listing-1", { ...draft, title: "Renamed" }, imagesFingerprint(s)),
    )
  })

  it("does not disturb the publish key, which ignores content entirely", () => {
    // A publish happens once per listing whatever the images are, or clicking
    // Publish twice would create two products.
    expect(publishKey("ws-1", "listing-1")).toBe(publishKey("ws-1", "listing-1"))
  })
})
