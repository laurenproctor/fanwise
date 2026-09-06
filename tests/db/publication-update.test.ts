import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { adminClient, createActor, destroyActor, type Actor } from "./harness"
import { startPublication } from "@/lib/publishing/start"
import { sentFingerprint, updateKey } from "@/lib/publishing/idempotency"
import type { ChannelListingDraft } from "@/lib/channels/types"

/**
 * The update path, driven end to end for the first time.
 *
 * Every piece of this existed before the button did: startPublication took
 * `kind: "update"`, updateKey hashed the draft and the images, the runner
 * dispatched to adapter.update, and imagesFingerprint was exported and called
 * from nowhere. Nothing invoked any of it, so none of it had ever run outside
 * a unit test of its own arguments.
 *
 * These tests are that first run. They use the mock API channel, so what is
 * proved is the shared machinery above the adapter: the job, the key, the
 * fingerprint written back, and the snapshot.
 */

let alice: Actor
let channelId: string
let listingId: string
let productId: string

const draft: ChannelListingDraft = {
  title: "Aster Grotesk",
  description: "A grotesque in nine weights, drawn for long text.",
  shortDescription: "Nine weights.",
  price: 48,
  currency: "USD",
  category: "font",
  tags: [],
  metadata: {},
}

const edited: ChannelListingDraft = { ...draft, title: "Aster Grotesk Variable" }

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 250))
}

async function listingRow(id: string) {
  const { data } = await adminClient().from("channel_listings").select("*").eq("id", id).single()
  return data!
}

/**
 * Saves a draft onto the listing row.
 *
 * The real sequence, and the reason the first version of this test was wrong:
 * a creator saves an edit to Fanwise's row and then sends it. The runner reads
 * the row, not the draft handed to startPublication — that one only shapes the
 * idempotency key — so an update started without saving first sends the old
 * text and records the old fingerprint.
 */
async function saveToRow(d: ChannelListingDraft): Promise<void> {
  await adminClient()
    .from("channel_listings")
    .update({
      title: d.title,
      description: d.description,
      short_description: d.shortDescription,
      price: d.price,
      currency: d.currency,
      category: d.category,
      tags: d.tags,
    })
    .eq("id", listingId)
}

async function jobsFor(id: string) {
  const { data } = await adminClient()
    .from("publication_jobs")
    .select("id, kind, status, idempotency_key")
    .eq("channel_listing_id", id)
    .order("created_at", { ascending: true })
  return data ?? []
}

beforeAll(async () => {
  const { data: channels } = await adminClient().from("channels").select("id, key")
  channelId = channels!.find((c) => c.key === "mock_api")!.id
  alice = await createActor("update")

  const { data: product } = await alice.client
    .from("products")
    .insert({
      workspace_id: alice.workspaceId,
      name: "Aster Grotesk",
      slug: "aster-grotesk",
      product_type: "font",
    })
    .select("id")
    .single()

  const { data: connection } = await adminClient()
    .from("channel_connections")
    .insert({ workspace_id: alice.workspaceId, channel_id: channelId, status: "active" })
    .select("id")
    .single()

  const { data: listing } = await adminClient()
    .from("channel_listings")
    .insert({
      workspace_id: alice.workspaceId,
      product_id: product!.id,
      channel_id: channelId,
      channel_connection_id: connection!.id,
      status: "draft",
      status_source: "self_reported",
      title: draft.title,
      description: draft.description,
      short_description: draft.shortDescription,
      price: draft.price,
      currency: draft.currency,
      category: draft.category,
      tags: draft.tags,
    })
    .select("id")
    .single()

  listingId = listing!.id
  productId = product!.id

  await startPublication({
    supabase: alice.client,
    workspaceId: alice.workspaceId,
    listingId,
    kind: "publish",
    draft,
  })
  await settle()
})

afterAll(async () => {
  await destroyActor(alice)
})

describe("what a publish records about what it sent", () => {
  it("writes the fingerprint, so the UI can tell there is nothing left to send", async () => {
    // Written on publish and not only on update. Recorded only on update, a
    // freshly published listing would offer "Publish changes" immediately,
    // with nothing changed.
    const listing = await listingRow(listingId)
    expect(listing.status).toBe("published")
    expect(listing.last_sent_fingerprint).toBe(sentFingerprint(draft, ""))
  })
})

describe("updating a published listing", () => {
  it("runs, and records what the edit sent", async () => {
    await saveToRow(edited)

    const outcome = await startPublication({
      supabase: alice.client,
      workspaceId: alice.workspaceId,
      listingId,
      kind: "update",
      draft: edited,
      images: "",
    })
    expect(outcome.kind).toBe("started")
    await settle()

    const listing = await listingRow(listingId)
    // Still published, and still verified: an update does not unpublish.
    expect(listing.status).toBe("published")
    expect(listing.status_source).toBe("verified")
    expect(listing.last_sent_fingerprint).toBe(sentFingerprint(edited, ""))

    const update = (await jobsFor(listingId)).find((job) => job.kind === "update")
    expect(update?.status).toBe("succeeded")
    expect(update?.idempotency_key).toBe(updateKey(alice.workspaceId, listingId, edited, ""))
  })

  it("writes an update snapshot rather than a second publish snapshot", async () => {
    const { data } = await adminClient()
      .from("listing_snapshots")
      .select("snapshot_type")
      .eq("channel_listing_id", listingId)
    const types = (data ?? []).map((row) => row.snapshot_type)
    expect(types.filter((t) => t === "publish")).toHaveLength(1)
    expect(types.filter((t) => t === "update")).toHaveLength(1)
  })

  it("sending the same edit twice creates nothing", async () => {
    // The property the whole key exists for, on the kind that carries content.
    const before = await jobsFor(listingId)

    const outcome = await startPublication({
      supabase: alice.client,
      workspaceId: alice.workspaceId,
      listingId,
      kind: "update",
      draft: edited,
      images: "",
    })
    expect(outcome.kind).toBe("already_done")
    await settle()

    expect(await jobsFor(listingId)).toHaveLength(before.length)
  })

  it("an image-only change is a different update, not a collision", async () => {
    /*
      Why the key takes an image fingerprint at all. Adding a picture while
      leaving every word alone is a real change to the storefront, and without
      images in the key it would produce the key just used, be reported as
      already done, and never be sent.

      A real asset row rather than an invented fingerprint: the runner derives
      what it sent from the product's actual assets, so a fabricated string
      would prove nothing about the path a creator takes.
    */
    const { data: asset, error: assetError } = await adminClient()
      .from("product_assets")
      .insert({
        workspace_id: alice.workspaceId,
        product_id: productId,
        asset_type: "cover_image",
        asset_state: "ready",
        storage_path: `${alice.workspaceId}/${productId}/cover.png`,
        filename: "cover.png",
        sort_order: 0,
        // product_assets_ready_is_measured: a ready asset carries its
        // measurements, because a ready row is a promise the bytes landed.
        mime_type: "image/png",
        byte_size: 2048,
        checksum: "sha256:cover",
      })
      .select("id")
      .single()
    if (assetError) throw new Error(`asset insert failed: ${assetError.message}`)

    const outcome = await startPublication({
      supabase: alice.client,
      workspaceId: alice.workspaceId,
      listingId,
      kind: "update",
      draft: edited,
      images: asset!.id,
    })
    expect(outcome.kind).toBe("started")
    await settle()

    const listing = await listingRow(listingId)
    expect(listing.last_sent_fingerprint).toBe(sentFingerprint(edited, asset!.id))
  })
})
