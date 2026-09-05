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
 * Tenancy and integrity for the A3 tables. The denial shapes are the ones
 * established in A1 and restated in docs/security.md:
 *
 *   SELECT, UPDATE, DELETE   200, empty array, no error. Assert row count.
 *   INSERT                   403, SQLSTATE 42501. Assert the error code.
 *
 * Every negative case is paired with a service-role read confirming the target
 * row is genuinely untouched. A zero-row response is not by itself proof that
 * nothing was written.
 */

let alice: Actor
let bob: Actor
let mockApiChannelId: string
let mockAssistedChannelId: string
let aliceProductId: string
let bobProductId: string
let aliceConnectionId: string
let bobConnectionId: string
let bobListingId: string
let bobSnapshotId: string

async function createProduct(actor: Actor, name: string, slug: string) {
  const { data, error } = await actor.client
    .from("products")
    .insert({ workspace_id: actor.workspaceId, name, slug, product_type: "font" })
    .select("id")
    .single()
  if (error) throw new Error(`could not create product: ${error.message}`)
  return data.id
}

async function createConnection(actor: Actor, channelId: string, account: string) {
  const { data, error } = await actor.client
    .from("channel_connections")
    .insert({
      workspace_id: actor.workspaceId,
      channel_id: channelId,
      external_account_id: account,
    })
    .select("id")
    .single()
  if (error) throw new Error(`could not create connection: ${error.message}`)
  return data.id
}

beforeAll(async () => {
  const admin = adminClient()
  const { data: channels, error } = await admin.from("channels").select("id, key")
  if (error) throw new Error(`could not read channels: ${error.message}`)

  mockApiChannelId = channels.find((c) => c.key === "mock_api")!.id
  mockAssistedChannelId = channels.find((c) => c.key === "mock_assisted")!.id

  alice = await createActor("c-alice")
  bob = await createActor("c-bob")

  aliceProductId = await createProduct(alice, "Alice Grotesk", "alice-grotesk")
  bobProductId = await createProduct(bob, "Bravo Grotesk", "bravo-grotesk")

  aliceConnectionId = await createConnection(alice, mockApiChannelId, "alice-shop")
  bobConnectionId = await createConnection(bob, mockApiChannelId, "bob-shop")

  const { data: listing, error: listingError } = await bob.client
    .from("channel_listings")
    .insert({
      workspace_id: bob.workspaceId,
      product_id: bobProductId,
      channel_id: mockApiChannelId,
      channel_connection_id: bobConnectionId,
      title: "Bravo Grotesk",
    })
    .select("id")
    .single()
  if (listingError) throw new Error(`could not create listing: ${listingError.message}`)
  bobListingId = listing.id

  const { data: snapshot, error: snapshotError } = await bob.client
    .from("listing_snapshots")
    .insert({
      workspace_id: bob.workspaceId,
      channel_listing_id: bobListingId,
      product_id: bobProductId,
      channel_id: mockApiChannelId,
      snapshot_type: "build",
      payload: { listing: { title: "Bravo Grotesk" } },
    })
    .select("id")
    .single()
  if (snapshotError) throw new Error(`could not create snapshot: ${snapshotError.message}`)
  bobSnapshotId = snapshot.id
})

afterAll(async () => {
  if (alice) await destroyActor(alice)
  if (bob) await destroyActor(bob)
})

describe("positive controls", () => {
  it("alice sees her own connection and only hers", async () => {
    const { data, error } = await alice.client.from("channel_connections").select("*")
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data?.[0]?.id).toBe(aliceConnectionId)
  })

  it("bob sees his own listing and snapshot", async () => {
    const { data: listings } = await bob.client.from("channel_listings").select("*")
    expect(listings).toHaveLength(1)

    const { data: snapshots } = await bob.client.from("listing_snapshots").select("*")
    expect(snapshots).toHaveLength(1)
  })
})

describe("the channels catalog", () => {
  it("is readable by any signed-in user, because it is not tenant data", async () => {
    const { data, error } = await alice.client.from("channels").select("*")
    expect(error).toBeNull()
    expect(data?.length).toBeGreaterThanOrEqual(2)
  })

  it("is not writable by a signed-in user: rows are born in migrations", async () => {
    const { error } = await alice.client
      .from("channels")
      .insert({ key: "rogue_channel", name: "Rogue", integration_type: "api" })
    expect(error?.code).toBe(RLS_DENIED)

    const { data } = await adminClient().from("channels").select("id").eq("key", "rogue_channel")
    expect(data).toHaveLength(0)
  })

  it("cannot have its capabilities rewritten, because it does not store any", async () => {
    const { error } = await alice.client
      .from("channels")
      .update({ integration_type: "api" })
      .eq("id", mockAssistedChannelId)
    expect(error?.code).toBe(RLS_DENIED)

    const { data } = await adminClient()
      .from("channels")
      .select("integration_type")
      .eq("id", mockAssistedChannelId)
      .single()
    expect(data?.integration_type).toBe("assisted")
  })

  it("is invisible to an unauthenticated client", async () => {
    const { error } = await anonClient().from("channels").select("*")
    expect(error?.code).toBe(RLS_DENIED)
  })
})

describe("credentials are unreachable through the API", () => {
  it("a signed-in user cannot select from channel_connection_secrets at all", async () => {
    const { error } = await alice.client.from("channel_connection_secrets").select("*")
    // No grant, so this is refused before RLS is even consulted.
    expect(error?.code).toBe(RLS_DENIED)
  })

  it("a signed-in user cannot insert a secret, even for their own connection", async () => {
    const { error } = await alice.client.from("channel_connection_secrets").insert({
      channel_connection_id: aliceConnectionId,
      workspace_id: alice.workspaceId,
      encrypted_credentials: "not-a-real-credential",
    })
    expect(error?.code).toBe(RLS_DENIED)

    // Scoped to the connection the forged insert named, not the whole table.
    // The assertion here is "alice's insert wrote nothing", and an unscoped
    // count says "no secret exists anywhere" — which is a different claim, and
    // false on any machine that has genuinely connected a channel. It passed
    // only while nobody had.
    const { data } = await adminClient()
      .from("channel_connection_secrets")
      .select("*")
      .eq("channel_connection_id", aliceConnectionId)
    expect(data).toHaveLength(0)
  })

  it("is invisible to an unauthenticated client", async () => {
    const { error } = await anonClient().from("channel_connection_secrets").select("*")
    expect(error?.code).toBe(RLS_DENIED)
  })
})

describe("workspace A cannot reach workspace B", () => {
  it("alice cannot read bob's connection", async () => {
    const { data, error } = await alice.client
      .from("channel_connections")
      .select("*")
      .eq("id", bobConnectionId)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it("alice cannot insert a connection into bob's workspace", async () => {
    const { error } = await alice.client.from("channel_connections").insert({
      workspace_id: bob.workspaceId,
      channel_id: mockApiChannelId,
      external_account_id: "stolen",
    })
    expect(error?.code).toBe(RLS_DENIED)

    const { data } = await adminClient()
      .from("channel_connections")
      .select("id")
      .eq("workspace_id", bob.workspaceId)
    expect(data).toHaveLength(1)
  })

  it("alice cannot update or delete bob's connection", async () => {
    const { data: updated } = await alice.client
      .from("channel_connections")
      .update({ status: "revoked" })
      .eq("id", bobConnectionId)
      .select("id")
    expect(updated).toHaveLength(0)

    const { data: deleted } = await alice.client
      .from("channel_connections")
      .delete()
      .eq("id", bobConnectionId)
      .select("id")
    expect(deleted).toHaveLength(0)

    const { data } = await adminClient()
      .from("channel_connections")
      .select("status")
      .eq("id", bobConnectionId)
      .single()
    expect(data?.status).toBe("active")
  })

  it("alice cannot read bob's listing", async () => {
    const { data, error } = await alice.client
      .from("channel_listings")
      .select("*")
      .eq("id", bobListingId)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it("alice cannot update bob's listing", async () => {
    const { data: updated } = await alice.client
      .from("channel_listings")
      .update({ title: "Owned" })
      .eq("id", bobListingId)
      .select("id")
    expect(updated).toHaveLength(0)

    const { data } = await adminClient()
      .from("channel_listings")
      .select("title")
      .eq("id", bobListingId)
      .single()
    expect(data?.title).toBe("Bravo Grotesk")
  })

  it("alice cannot read bob's snapshots", async () => {
    const { data } = await alice.client
      .from("listing_snapshots")
      .select("*")
      .eq("id", bobSnapshotId)
    expect(data).toHaveLength(0)
  })

  it("alice cannot attach a listing to bob's product, even carrying her own workspace_id", async () => {
    // The RLS policy checks workspace_id and would pass. The composite foreign
    // key is what refuses, which is the A2 lesson repeated here.
    const { error } = await alice.client.from("channel_listings").insert({
      workspace_id: alice.workspaceId,
      product_id: bobProductId,
      channel_id: mockApiChannelId,
      channel_connection_id: aliceConnectionId,
    })
    expect(error).not.toBeNull()

    const { data } = await adminClient()
      .from("channel_listings")
      .select("id")
      .eq("product_id", bobProductId)
    expect(data).toHaveLength(1)
  })

  it("alice cannot attach a listing to bob's connection", async () => {
    const { error } = await alice.client.from("channel_listings").insert({
      workspace_id: alice.workspaceId,
      product_id: aliceProductId,
      channel_id: mockApiChannelId,
      channel_connection_id: bobConnectionId,
    })
    expect(error).not.toBeNull()
  })

  it("refuses every table to an unauthenticated client", async () => {
    const anon = anonClient()
    for (const table of ["channel_connections", "channel_listings", "listing_snapshots"] as const) {
      const { error } = await anon.from(table).select("*")
      expect(error?.code, table).toBe(RLS_DENIED)
    }
  })
})

describe("snapshots are insert-only", () => {
  it("a workspace member cannot update their own snapshot", async () => {
    const { error } = await bob.client
      .from("listing_snapshots")
      .update({ payload: { tampered: true } })
      .eq("id", bobSnapshotId)
    expect(error?.code).toBe(RLS_DENIED)
  })

  it("a workspace member cannot delete their own snapshot", async () => {
    const { error } = await bob.client.from("listing_snapshots").delete().eq("id", bobSnapshotId)
    expect(error?.code).toBe(RLS_DENIED)
  })

  it("the service role cannot update or delete a snapshot whose listing is live", async () => {
    // Grants stop the app. The trigger is what stops everything else, including
    // a background job holding the service role key.
    const admin = adminClient()

    const { error: updateError } = await admin
      .from("listing_snapshots")
      .update({ payload: { tampered: true } })
      .eq("id", bobSnapshotId)
    expect(updateError).not.toBeNull()

    const { error: deleteError } = await admin
      .from("listing_snapshots")
      .delete()
      .eq("id", bobSnapshotId)
    expect(deleteError).not.toBeNull()

    const { data } = await admin
      .from("listing_snapshots")
      .select("payload")
      .eq("id", bobSnapshotId)
      .single()
    expect(data?.payload).toEqual({ listing: { title: "Bravo Grotesk" } })
  })

  it("goes with its listing when the listing is deleted, rather than blocking the delete", async () => {
    // Immutability must not become a reason a workspace cannot be deleted. A
    // snapshot refuses a direct delete and accepts a cascade from a parent that
    // is already gone, which is the difference between "history is not edited"
    // and "nothing can ever be removed".
    const connectionId = await createConnection(alice, mockApiChannelId, "alice-cascade-shop")
    const { data: listing } = await alice.client
      .from("channel_listings")
      .insert({
        workspace_id: alice.workspaceId,
        product_id: aliceProductId,
        channel_id: mockApiChannelId,
        channel_connection_id: connectionId,
      })
      .select("id")
      .single()

    const { error: snapshotError } = await alice.client.from("listing_snapshots").insert({
      workspace_id: alice.workspaceId,
      channel_listing_id: listing!.id,
      product_id: aliceProductId,
      channel_id: mockApiChannelId,
      snapshot_type: "build",
      payload: { listing: {} },
    })
    expect(snapshotError).toBeNull()

    const { error: deleteError } = await alice.client
      .from("channel_listings")
      .delete()
      .eq("id", listing!.id)
    expect(deleteError).toBeNull()

    const { data } = await adminClient()
      .from("listing_snapshots")
      .select("id")
      .eq("channel_listing_id", listing!.id)
    expect(data).toHaveLength(0)
  })

  it("does not block deleting the workspace it belongs to", async () => {
    // The real test of the rule above: a tenant deletion must succeed even
    // though it removes immutable rows.
    const doomed = await createActor("c-doomed")
    const productId = await createProduct(doomed, "Doomed", "doomed-product")
    const connectionId = await createConnection(doomed, mockApiChannelId, "doomed-shop")

    const { data: listing } = await doomed.client
      .from("channel_listings")
      .insert({
        workspace_id: doomed.workspaceId,
        product_id: productId,
        channel_id: mockApiChannelId,
        channel_connection_id: connectionId,
      })
      .select("id")
      .single()

    await doomed.client.from("listing_snapshots").insert({
      workspace_id: doomed.workspaceId,
      channel_listing_id: listing!.id,
      product_id: productId,
      channel_id: mockApiChannelId,
      snapshot_type: "build",
      payload: { listing: {} },
    })

    const admin = adminClient()
    const { error } = await admin.from("workspaces").delete().eq("id", doomed.workspaceId)
    expect(error).toBeNull()

    const { data } = await admin
      .from("listing_snapshots")
      .select("id")
      .eq("workspace_id", doomed.workspaceId)
    expect(data).toHaveLength(0)

    await admin.auth.admin.deleteUser(doomed.userId)
  })
})

describe("an assisted channel can never claim verification", () => {
  it("refuses a verified status on an assisted channel", async () => {
    const connectionId = await createConnection(alice, mockAssistedChannelId, "alice-assisted")

    const { error } = await alice.client.from("channel_listings").insert({
      workspace_id: alice.workspaceId,
      product_id: aliceProductId,
      channel_id: mockAssistedChannelId,
      channel_connection_id: connectionId,
      status: "published",
      status_source: "verified",
    })

    expect(error).not.toBeNull()
    expect(error?.message).toContain("assisted")
  })

  it("accepts a self-reported status on the same channel", async () => {
    const { data, error } = await alice.client
      .from("channel_listings")
      .select("id, status_source")
      .eq("channel_id", mockAssistedChannelId)
    expect(error).toBeNull()
    // The rejected insert above left nothing behind.
    expect(data).toHaveLength(0)

    const { data: connection } = await alice.client
      .from("channel_connections")
      .select("id")
      .eq("channel_id", mockAssistedChannelId)
      .single()

    const { error: insertError } = await alice.client.from("channel_listings").insert({
      workspace_id: alice.workspaceId,
      product_id: aliceProductId,
      channel_id: mockAssistedChannelId,
      channel_connection_id: connection!.id,
      status: "published",
      status_source: "self_reported",
    })
    expect(insertError).toBeNull()
  })

  it("refuses an update that promotes an assisted listing to verified", async () => {
    const { data: listing } = await alice.client
      .from("channel_listings")
      .select("id")
      .eq("channel_id", mockAssistedChannelId)
      .single()

    const { error } = await alice.client
      .from("channel_listings")
      .update({ status_source: "verified" })
      .eq("id", listing!.id)
    expect(error).not.toBeNull()

    const { data } = await adminClient()
      .from("channel_listings")
      .select("status_source")
      .eq("id", listing!.id)
      .single()
    expect(data?.status_source).toBe("self_reported")
  })

  it("allows a verified status on an api channel", async () => {
    const { error } = await alice.client.from("channel_listings").insert({
      workspace_id: alice.workspaceId,
      product_id: aliceProductId,
      channel_id: mockApiChannelId,
      channel_connection_id: aliceConnectionId,
      status: "published",
      status_source: "verified",
    })
    expect(error).toBeNull()
  })
})

describe("integrity constraints", () => {
  it("allows one listing per product per connection, not two", async () => {
    const { error } = await alice.client.from("channel_listings").insert({
      workspace_id: alice.workspaceId,
      product_id: aliceProductId,
      channel_id: mockApiChannelId,
      channel_connection_id: aliceConnectionId,
    })
    expect(error?.code).toBe("23505")
  })

  it("lets one product have a listing on two connections to the same channel", async () => {
    // Two shops on one marketplace is a real pattern, and it is also two
    // billable units. The uniqueness key is the connection, not the channel.
    const secondConnection = await createConnection(alice, mockApiChannelId, "alice-second-shop")

    const { error } = await alice.client.from("channel_listings").insert({
      workspace_id: alice.workspaceId,
      product_id: aliceProductId,
      channel_id: mockApiChannelId,
      channel_connection_id: secondConnection,
    })
    expect(error).toBeNull()
  })

  it("refuses two listings claiming the same external object on one channel", async () => {
    const admin = adminClient()

    const { error: first } = await admin
      .from("channel_listings")
      .update({ external_listing_id: "external-42" })
      .eq("id", bobListingId)
    expect(first).toBeNull()

    const { data: aliceListing } = await admin
      .from("channel_listings")
      .select("id")
      .eq("workspace_id", alice.workspaceId)
      .eq("channel_id", mockApiChannelId)
      .limit(1)
      .single()

    const { error: second } = await admin
      .from("channel_listings")
      .update({ external_listing_id: "external-42" })
      .eq("id", aliceListing!.id)
    expect(second?.code).toBe("23505")
  })

  it("connects the same external account to one workspace only once", async () => {
    const { error } = await alice.client.from("channel_connections").insert({
      workspace_id: alice.workspaceId,
      channel_id: mockApiChannelId,
      external_account_id: "alice-shop",
    })
    expect(error?.code).toBe("23505")
  })

  it("cascades listings when a connection is removed", async () => {
    const connectionId = await createConnection(alice, mockApiChannelId, "alice-temp-shop")
    await alice.client.from("channel_listings").insert({
      workspace_id: alice.workspaceId,
      product_id: aliceProductId,
      channel_id: mockApiChannelId,
      channel_connection_id: connectionId,
    })

    await alice.client.from("channel_connections").delete().eq("id", connectionId)

    const { data } = await adminClient()
      .from("channel_listings")
      .select("id")
      .eq("channel_connection_id", connectionId)
    expect(data).toHaveLength(0)
  })
})
