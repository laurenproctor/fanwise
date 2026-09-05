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
  price: 48,
  currency: "USD",
  category: "font",
  tags: ["font", "grotesque"],
  metadata: {},
}

const WS = "ws-1"
const LISTING = "listing-1"

describe("publish keys", () => {
  it("is stable across two clicks", () => {
    expect(publishKey(WS, LISTING)).toBe(publishKey(WS, LISTING))
  })

  it("does not change when the listing content changes", () => {
    // The load-bearing assertion. A key that included content would let a
    // creator publish twice by editing a title in between, which is exactly
    // the duplicate the exit test forbids.
    const a = keyFor({ kind: "publish", workspaceId: WS, listingId: LISTING, draft })
    const b = keyFor({
      kind: "publish",
      workspaceId: WS,
      listingId: LISTING,
      draft: { ...draft, title: "Something else entirely", price: 99 },
    })
    expect(a).toBe(b)
  })

  it("differs per listing and per workspace", () => {
    expect(publishKey(WS, LISTING)).not.toBe(publishKey(WS, "listing-2"))
    expect(publishKey(WS, LISTING)).not.toBe(publishKey("ws-2", LISTING))
  })

  it("never collides with an activate key for the same listing", () => {
    expect(publishKey(WS, LISTING)).not.toBe(activateKey(WS, LISTING))
  })
})

describe("update keys", () => {
  it("changes when the content changes, so a correction is a new operation", () => {
    const a = updateKey(WS, LISTING, draft)
    const b = updateKey(WS, LISTING, { ...draft, title: "Aster Grotesk Variable" })
    expect(a).not.toBe(b)
  })

  it("collides when the content is identical, so sending the same edit twice is once", () => {
    expect(updateKey(WS, LISTING, draft)).toBe(updateKey(WS, LISTING, { ...draft }))
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
