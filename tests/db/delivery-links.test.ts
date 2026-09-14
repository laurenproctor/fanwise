import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  RLS_DENIED,
  adminClient,
  anonClient,
  createActor,
  destroyActor,
  type Actor,
} from "./harness"
import { deliveryUrlFor, resolveDeliveryToken, revokeDeliveryLinks } from "@/lib/delivery/links"

/**
 * Download links a storefront serves to buyers (ADR 0012).
 *
 * The address is a bearer capability for a paid file, so the table behind it is
 * as closed as the credentials table: nobody but the service role reaches it.
 * And the address is only as good as the checks behind it, so each is proved to
 * withdraw the download on its own — revocation, an unpublished listing, a file
 * that is not a deliverable.
 */

let alice: Actor
let bob: Actor
let listingId: string
let deliverableId: string
let coverId: string

function tokenOf(url: string): string {
  return url.split("/").pop()!
}

async function asset(actor: Actor, productId: string, assetType: string, filename: string) {
  const { data, error } = await actor.client
    .from("product_assets")
    .insert({
      workspace_id: actor.workspaceId,
      product_id: productId,
      asset_type: assetType as "deliverable",
      asset_state: "ready",
      storage_path: `${actor.workspaceId}/${productId}/${crypto.randomUUID()}.zip`,
      filename,
      mime_type: "application/zip",
      byte_size: 1024,
      checksum: "a".repeat(64),
    })
    .select("id")
    .single()
  if (error) throw new Error(`asset: ${error.message}`)
  return data.id
}

beforeAll(async () => {
  alice = await createActor("delivery-a")
  bob = await createActor("delivery-b")

  const { data: channel } = await adminClient()
    .from("channels")
    .select("id")
    .eq("key", "mock_api")
    .single()

  const { data: product, error: productError } = await alice.client
    .from("products")
    .insert({ workspace_id: alice.workspaceId, name: "Aster", slug: "aster", product_type: "font" })
    .select("id")
    .single()
  if (productError) throw new Error(`product: ${productError.message}`)

  const { data: connection, error: connectionError } = await alice.client
    .from("channel_connections")
    .insert({
      workspace_id: alice.workspaceId,
      channel_id: channel!.id,
      external_account_id: "delivery-shop",
      status: "active",
    })
    .select("id")
    .single()
  if (connectionError) throw new Error(`connection: ${connectionError.message}`)

  const { data: listing, error: listingError } = await alice.client
    .from("channel_listings")
    .insert({
      workspace_id: alice.workspaceId,
      product_id: product.id,
      channel_id: channel!.id,
      channel_connection_id: connection.id,
    })
    .select("id")
    .single()
  if (listingError) throw new Error(`listing: ${listingError.message}`)
  listingId = listing.id

  // Published the way the runner records it: the service role writes status.
  await adminClient()
    .from("channel_listings")
    .update({ status: "published", status_source: "verified", external_listing_id: "ext-1" })
    .eq("id", listingId)

  deliverableId = await asset(alice, product.id, "deliverable", "aster.zip")
  coverId = await asset(alice, product.id, "cover_image", "cover.png")
})

afterAll(async () => {
  await destroyActor(alice)
  await destroyActor(bob)
})

describe("the table is unreachable except by the service role", () => {
  it("refuses a signed-in member, even the listing's own workspace", async () => {
    const read = await alice.client.from("delivery_links").select("*")
    expect(read.error?.code).toBe(RLS_DENIED)
    const write = await alice.client.from("delivery_links").insert({
      workspace_id: alice.workspaceId,
      channel_listing_id: listingId,
      product_asset_id: deliverableId,
      token_hash: "0".repeat(64),
      encrypted_token: "forged",
    })
    expect(write.error?.code).toBe(RLS_DENIED)
  })

  it("refuses a visitor", async () => {
    const { error } = await anonClient().from("delivery_links").select("*")
    expect(error?.code).toBe(RLS_DENIED)
  })

  it("cannot pair one workspace's listing with another workspace's link", async () => {
    const { error } = await adminClient()
      .from("delivery_links")
      .insert({
        workspace_id: bob.workspaceId,
        channel_listing_id: listingId,
        product_asset_id: deliverableId,
        token_hash: "1".repeat(64),
        encrypted_token: "x",
      })
    // The composite foreign key, not a convention.
    expect(error?.code).toBe("23503")
  })
})

describe("one address per file per listing", () => {
  it("returns the same address every time, and stores no readable token", async () => {
    const first = await deliveryUrlFor({
      workspaceId: alice.workspaceId,
      listingId,
      assetId: deliverableId,
    })
    const second = await deliveryUrlFor({
      workspaceId: alice.workspaceId,
      listingId,
      assetId: deliverableId,
    })
    expect(second).toBe(first)
    expect(first).toMatch(/\/api\/public\/delivery\/[A-Za-z0-9_-]{43}$/)

    const { data } = await adminClient()
      .from("delivery_links")
      .select("token_hash, encrypted_token")
      .eq("channel_listing_id", listingId)
    expect(data).toHaveLength(1)
    expect(JSON.stringify(data)).not.toContain(tokenOf(first))
  })
})

describe("what an address downloads", () => {
  it("resolves to the file while the listing is published", async () => {
    const url = await deliveryUrlFor({
      workspaceId: alice.workspaceId,
      listingId,
      assetId: deliverableId,
    })
    const resolved = await resolveDeliveryToken(tokenOf(url))
    expect(resolved?.filename).toBe("aster.zip")
  })

  it("resolves nothing for a token that was never issued, or is malformed", async () => {
    expect(await resolveDeliveryToken("A".repeat(43))).toBeNull()
    expect(await resolveDeliveryToken("../../etc/passwd")).toBeNull()
  })

  it("resolves nothing for a file that is not a deliverable", async () => {
    const url = await deliveryUrlFor({
      workspaceId: alice.workspaceId,
      listingId,
      assetId: coverId,
    })
    expect(await resolveDeliveryToken(tokenOf(url))).toBeNull()
  })

  it("stops when the listing is no longer published", async () => {
    const url = await deliveryUrlFor({
      workspaceId: alice.workspaceId,
      listingId,
      assetId: deliverableId,
    })
    await adminClient().from("channel_listings").update({ status: "draft" }).eq("id", listingId)
    try {
      expect(await resolveDeliveryToken(tokenOf(url))).toBeNull()
    } finally {
      await adminClient()
        .from("channel_listings")
        .update({ status: "published" })
        .eq("id", listingId)
    }
  })

  it("stops when revoked, and the next address is a different one", async () => {
    const before = await deliveryUrlFor({
      workspaceId: alice.workspaceId,
      listingId,
      assetId: deliverableId,
    })
    const revoked = await revokeDeliveryLinks({ workspaceId: alice.workspaceId, listingId })
    expect(revoked).toBeGreaterThan(0)
    expect(await resolveDeliveryToken(tokenOf(before))).toBeNull()

    const after = await deliveryUrlFor({
      workspaceId: alice.workspaceId,
      listingId,
      assetId: deliverableId,
    })
    expect(after).not.toBe(before)
    expect((await resolveDeliveryToken(tokenOf(after)))?.filename).toBe("aster.zip")
  })
})
