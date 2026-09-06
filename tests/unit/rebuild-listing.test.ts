import { describe, expect, it } from "vitest"
import { rebuildColumns } from "@/lib/channels/listings"
import type { ChannelListingDraft } from "@/lib/channels/types"

/**
 * What regenerating a listing is allowed to overwrite.
 *
 * Rebuilding regenerates the draft. It publishes nothing, so it may not say
 * anything about what the channel is holding — and it used to, because the
 * insert and the regeneration were one upsert and the payload carried the
 * columns that describe publication.
 *
 * The observed damage: two live Shopify products whose rows read draft and
 * self_reported while still carrying their external ids, and whose metadata had
 * been blanked.
 */

const draft: ChannelListingDraft = {
  title: "Aster Grotesk",
  description: "A grotesque in nine weights.",
  shortDescription: null,
  price: 48,
  currency: "USD",
  category: "font",
  tags: ["type"],
  metadata: { adapterField: "from the draft" },
}

const AT = "2026-09-05T23:00:00.000Z"

describe("a rebuild does not claim to have published anything", () => {
  it("writes no status", () => {
    // A row set back to draft while holding an external id is a row claiming to
    // be unpublished and pointing at a real product. The UI reads that as
    // unpublished and offers Publish again.
    expect(rebuildColumns(draft, null, AT)).not.toHaveProperty("status")
  })

  it("writes no status_source", () => {
    // "verified" means a provider API confirmed it. Regeneration confirms
    // nothing, so it may not downgrade the claim either.
    expect(rebuildColumns(draft, null, AT)).not.toHaveProperty("status_source")
  })

  it("writes no external id or published_at", () => {
    const columns = rebuildColumns(draft, null, AT)
    expect(columns).not.toHaveProperty("external_listing_id")
    expect(columns).not.toHaveProperty("published_at")
  })
})

describe("externalState survives a rebuild", () => {
  it("keeps what publication recorded", () => {
    /*
      The dangerous half. The Shopify adapter reads externalState to decide
      whether an update sends ACTIVE or DRAFT, so losing it turns the next edit
      into an instruction to take a live product off sale.
    */
    const columns = rebuildColumns(draft, { externalState: "live" }, AT)
    expect(columns.metadata).toMatchObject({ externalState: "live" })
  })

  it("still lets the draft own the rest of the metadata", () => {
    const columns = rebuildColumns(draft, { externalState: "live" }, AT)
    expect(columns.metadata).toMatchObject({ adapterField: "from the draft" })
  })

  it("does not invent one for a listing that was never published", () => {
    // An absent externalState is not "draft". The adapter treats anything that
    // is not "live" as DRAFT already, and writing a value here would be
    // recording a state nothing observed.
    expect(rebuildColumns(draft, null, AT).metadata).not.toHaveProperty("externalState")
    expect(rebuildColumns(draft, {}, AT).metadata).not.toHaveProperty("externalState")
  })

  it("prefers the recorded state over anything the draft carries", () => {
    // Only publication may write this key, so publication wins.
    const columns = rebuildColumns(
      { ...draft, metadata: { externalState: "draft" } },
      { externalState: "live" },
      AT,
    )
    expect(columns.metadata).toMatchObject({ externalState: "live" })
  })
})

describe("the draft itself is regenerated", () => {
  it("writes the derived columns and the generation time", () => {
    const columns = rebuildColumns(draft, null, AT)
    expect(columns.title).toBe("Aster Grotesk")
    expect(columns.price).toBe(48)
    expect(columns.generated_at).toBe(AT)
  })
})
