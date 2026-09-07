import { describe, expect, it } from "vitest"
import {
  activateKey,
  fingerprint,
  keyFor,
  publishKey,
  updateKey,
} from "@/lib/publishing/idempotency"
import type { ChannelListingDraft } from "@/lib/channels/types"

/**
 * Idempotency keys.
 *
 * Architecture invariant 3, and the exit test for A5: "second click creates
 * nothing". The whole of that promise rests on one property proved below —
 * a publish key does not depend on the listing's content — so a creator who
 * clicks Publish, edits a word, and clicks again still gets one product.
 */

const draft: ChannelListingDraft = {
  title: "Aster Grotesk",
  description: "A grotesque in nine weights.",
  shortDescription: "Nine weights.",
  seoTitle: null,
  seoDescription: null,
  price: 48,
  currency: "USD",
  category: "font",
  tags: ["font", "grotesque"],
  metadata: {},
}

const WS = "ws-1"
const LISTING = "listing-1"
const GEN = 0

describe("publish keys", () => {
  it("is stable across two clicks", () => {
    expect(publishKey(WS, LISTING, GEN)).toBe(publishKey(WS, LISTING, GEN))
  })

  it("does not change when the listing content changes", () => {
    // The load-bearing assertion. A key that included content would let a
    // creator publish twice by editing a title in between, which is exactly
    // the duplicate the exit test forbids.
    const a = keyFor({
      kind: "publish",
      workspaceId: WS,
      listingId: LISTING,
      draft,
      generation: GEN,
    })
    const b = keyFor({
      kind: "publish",
      workspaceId: WS,
      listingId: LISTING,
      draft: { ...draft, title: "Something else entirely", price: 99 },
      generation: GEN,
    })
    expect(a).toBe(b)
  })

  it("differs per listing and per workspace", () => {
    expect(publishKey(WS, LISTING, GEN)).not.toBe(publishKey(WS, "listing-2", GEN))
    expect(publishKey(WS, LISTING, GEN)).not.toBe(publishKey("ws-2", LISTING, GEN))
  })

  it("never collides with an activate key for the same listing", () => {
    expect(publishKey(WS, LISTING, GEN)).not.toBe(activateKey(WS, LISTING, GEN))
  })

  it("changes when the generation does, so a deleted product can be published again", () => {
    // The one thing allowed to make a second Publish a new operation. A
    // generation moves only where the provider has confirmed the product it
    // created is gone, so this does not weaken the assertion above it: within
    // a generation the key is still content-independent and still collides.
    expect(publishKey(WS, LISTING, 0)).not.toBe(publishKey(WS, LISTING, 1))
    expect(activateKey(WS, LISTING, 0)).not.toBe(activateKey(WS, LISTING, 1))
  })
})

/** These assertions vary the text, so the images are held constant. */
const NO_IMAGES = ""

describe("update keys", () => {
  it("changes when the content changes, so a correction is a new operation", () => {
    const a = updateKey(WS, LISTING, draft, NO_IMAGES)
    const b = updateKey(WS, LISTING, { ...draft, title: "Aster Grotesk Variable" }, NO_IMAGES)
    expect(a).not.toBe(b)
  })

  it("collides when the content is identical, so sending the same edit twice is once", () => {
    expect(updateKey(WS, LISTING, draft, NO_IMAGES)).toBe(
      updateKey(WS, LISTING, { ...draft }, NO_IMAGES),
    )
  })

  it("changes when only the SEO fields change, so a meta-only edit can be sent", () => {
    // These are sent to the channel, so they are part of what an update is.
    // Left out of the fingerprint they would collide with the edit before
    // them, and a creator rewriting only a meta description would be told
    // there was nothing to publish.
    expect(fingerprint(draft)).not.toBe(fingerprint({ ...draft, seoTitle: "Aster Grotesk font" }))
    expect(fingerprint(draft)).not.toBe(
      fingerprint({ ...draft, seoDescription: "Nine weights, one licence." }),
    )
  })

  it("ignores tag order, which the editor does not preserve", () => {
    expect(fingerprint(draft)).toBe(fingerprint({ ...draft, tags: ["grotesque", "font"] }))
  })

  it("ignores metadata, which Fanwise writes to itself after every publish", () => {
    // metadata carries externalState. Including it would make every successful
    // publish change the fingerprint of the next update, for no reason a
    // creator could observe.
    expect(fingerprint(draft)).toBe(
      fingerprint({ ...draft, metadata: { externalState: "live", anything: 1 } }),
    )
  })

  it("distinguishes a null field from an empty one only where it matters", () => {
    expect(fingerprint({ ...draft, description: null })).toBe(
      fingerprint({ ...draft, description: "" }),
    )
    expect(fingerprint({ ...draft, price: null })).not.toBe(fingerprint({ ...draft, price: 0 }))
  })
})
