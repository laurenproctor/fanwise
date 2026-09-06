import { describe, expect, it } from "vitest"
import { hasUnsentChanges } from "@/lib/publishing/changes"
import { sentFingerprint, updateKey } from "@/lib/publishing/idempotency"
import type { AdapterSubject, ChannelListing, ChannelListingDraft } from "@/lib/channels/types"
import type { Product, ProductAsset } from "@/lib/products/types"

/**
 * The predicate behind "Publish changes".
 *
 * It decides whether a creator is offered the action at all, so the two ways
 * it can be wrong are not symmetric. Wrongly offering costs one click and a
 * job that reports already_done. Wrongly hiding strands an edit with no way to
 * send it, which is the state the two live Shopify products were already in.
 */

const draft: ChannelListingDraft = {
  title: "Aster Grotesk",
  description: "A grotesque in nine weights.",
  shortDescription: "Nine weights.",
  price: 48,
  currency: "USD",
  category: "font",
  tags: ["font", "grotesque"],
  metadata: {},
}

function asset(overrides: Partial<ProductAsset> = {}): ProductAsset {
  return {
    id: "asset-1",
    workspace_id: "ws-1",
    product_id: "product-1",
    asset_type: "cover_image",
    asset_state: "ready",
    sort_order: 0,
    derived_from: null,
    filename: "cover.png",
    storage_path: "ws-1/product-1/asset-1.png",
    created_at: "2026-09-01T00:00:00Z",
    ...overrides,
  } as unknown as ProductAsset
}

function subject(assets: ProductAsset[] = [asset()]): AdapterSubject {
  return {
    product: { id: "product-1", name: "Aster Grotesk" } as unknown as Product,
    assets,
    connectionMetadata: {},
  }
}

function listing(fingerprintValue: string | null): Pick<ChannelListing, "last_sent_fingerprint"> {
  return { last_sent_fingerprint: fingerprintValue } as Pick<
    ChannelListing,
    "last_sent_fingerprint"
  >
}

describe("unsent changes", () => {
  it("says there is nothing to send when the channel has exactly this", () => {
    const recorded = sentFingerprint(draft, "asset-1")
    expect(hasUnsentChanges(listing(recorded), draft, subject())).toBe(false)
  })

  it("notices an edit to the text", () => {
    const recorded = sentFingerprint(draft, "asset-1")
    const edited = { ...draft, title: "Aster Grotesk Variable" }
    expect(hasUnsentChanges(listing(recorded), edited, subject())).toBe(true)
  })

  it("notices an image added with the text left alone", () => {
    // The case the update key was built for, and the reason the fingerprint
    // covers images: a new preview is a real change the channel must be told
    // about, and text-only comparison would call this listing already sent.
    const recorded = sentFingerprint(draft, "asset-1")
    const withPreview = subject([
      asset(),
      asset({ id: "asset-2", asset_type: "preview_image", sort_order: 1 }),
    ])
    expect(hasUnsentChanges(listing(recorded), draft, withPreview)).toBe(true)
  })

  it("notices images reordered, because the first one is the storefront image", () => {
    const one = asset({ id: "a", asset_type: "preview_image", sort_order: 1 })
    const two = asset({ id: "b", asset_type: "preview_image", sort_order: 2 })
    const before = sentFingerprint(draft, "a,b")
    const swapped = subject([
      { ...two, sort_order: 1 },
      { ...one, sort_order: 2 },
    ])
    expect(hasUnsentChanges(listing(before), draft, swapped)).toBe(true)
  })

  it("offers the action when nothing was ever recorded", () => {
    // Every listing published before the column existed, including the two
    // that were stranded. Null is "cannot prove there is nothing to send", and
    // hiding the button on that would leave them stranded permanently.
    expect(hasUnsentChanges(listing(null), draft, subject())).toBe(true)
  })

  it("agrees with the idempotency key about what counts as a change", () => {
    /*
      The property that makes the button honest. If the UI thought an edit was
      a change and the key disagreed, the creator would be offered an action
      whose only outcome is already_done; if the key thought so and the UI did
      not, the edit could never be sent. Sharing one expression is what stops
      the two drifting, so this asserts they are actually derived from it.
    */
    const images = "asset-1"
    const key = updateKey("ws-1", "listing-1", draft, images)
    expect(key.endsWith(sentFingerprint(draft, images))).toBe(true)
  })
})
