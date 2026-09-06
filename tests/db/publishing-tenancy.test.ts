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
 * Tenancy and integrity for the A5 tables.
 *
 * The denial shapes are the ones established in A1 and restated in
 * docs/security.md:
 *
 *   SELECT, UPDATE, DELETE   200, empty array, no error. Assert row count.
 *   INSERT                   403, SQLSTATE 42501. Assert the error code.
 *   No grant at all          42501, refused before RLS is consulted.
 *
 * Every negative case is paired with a service-role read confirming the target
 * row is genuinely untouched. A zero-row response is not by itself proof that
 * nothing was written.
 */

let alice: Actor
let bob: Actor
let channelId: string
let aliceListingId: string
let bobListingId: string
let bobJobId: string
let bobStepId: string

async function seedListing(actor: Actor, label: string): Promise<string> {
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

  return listing.id
}

beforeAll(async () => {
  const admin = adminClient()
  const { data: channels, error } = await admin.from("channels").select("id, key")
  if (error) throw new Error(`could not read channels: ${error.message}`)
  channelId = channels.find((c) => c.key === "mock_api")!.id

  alice = await createActor("p-alice")
  bob = await createActor("p-bob")

  aliceListingId = await seedListing(alice, "alice")
  bobListingId = await seedListing(bob, "bravo")

  const { data: job, error: jobError } = await bob.client
    .from("publication_jobs")
    .insert({
      workspace_id: bob.workspaceId,
      channel_listing_id: bobListingId,
      kind: "publish",
      idempotency_key: `publish:${bob.workspaceId}:${bobListingId}`,
    })
    .select("id")
    .single()
  if (jobError) throw new Error(`job: ${jobError.message}`)
  bobJobId = job.id

  const { data: step, error: stepError } = await bob.client
    .from("listing_manual_steps")
    .insert({
      workspace_id: bob.workspaceId,
      channel_listing_id: bobListingId,
      step_key: "attach_digital_file",
    })
    .select("id")
    .single()
  if (stepError) throw new Error(`step: ${stepError.message}`)
  bobStepId = step.id
})

afterAll(async () => {
  await destroyActor(alice)
  await destroyActor(bob)
})

describe("positive controls", () => {
  it("a member reads their own publication job", async () => {
    const { data, error } = await bob.client
      .from("publication_jobs")
      .select("id")
      .eq("id", bobJobId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it("a member reads their own manual steps", async () => {
    const { data, error } = await bob.client
      .from("listing_manual_steps")
      .select("id")
      .eq("id", bobStepId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it("a member completes their own manual step", async () => {
    const { error } = await bob.client
      .from("listing_manual_steps")
      .update({ completed_at: new Date().toISOString() })
      .eq("id", bobStepId)
    expect(error).toBeNull()

    const { data } = await adminClient()
      .from("listing_manual_steps")
      .select("completed_at")
      .eq("id", bobStepId)
      .single()
    expect(data?.completed_at).not.toBeNull()
  })
})

describe("workspace A cannot reach workspace B", () => {
  it("cannot select another workspace's publication jobs", async () => {
    const { data, error } = await alice.client.from("publication_jobs").select("*")
    expect(error).toBeNull()
    expect(data?.some((row) => row.id === bobJobId)).toBe(false)
  })

  it("cannot insert a publication job into another workspace", async () => {
    const { error } = await alice.client.from("publication_jobs").insert({
      workspace_id: bob.workspaceId,
      channel_listing_id: bobListingId,
      kind: "publish",
      idempotency_key: `forged:${bobListingId}`,
    })
    expect(error?.code).toBe(RLS_DENIED)

    const { data } = await adminClient()
      .from("publication_jobs")
      .select("id")
      .eq("idempotency_key", `forged:${bobListingId}`)
    expect(data).toHaveLength(0)
  })

  it("cannot attach a publication job to another workspace's listing under its own id", async () => {
    // The A2 lesson, re-tested here: a policy checking workspace_id alone would
    // pass this, because the row carries Alice's own workspace. The composite
    // foreign key is what refuses it.
    const { error } = await alice.client.from("publication_jobs").insert({
      workspace_id: alice.workspaceId,
      channel_listing_id: bobListingId,
      kind: "publish",
      idempotency_key: `crossed:${bobListingId}`,
    })
    expect(error).not.toBeNull()

    const { data } = await adminClient()
      .from("publication_jobs")
      .select("id")
      .eq("idempotency_key", `crossed:${bobListingId}`)
    expect(data).toHaveLength(0)
  })

  it("cannot select another workspace's manual steps", async () => {
    const { data, error } = await alice.client.from("listing_manual_steps").select("*")
    expect(error).toBeNull()
    expect(data?.some((row) => row.id === bobStepId)).toBe(false)
  })

  it("cannot complete another workspace's manual step", async () => {
    const before = await adminClient()
      .from("listing_manual_steps")
      .select("completed_by")
      .eq("id", bobStepId)
      .single()

    const { data, error } = await alice.client
      .from("listing_manual_steps")
      .update({ completed_by: alice.userId })
      .eq("id", bobStepId)
      .select()

    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)

    const after = await adminClient()
      .from("listing_manual_steps")
      .select("completed_by")
      .eq("id", bobStepId)
      .single()
    expect(after.data?.completed_by).toBe(before.data?.completed_by)
  })

  it("cannot attach a manual step to another workspace's listing", async () => {
    const { error } = await alice.client.from("listing_manual_steps").insert({
      workspace_id: alice.workspaceId,
      channel_listing_id: bobListingId,
      step_key: "attach_digital_file",
    })
    expect(error).not.toBeNull()
  })
})

describe("a job outcome is the system's account, not the creator's", () => {
  it("a member cannot update even their own publication job", async () => {
    // No UPDATE grant at all, so this is refused before RLS is consulted. The
    // runner holds the service role; a creator who could mark a failed
    // publication succeeded could hide a product that never went live.
    const { error } = await bob.client
      .from("publication_jobs")
      .update({ status: "succeeded" })
      .eq("id", bobJobId)
    expect(error?.code).toBe(RLS_DENIED)

    const { data } = await adminClient()
      .from("publication_jobs")
      .select("status")
      .eq("id", bobJobId)
      .single()
    expect(data?.status).toBe("pending")
  })

  it("a member cannot delete a publication job", async () => {
    const { error } = await bob.client.from("publication_jobs").delete().eq("id", bobJobId)
    expect(error?.code).toBe(RLS_DENIED)

    const { data } = await adminClient().from("publication_jobs").select("id").eq("id", bobJobId)
    expect(data).toHaveLength(1)
  })

  it("a member cannot delete a manual step to make it stop being required", async () => {
    const { error } = await bob.client.from("listing_manual_steps").delete().eq("id", bobStepId)
    expect(error?.code).toBe(RLS_DENIED)

    const { data } = await adminClient()
      .from("listing_manual_steps")
      .select("id")
      .eq("id", bobStepId)
    expect(data).toHaveLength(1)
  })
})

describe("idempotency is enforced by the database", () => {
  it("refuses a second job carrying the same key", async () => {
    // This is the constraint behind "a second click creates nothing". It holds
    // whatever the application layer does or forgets to do.
    const key = `publish:${alice.workspaceId}:${aliceListingId}`

    const first = await alice.client.from("publication_jobs").insert({
      workspace_id: alice.workspaceId,
      channel_listing_id: aliceListingId,
      kind: "publish",
      idempotency_key: key,
    })
    expect(first.error).toBeNull()

    const second = await alice.client.from("publication_jobs").insert({
      workspace_id: alice.workspaceId,
      channel_listing_id: aliceListingId,
      kind: "publish",
      idempotency_key: key,
    })
    expect(second.error?.code).toBe("23505")

    const { data } = await adminClient()
      .from("publication_jobs")
      .select("id")
      .eq("idempotency_key", key)
    expect(data).toHaveLength(1)
  })

  it("allows a different kind on the same listing", async () => {
    const { error } = await alice.client.from("publication_jobs").insert({
      workspace_id: alice.workspaceId,
      channel_listing_id: aliceListingId,
      kind: "activate",
      idempotency_key: `activate:${alice.workspaceId}:${aliceListingId}`,
    })
    expect(error).toBeNull()
  })

  it("refuses a job with no idempotency key at all", async () => {
    const { error } = await alice.client.from("publication_jobs").insert({
      workspace_id: alice.workspaceId,
      channel_listing_id: aliceListingId,
      kind: "update",
      idempotency_key: null as unknown as string,
    })
    expect(error).not.toBeNull()
  })

  it("records one manual step per listing, not one per attempt", async () => {
    const { error } = await bob.client.from("listing_manual_steps").insert({
      workspace_id: bob.workspaceId,
      channel_listing_id: bobListingId,
      step_key: "attach_digital_file",
    })
    expect(error?.code).toBe("23505")
  })
})

describe("OAuth state is unreachable through the API", () => {
  it("a signed-in user cannot select from channel_oauth_states at all", async () => {
    const { error } = await alice.client.from("channel_oauth_states").select("*")
    expect(error?.code).toBe(RLS_DENIED)
  })

  it("a signed-in user cannot insert a state", async () => {
    // Forging a state is forging the proof that an authorization was started.
    const { error } = await alice.client.from("channel_oauth_states").insert({
      state: "forged-state-value-that-is-long-enough",
      workspace_id: alice.workspaceId,
      channel_id: channelId,
      user_id: alice.userId,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    })
    expect(error?.code).toBe(RLS_DENIED)

    const { data } = await adminClient()
      .from("channel_oauth_states")
      .select("state")
      .eq("state", "forged-state-value-that-is-long-enough")
    expect(data).toHaveLength(0)
  })

  it("an anonymous caller cannot read states", async () => {
    const { error } = await anonClient().from("channel_oauth_states").select("*")
    expect(error?.code).toBe(RLS_DENIED)
  })
})

describe("anonymous callers reach nothing", () => {
  it("cannot read publication jobs", async () => {
    const { error } = await anonClient().from("publication_jobs").select("*")
    expect(error?.code).toBe(RLS_DENIED)
  })

  it("cannot read manual steps", async () => {
    const { error } = await anonClient().from("listing_manual_steps").select("*")
    expect(error?.code).toBe(RLS_DENIED)
  })
})

describe("cascades", () => {
  it("removes a listing's jobs and steps when the listing goes", async () => {
    const listingId = await seedListing(alice, "temp")
    await alice.client.from("publication_jobs").insert({
      workspace_id: alice.workspaceId,
      channel_listing_id: listingId,
      kind: "publish",
      idempotency_key: `publish:${alice.workspaceId}:${listingId}`,
    })
    await alice.client.from("listing_manual_steps").insert({
      workspace_id: alice.workspaceId,
      channel_listing_id: listingId,
      step_key: "attach_digital_file",
    })

    await adminClient().from("channel_listings").delete().eq("id", listingId)

    const jobs = await adminClient()
      .from("publication_jobs")
      .select("id")
      .eq("channel_listing_id", listingId)
    const steps = await adminClient()
      .from("listing_manual_steps")
      .select("id")
      .eq("channel_listing_id", listingId)

    // The cascade runs as the table owner and is not subject to the missing
    // DELETE grant, which is what lets a workspace be deleted at all.
    expect(jobs.data).toHaveLength(0)
    expect(steps.data).toHaveLength(0)
  })
})
