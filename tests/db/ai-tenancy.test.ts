import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  RLS_DENIED,
  adminClient,
  anonClient,
  createActor,
  destroyActor,
  type Actor,
} from "./harness"

/**
 * Tenancy for ai_generations. Same denial shapes as every other tenant table:
 *
 *   SELECT, UPDATE, DELETE   200, empty array, no error. Assert row count.
 *   INSERT                   403, SQLSTATE 42501. Assert the error code.
 *
 * And the composite foreign keys: a member cannot attach a generation carrying
 * their own workspace to another workspace's listing or product, because the
 * key checks the pair.
 */

let alice: Actor
let bob: Actor
let channelId: string
let bobProductId: string
let bobListingId: string
let bobGenerationId: string
let aliceProductId: string
let aliceListingId: string

async function fixture(actor: Actor, label: string) {
  const { data: product, error: productError } = await actor.client
    .from("products")
    .insert({
      workspace_id: actor.workspaceId,
      name: `${label} Grotesk`,
      slug: `${label}-grotesk`,
      product_type: "font",
    })
    .select("id")
    .single()
  if (productError) throw new Error(`product: ${productError.message}`)

  const { data: connection, error: connectionError } = await actor.client
    .from("channel_connections")
    .insert({
      workspace_id: actor.workspaceId,
      channel_id: channelId,
      external_account_id: `${label}-shop`,
    })
    .select("id")
    .single()
  if (connectionError) throw new Error(`connection: ${connectionError.message}`)

  const { data: listing, error: listingError } = await actor.client
    .from("channel_listings")
    .insert({
      workspace_id: actor.workspaceId,
      product_id: product.id,
      channel_id: channelId,
      channel_connection_id: connection.id,
      title: `${label} Grotesk`,
    })
    .select("id")
    .single()
  if (listingError) throw new Error(`listing: ${listingError.message}`)

  return { productId: product.id, listingId: listing.id }
}

beforeAll(async () => {
  const { data: channels, error } = await adminClient().from("channels").select("id, key")
  if (error) throw new Error(`could not read channels: ${error.message}`)
  channelId = channels.find((c) => c.key === "mock_api")!.id

  alice = await createActor("ai-alice")
  bob = await createActor("ai-bob")

  const a = await fixture(alice, "ai-alice")
  aliceProductId = a.productId
  aliceListingId = a.listingId

  const b = await fixture(bob, "ai-bob")
  bobProductId = b.productId
  bobListingId = b.listingId

  const { data: generation, error: generationError } = await bob.client
    .from("ai_generations")
    .insert({
      workspace_id: bob.workspaceId,
      product_id: bobProductId,
      channel_listing_id: bobListingId,
    })
    .select("id")
    .single()
  if (generationError) throw new Error(`generation: ${generationError.message}`)
  bobGenerationId = generation.id
})

afterAll(async () => {
  if (alice) await destroyActor(alice)
  if (bob) await destroyActor(bob)
})

describe("positive control", () => {
  it("bob sees his own generation", async () => {
    const { data, error } = await bob.client.from("ai_generations").select("id")
    expect(error).toBeNull()
    expect(data).toEqual([{ id: bobGenerationId }])
  })
})

describe("alice cannot reach bob's generation", () => {
  it("select filters it away", async () => {
    const { data, error } = await alice.client
      .from("ai_generations")
      .select("id")
      .eq("id", bobGenerationId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it("insert into bob's workspace is refused", async () => {
    const { error } = await alice.client.from("ai_generations").insert({
      workspace_id: bob.workspaceId,
      product_id: bobProductId,
      channel_listing_id: bobListingId,
    })
    expect(error?.code).toBe(RLS_DENIED)
  })

  it("insert against bob's listing under alice's own workspace fails on the composite key", async () => {
    const { error } = await alice.client.from("ai_generations").insert({
      workspace_id: alice.workspaceId,
      product_id: aliceProductId,
      channel_listing_id: bobListingId,
    })
    expect(error).not.toBeNull()

    const { data } = await adminClient()
      .from("ai_generations")
      .select("id")
      .eq("channel_listing_id", bobListingId)
    expect(data).toEqual([{ id: bobGenerationId }])
  })

  it("delete is refused: there is no delete grant", async () => {
    const { error } = await alice.client.from("ai_generations").delete().eq("id", bobGenerationId)
    expect(error?.code).toBe(RLS_DENIED)

    const { data } = await adminClient()
      .from("ai_generations")
      .select("id")
      .eq("id", bobGenerationId)
    expect(data).toEqual([{ id: bobGenerationId }])
  })

  it("anon has no access at all", async () => {
    const { error } = await anonClient().from("ai_generations").select("id")
    expect(error?.code).toBe(RLS_DENIED)
  })
})

describe("alice's own generation", () => {
  it("can be created against her own listing", async () => {
    const { data, error } = await alice.client
      .from("ai_generations")
      .insert({
        workspace_id: alice.workspaceId,
        product_id: aliceProductId,
        channel_listing_id: aliceListingId,
      })
      .select("id, status")
      .single()
    expect(error).toBeNull()
    expect(data?.status).toBe("pending")
  })
})
