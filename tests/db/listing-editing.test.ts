import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { adminClient, createActor, destroyActor, type Actor } from "./harness"

/**
 * Editing a listing, at the database.
 *
 * A4 lets a person hand-write a listing, which means the write path is now
 * something a member does repeatedly rather than something an action does once.
 * These prove the tenant boundary holds for that path and that a save leaves the
 * history it claims to.
 */

let alice: Actor
let bob: Actor
let channelId: string
let aliceListingId: string
let bobListingId: string

async function setUp(actor: Actor, slug: string, account: string) {
  const { data: product, error: productError } = await actor.client
    .from("products")
    .insert({
      workspace_id: actor.workspaceId,
      name: slug,
      slug,
      product_type: "font",
      canonical_title: "Canonical Title",
      canonical_description: "Canonical description, long enough to be useful.",
      base_price: 48,
    })
    .select("id")
    .single()
  if (productError) throw new Error(productError.message)

  const { data: connection, error: connectionError } = await actor.client
    .from("channel_connections")
    .insert({
      workspace_id: actor.workspaceId,
      channel_id: channelId,
      external_account_id: account,
    })
    .select("id")
    .single()
  if (connectionError) throw new Error(connectionError.message)

  const { data: listing, error: listingError } = await actor.client
    .from("channel_listings")
    .insert({
      workspace_id: actor.workspaceId,
      product_id: product.id,
      channel_id: channelId,
      channel_connection_id: connection.id,
      title: "Original title",
    })
    .select("id")
    .single()
  if (listingError) throw new Error(listingError.message)

  return { productId: product.id, listingId: listing.id }
}

beforeAll(async () => {
  const admin = adminClient()
  const { data: channels, error } = await admin.from("channels").select("id, key")
  if (error) throw new Error(error.message)
  channelId = channels.find((c) => c.key === "mock_api")!.id

  alice = await createActor("le-alice")
  bob = await createActor("le-bob")

  aliceListingId = (await setUp(alice, "alice-font", "alice-shop")).listingId
  bobListingId = (await setUp(bob, "bravo-font", "bob-shop")).listingId
})

afterAll(async () => {
  if (alice) await destroyActor(alice)
  if (bob) await destroyActor(bob)
})

describe("a member edits their own listing", () => {
  it("saves hand-written copy", async () => {
    const { error } = await alice.client
      .from("channel_listings")
      .update({
        title: "Hand-written title",
        description: "Written for this channel specifically.",
        tags: ["one", "two", "three"],
        price: 52,
      })
      .eq("id", aliceListingId)
    expect(error).toBeNull()

    const { data } = await alice.client
      .from("channel_listings")
      .select("title, tags, price")
      .eq("id", aliceListingId)
      .single()

    expect(data?.title).toBe("Hand-written title")
    expect(data?.tags).toEqual(["one", "two", "three"])
  })

  it("stores a listing the channel would reject, so readiness stays reachable", async () => {
    // The database is not the place channel rules are enforced. A title far over
    // every channel limit must still persist, or the creator can never see the
    // requirement that explains it.
    const { error } = await alice.client
      .from("channel_listings")
      .update({ title: "x".repeat(400) })
      .eq("id", aliceListingId)
    expect(error).toBeNull()
  })

  it("records each save as its own snapshot, and none of them can be edited", async () => {
    const admin = adminClient()
    const { data: before } = await admin
      .from("listing_snapshots")
      .select("id")
      .eq("channel_listing_id", aliceListingId)

    for (const title of ["First pass", "Second pass"]) {
      await alice.client.from("channel_listings").update({ title }).eq("id", aliceListingId)
      const { error } = await alice.client.from("listing_snapshots").insert({
        workspace_id: alice.workspaceId,
        channel_listing_id: aliceListingId,
        product_id: (
          await alice.client
            .from("channel_listings")
            .select("product_id")
            .eq("id", aliceListingId)
            .single()
        ).data!.product_id,
        channel_id: channelId,
        snapshot_type: "update",
        payload: { listing: { title } },
      })
      expect(error).toBeNull()
    }

    const { data: after } = await admin
      .from("listing_snapshots")
      .select("id")
      .eq("channel_listing_id", aliceListingId)

    expect((after ?? []).length).toBe((before ?? []).length + 2)

    const target = after![0]!.id
    const { error: updateError } = await alice.client
      .from("listing_snapshots")
      .update({ payload: { listing: { title: "rewritten" } } })
      .eq("id", target)
    expect(updateError).not.toBeNull()
  })
})

describe("workspace A cannot edit workspace B's listing", () => {
  it("an update filters to zero rows and changes nothing", async () => {
    const { data: updated } = await alice.client
      .from("channel_listings")
      .update({ title: "Owned by alice now" })
      .eq("id", bobListingId)
      .select("id")
    expect(updated).toHaveLength(0)

    const { data } = await adminClient()
      .from("channel_listings")
      .select("title")
      .eq("id", bobListingId)
      .single()
    expect(data?.title).toBe("Original title")
  })

  it("a snapshot cannot be written against another workspace's listing", async () => {
    const { error } = await alice.client.from("listing_snapshots").insert({
      workspace_id: alice.workspaceId,
      channel_listing_id: bobListingId,
      product_id: "11111111-1111-4111-8111-111111111111",
      channel_id: channelId,
      snapshot_type: "update",
      payload: { listing: {} },
    })
    // The composite foreign key refuses: the listing is not alice's, so the
    // (id, workspace_id) pair does not exist. A policy checking workspace_id
    // alone would have let this through.
    expect(error).not.toBeNull()

    const { data } = await adminClient()
      .from("listing_snapshots")
      .select("id")
      .eq("channel_listing_id", bobListingId)
    expect(data).toHaveLength(0)
  })
})
