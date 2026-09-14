import { randomBytes } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { deliverableLinkToken } from "@/lib/channels/deliverable-link"
import {
  ensureDeliverableLink,
  hashToken,
  resolveDeliverableLink,
} from "@/lib/publishing/deliverable-links"
import { adminClient, anonClient, createActor, destroyActor, type Actor } from "./harness"

/**
 * Durable deliverable addresses, against a real database.
 *
 * What the migration and lib/publishing/deliverable-links.ts promise, each
 * proved rather than inspected: nobody but the service role can touch the
 * table; an address is stable, and stays single under a race; the table alone
 * yields no working token; every refusal a store could meet resolves to the
 * same nothing; and deleting the file takes the address down with it.
 */

const NO_GRANT = "42501"
const FOREIGN_KEY_VIOLATION = "23503"

let alice: Actor
let bob: Actor
let channelId: string

type Seeded = { listingId: string; productId: string }

async function seedListing(actor: Actor, label: string): Promise<Seeded> {
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
    })
    .select("id")
    .single()
  if (listingError) throw new Error(`listing: ${listingError.message}`)

  return { listingId: listing.id, productId: product.id }
}

async function seedAsset(
  actor: Actor,
  productId: string,
  overrides: {
    asset_type?: "deliverable" | "archive" | "cover_image"
    asset_state?: "ready" | "pending"
  } = {},
) {
  const id = crypto.randomUUID()
  const { data, error } = await adminClient()
    .from("product_assets")
    .insert({
      id,
      workspace_id: actor.workspaceId,
      product_id: productId,
      asset_type: overrides.asset_type ?? "deliverable",
      asset_state: overrides.asset_state ?? "ready",
      // A ready asset must have been measured; the database refuses one that was not.
      checksum: "0".repeat(64),
      byte_size: 1024,
      mime_type: "application/zip",
      filename: "Aster Grotesk.zip",
      storage_path: `${actor.workspaceId}/${productId}/${id}.zip`,
    })
    .select("id, filename")
    .single()
  if (error) throw new Error(`asset: ${error.message}`)
  return data
}

function tokenOf(url: string): string {
  const token = deliverableLinkToken(url)
  if (!token) throw new Error(`not a deliverable address: ${url}`)
  return token
}

let aliceSeed: Seeded

beforeAll(async () => {
  if (!process.env.CREDENTIALS_ENCRYPTION_KEY) {
    process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString("base64")
  }
  process.env.NEXT_PUBLIC_APP_URL ??= "https://app.fanwise.test"

  const { data: channels, error } = await adminClient().from("channels").select("id, key")
  if (error) throw new Error(`could not read channels: ${error.message}`)
  channelId = channels.find((c) => c.key === "mock_api")!.id

  alice = await createActor("dl-alice")
  bob = await createActor("dl-bob")
  aliceSeed = await seedListing(alice, "dl-alice")
})

afterAll(async () => {
  if (alice) await destroyActor(alice)
  if (bob) await destroyActor(bob)
})

describe("the table is unreachable from the browser", () => {
  it("anon has no grant", async () => {
    const { error } = await anonClient().from("listing_deliverable_links").select("*")
    expect(error?.code).toBe(NO_GRANT)
  })

  it("a member has no grant, even for their own listing's addresses", async () => {
    const asset = await seedAsset(alice, aliceSeed.productId)
    await ensureDeliverableLink({
      admin: adminClient(),
      workspaceId: alice.workspaceId,
      listingId: aliceSeed.listingId,
      asset,
    })

    const { error: readError } = await alice.client.from("listing_deliverable_links").select("*")
    expect(readError?.code).toBe(NO_GRANT)

    const { error: writeError } = await alice.client.from("listing_deliverable_links").insert({
      workspace_id: alice.workspaceId,
      channel_listing_id: aliceSeed.listingId,
      asset_id: asset.id,
      token_hash: "forged",
      token_sealed: "forged",
      key_version: 1,
    })
    expect(writeError?.code).toBe(NO_GRANT)
  })
})

describe("an address", () => {
  it("is stable: the same listing and file get the same address every time", async () => {
    const asset = await seedAsset(alice, aliceSeed.productId)
    const params = {
      admin: adminClient(),
      workspaceId: alice.workspaceId,
      listingId: aliceSeed.listingId,
      asset,
    }

    const first = await ensureDeliverableLink(params)
    const second = await ensureDeliverableLink(params)

    expect(second).toBe(first)
    expect(first).toContain("/api/public/deliverable/Aster-Grotesk.zip?token=")
  })

  it("stays single when two writes race to make it", async () => {
    const asset = await seedAsset(alice, aliceSeed.productId)
    const params = {
      admin: adminClient(),
      workspaceId: alice.workspaceId,
      listingId: aliceSeed.listingId,
      asset,
    }

    const results = await Promise.all([1, 2, 3, 4].map(() => ensureDeliverableLink(params)))

    expect(new Set(results).size).toBe(1)
    const { data } = await adminClient()
      .from("listing_deliverable_links")
      .select("id")
      .eq("asset_id", asset.id)
    expect(data).toHaveLength(1)
  })

  it("is not recoverable from the table alone", async () => {
    const asset = await seedAsset(alice, aliceSeed.productId)
    const url = await ensureDeliverableLink({
      admin: adminClient(),
      workspaceId: alice.workspaceId,
      listingId: aliceSeed.listingId,
      asset,
    })
    const token = tokenOf(url)

    const { data: row } = await adminClient()
      .from("listing_deliverable_links")
      .select("*")
      .eq("asset_id", asset.id)
      .single()

    expect(row!.token_hash).toBe(hashToken(token))
    expect(JSON.stringify(row)).not.toContain(token)
  })

  it("cannot pair one workspace's listing with another workspace's file", async () => {
    const bobSeed = await seedListing(bob, "dl-bob")
    const bobAsset = await seedAsset(bob, bobSeed.productId)

    const { error } = await adminClient()
      .from("listing_deliverable_links")
      .insert({
        workspace_id: alice.workspaceId,
        channel_listing_id: aliceSeed.listingId,
        asset_id: bobAsset.id,
        token_hash: `cross-${crypto.randomUUID()}`,
        token_sealed: "x",
        key_version: 1,
      })
    expect(error?.code).toBe(FOREIGN_KEY_VIOLATION)
  })
})

describe("resolving a token", () => {
  async function linked(overrides: Parameters<typeof seedAsset>[2] = {}) {
    const asset = await seedAsset(alice, aliceSeed.productId, overrides)
    const url = await ensureDeliverableLink({
      admin: adminClient(),
      workspaceId: alice.workspaceId,
      listingId: aliceSeed.listingId,
      asset,
    })
    return { asset, token: tokenOf(url) }
  }

  it("serves a ready buyer file, and records that it did", async () => {
    const { asset, token } = await linked()

    const resolved = await resolveDeliverableLink(adminClient(), token)

    expect(resolved).toEqual({
      storagePath: `${alice.workspaceId}/${aliceSeed.productId}/${asset.id}.zip`,
      filename: "Aster Grotesk.zip",
    })
    const { data } = await adminClient()
      .from("listing_deliverable_links")
      .select("last_downloaded_at")
      .eq("asset_id", asset.id)
      .single()
    expect(data!.last_downloaded_at).not.toBeNull()
  })

  it("refuses an unknown, malformed or revoked token alike", async () => {
    const { asset, token } = await linked()
    const admin = adminClient()

    expect(await resolveDeliverableLink(admin, "x".repeat(43))).toBeNull()
    expect(await resolveDeliverableLink(admin, "not a token")).toBeNull()

    await admin
      .from("listing_deliverable_links")
      .update({ revoked_at: new Date().toISOString() })
      .eq("asset_id", asset.id)
    expect(await resolveDeliverableLink(admin, token)).toBeNull()
  })

  it("refuses a file that is not ready, or not a buyer file", async () => {
    const admin = adminClient()
    const pending = await linked({ asset_state: "pending" })
    expect(await resolveDeliverableLink(admin, pending.token)).toBeNull()

    const cover = await linked({ asset_type: "cover_image" })
    expect(await resolveDeliverableLink(admin, cover.token)).toBeNull()
  })

  it("goes away with the file: deleting the asset deletes the address", async () => {
    const { asset, token } = await linked()
    const admin = adminClient()

    await admin.from("product_assets").delete().eq("id", asset.id)

    expect(await resolveDeliverableLink(admin, token)).toBeNull()
    const { data } = await admin
      .from("listing_deliverable_links")
      .select("id")
      .eq("asset_id", asset.id)
    expect(data).toEqual([])
  })
})
