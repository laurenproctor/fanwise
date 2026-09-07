import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { adminClient, createActor, destroyActor, type Actor } from "./harness"
import { startPublication } from "@/lib/publishing/start"
import { runPublication } from "@/lib/publishing/runner"
import { publishKey } from "@/lib/publishing/idempotency"
import type { ChannelListingDraft } from "@/lib/channels/types"

/**
 * A5's exit test, the half of it that does not need a live shop:
 * **a second click creates nothing.**
 *
 * This drives the real publish path — the real job row, the real database
 * constraint, the real runner and its guards — against the mock API channel,
 * which returns a deterministic external id and never touches a network. The
 * Shopify adapter differs from that mock only in what happens inside publish();
 * everything these tests exercise sits above it and is shared by every channel.
 *
 * The three guards from docs/architecture.md are tested one at a time, because
 * each of them is individually sufficient and each covers a case the others do
 * not:
 *
 *   1. an existing external_listing_id
 *   2. an existing successful publication job
 *   3. the idempotency key itself
 */

let alice: Actor
let channelId: string
let listingId: string
let productId: string

const draft: ChannelListingDraft = {
  title: "Aster Grotesk",
  description: "A grotesque in nine weights, drawn for long text.",
  shortDescription: "Nine weights.",
  seoTitle: null,
  seoDescription: null,
  price: 48,
  currency: "USD",
  category: "font",
  tags: [],
  metadata: {},
}

/**
 * The in-process queue runs handlers on a microtask, so a publication started
 * through startPublication may already have completed by the time the call
 * returns. Settling here rather than asserting immediately keeps the tests
 * about idempotency instead of about scheduling.
 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 250))
}

async function createListing(label: string): Promise<{ listingId: string; productId: string }> {
  const { data: product, error: productError } = await alice.client
    .from("products")
    .insert({
      workspace_id: alice.workspaceId,
      name: `${label} Grotesk`,
      slug: `${label}-grotesk`,
      product_type: "font",
    })
    .select("id")
    .single()
  if (productError) throw new Error(`product: ${productError.message}`)

  const { data: connection, error: connectionError } = await alice.client
    .from("channel_connections")
    .insert({
      workspace_id: alice.workspaceId,
      channel_id: channelId,
      external_account_id: `${label}-shop`,
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
      channel_id: channelId,
      channel_connection_id: connection.id,
      title: draft.title,
      description: draft.description,
      price: draft.price,
      currency: draft.currency,
    })
    .select("id")
    .single()
  if (listingError) throw new Error(`listing: ${listingError.message}`)

  return { listingId: listing.id, productId: product.id }
}

async function jobsFor(id: string) {
  const { data } = await adminClient()
    .from("publication_jobs")
    .select("id, kind, status, attempt_count, idempotency_key")
    .eq("channel_listing_id", id)
    .order("created_at", { ascending: true })
  return data ?? []
}

async function listingRow(id: string) {
  const { data } = await adminClient().from("channel_listings").select("*").eq("id", id).single()
  return data!
}

beforeAll(async () => {
  const { data: channels, error } = await adminClient().from("channels").select("id, key")
  if (error) throw new Error(`could not read channels: ${error.message}`)
  channelId = channels.find((c) => c.key === "mock_api")!.id

  alice = await createActor("idem")
  const created = await createListing("aster")
  listingId = created.listingId
  productId = created.productId
})

afterAll(async () => {
  await destroyActor(alice)
})

describe("publishing once", () => {
  it("publishes, records the external object, and confirms it as verified", async () => {
    const outcome = await startPublication({
      supabase: alice.client,
      workspaceId: alice.workspaceId,
      listingId,
      kind: "publish",
      draft,
      generation: 0,
    })
    expect(outcome.kind).toBe("started")
    await settle()

    const listing = await listingRow(listingId)
    expect(listing.status).toBe("published")
    expect(listing.external_listing_id).toBe(`mock-api-${listingId}`)
    expect(listing.external_url).toContain(listingId)
    // A provider API confirmed it, so the claim is verified rather than
    // self-reported. The database trigger would refuse this on an assisted
    // channel.
    expect(listing.status_source).toBe("verified")
    expect(listing.published_at).not.toBeNull()

    const jobs = await jobsFor(listingId)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.status).toBe("succeeded")
    expect(jobs[0]!.idempotency_key).toBe(publishKey(alice.workspaceId, listingId, 0))
  })

  it("writes exactly one immutable publish snapshot", async () => {
    const { data } = await adminClient()
      .from("listing_snapshots")
      .select("snapshot_type, payload")
      .eq("channel_listing_id", listingId)
      .eq("snapshot_type", "publish")
    expect(data).toHaveLength(1)

    // Invariant 4, and the snapshot has to record what actually landed.
    const payload = data![0]!.payload as Record<string, unknown>
    const publication = payload.publication as Record<string, unknown>
    expect(publication.externalListingId).toBe(`mock-api-${listingId}`)
    expect(publication.kind).toBe("publish")
  })
})

describe("a second click creates nothing", () => {
  it("returns already_done and adds no job", async () => {
    const before = await jobsFor(listingId)

    const outcome = await startPublication({
      supabase: alice.client,
      workspaceId: alice.workspaceId,
      listingId,
      kind: "publish",
      draft,
      generation: 0,
    })
    await settle()

    expect(outcome.kind).toBe("already_done")

    const after = await jobsFor(listingId)
    expect(after).toHaveLength(before.length)
  })

  it("does not change the external object already recorded", async () => {
    const listing = await listingRow(listingId)
    expect(listing.external_listing_id).toBe(`mock-api-${listingId}`)
  })

  it("collides even when the listing was edited in between", async () => {
    // The reason a publish key excludes content. A creator who clicks Publish,
    // fixes a typo and clicks again has performed one publication, not two.
    await alice.client
      .from("channel_listings")
      .update({ title: "Aster Grotesk Variable" })
      .eq("id", listingId)

    const outcome = await startPublication({
      supabase: alice.client,
      workspaceId: alice.workspaceId,
      listingId,
      kind: "publish",
      draft: { ...draft, title: "Aster Grotesk Variable", price: 99 },
      generation: 0,
    })
    await settle()

    expect(outcome.kind).toBe("already_done")
    expect(await jobsFor(listingId)).toHaveLength(1)
  })

  it("writes no second snapshot for the publication that did not happen", async () => {
    const { data } = await adminClient()
      .from("listing_snapshots")
      .select("id")
      .eq("channel_listing_id", listingId)
      .eq("snapshot_type", "publish")
    expect(data).toHaveLength(1)
  })
})

describe("guard 1: an external id already exists", () => {
  it("skips the provider call entirely, even for a job with a fresh key", async () => {
    // This is the guard that survives what the unique key cannot see: a job row
    // lost to a cascade, or a listing published under an older key.
    const { listingId: otherId } = await createListing("bravo")

    await adminClient()
      .from("channel_listings")
      .update({
        external_listing_id: "already-there",
        status: "published",
        status_source: "verified",
      })
      .eq("id", otherId)

    const { data: job } = await adminClient()
      .from("publication_jobs")
      .insert({
        workspace_id: alice.workspaceId,
        channel_listing_id: otherId,
        kind: "publish",
        idempotency_key: `manual-key-${otherId}`,
      })
      .select("id")
      .single()

    await runPublication({ workspaceId: alice.workspaceId, publicationJobId: job!.id })

    const { data: after } = await adminClient()
      .from("publication_jobs")
      .select("status, provider_response")
      .eq("id", job!.id)
      .single()

    expect(after!.status).toBe("succeeded")
    expect(after!.provider_response).toMatchObject({ skipped: "already_published" })

    // The external id the provider gave is not overwritten by a new one.
    const listing = await listingRow(otherId)
    expect(listing.external_listing_id).toBe("already-there")
  })
})

describe("retrying a failure", () => {
  it("reuses the same row and key rather than starting a second operation", async () => {
    const { listingId: retryId } = await createListing("charlie")

    const first = await startPublication({
      supabase: alice.client,
      workspaceId: alice.workspaceId,
      listingId: retryId,
      kind: "publish",
      draft,
      generation: 0,
    })
    await settle()
    expect(first.kind).toBe("started")

    // Force the row back to a failed state, as a transport error would leave
    // it, and clear what the successful run recorded.
    const jobId = (first as { jobId: string }).jobId
    await adminClient()
      .from("publication_jobs")
      .update({ status: "failed", normalized_error_code: "network" })
      .eq("id", jobId)
    await adminClient()
      .from("channel_listings")
      .update({ external_listing_id: null, status: "failed" })
      .eq("id", retryId)

    const second = await startPublication({
      supabase: alice.client,
      workspaceId: alice.workspaceId,
      listingId: retryId,
      kind: "publish",
      draft,
      generation: 0,
    })
    await settle()

    expect(second.kind).toBe("retried")
    expect((second as { jobId: string }).jobId).toBe(jobId)

    const jobs = await jobsFor(retryId)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.status).toBe("succeeded")
    // The attempt count is what records that this was tried twice; a second row
    // would have recorded it as two operations.
    expect(jobs[0]!.attempt_count).toBeGreaterThanOrEqual(2)

    const listing = await listingRow(retryId)
    expect(listing.external_listing_id).toBe(`mock-api-${retryId}`)
  })
})

describe("publishing again after the channel lost the product", () => {
  /*
    The failure this closes, end to end and against the real constraint.

    A product deleted in the provider's admin leaves the listing pointing at an
    id that returns Not Found. Everything that made a second click safe then
    works against the creator: the publish key is claimed, so the insert
    collides and reports "already published", and the runner's second guard
    finds an earlier succeeded publish and skips. There was no way back.

    The generation is what distinguishes "this operation has already happened"
    from "the thing it produced no longer exists". It moves only where the
    provider has confirmed the absence — the adapter raises
    `external_object_missing`, and runPublication clears the listing and
    increments it — so the guarantee inside a generation is untouched, which is
    what the first assertion below checks before the second one relies on it.
  */

  it("blocks the repeat, then allows the re-publish once the generation moves", async () => {
    const { listingId: goneId } = await createListing("delta")

    const first = await startPublication({
      supabase: alice.client,
      workspaceId: alice.workspaceId,
      listingId: goneId,
      kind: "publish",
      draft,
      generation: 0,
    })
    await settle()
    expect(first.kind).toBe("started")
    expect((await listingRow(goneId)).external_listing_id).toBe(`mock-api-${goneId}`)

    // Still one product, still one operation. Nothing below is allowed to
    // weaken this.
    const repeat = await startPublication({
      supabase: alice.client,
      workspaceId: alice.workspaceId,
      listingId: goneId,
      kind: "publish",
      draft,
      generation: 0,
    })
    expect(repeat.kind).toBe("already_done")
    expect(await jobsFor(goneId)).toHaveLength(1)

    /*
      What runPublication does when an adapter reports the object gone. Written
      here rather than driven through the adapter because the mock API channel
      has no way to lose a product; what is under test is the publishing path's
      response to that state, which is shared by every channel.
    */
    await adminClient()
      .from("channel_listings")
      .update({
        external_listing_id: null,
        external_url: null,
        status: "draft",
        status_source: "self_reported",
        last_sent_fingerprint: null,
        publish_generation: 1,
      })
      .eq("id", goneId)

    const again = await startPublication({
      supabase: alice.client,
      workspaceId: alice.workspaceId,
      listingId: goneId,
      kind: "publish",
      draft,
      generation: 1,
    })
    await settle()

    // A new operation, not a repeat: a new row, a new key, and a product at
    // the end of it. Before the generation existed this was `already_done`
    // forever.
    expect(again.kind).toBe("started")

    const jobs = await jobsFor(goneId)
    expect(jobs).toHaveLength(2)
    expect(jobs[0]!.idempotency_key).toBe(publishKey(alice.workspaceId, goneId, 0))
    expect(jobs[1]!.idempotency_key).toBe(publishKey(alice.workspaceId, goneId, 1))
    // The second guard did not skip it. That guard matches on kind, so without
    // being scoped to the generation it would have found job one and reported
    // this as already published, new key or not.
    expect(jobs[1]!.status).toBe("succeeded")

    const listing = await listingRow(goneId)
    expect(listing.status).toBe("published")
    expect(listing.external_listing_id).toBe(`mock-api-${goneId}`)
  })
})

describe("the runner never runs one job twice", () => {
  it("refuses a second claim on a job that already succeeded", async () => {
    const jobs = await jobsFor(listingId)
    const jobId = jobs[0]!.id

    const { data: before } = await adminClient()
      .from("publication_jobs")
      .select("attempt_count")
      .eq("id", jobId)
      .single()

    await runPublication({ workspaceId: alice.workspaceId, publicationJobId: jobId })

    const { data: after } = await adminClient()
      .from("publication_jobs")
      .select("attempt_count, status")
      .eq("id", jobId)
      .single()

    // The compare-and-swap only claims pending or failed rows, so nothing
    // happened at all: no second attempt, no second provider call.
    expect(after!.attempt_count).toBe(before!.attempt_count)
    expect(after!.status).toBe("succeeded")
  })

  it("does nothing for a job in another workspace", async () => {
    const bob = await createActor("idem-bob")
    const jobs = await jobsFor(listingId)

    await runPublication({ workspaceId: bob.workspaceId, publicationJobId: jobs[0]!.id })

    const { data } = await adminClient()
      .from("publication_jobs")
      .select("status")
      .eq("id", jobs[0]!.id)
      .single()
    expect(data!.status).toBe("succeeded")

    await destroyActor(bob)
  })
})

describe("manual steps", () => {
  it("creates none for a channel that uploads the deliverable itself", async () => {
    // mock_api declares digitalFileUpload, so there is nothing left for a
    // person to do and no step row should exist.
    const { data } = await adminClient()
      .from("listing_manual_steps")
      .select("id")
      .eq("channel_listing_id", listingId)
    expect(data).toHaveLength(0)
    expect(productId).toBeTruthy()
  })
})
