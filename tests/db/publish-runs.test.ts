import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  RLS_DENIED,
  adminClient,
  createActor,
  destroyActor,
  type Actor,
  type Client,
} from "./harness"

/**
 * The activity log, and the id that groups one run's jobs.
 *
 * Two promises are tested here rather than reviewed. An event, once written, is
 * evidence: no role can change it or remove it, including the service role the
 * job runner holds. And a run's rows belong to the workspace that made them,
 * like every other tenant table.
 */

const CHECK_VIOLATION = "23514"

let alice: Actor
let bob: Actor

beforeAll(async () => {
  alice = await createActor("run-alice")
  bob = await createActor("run-bob")
})

afterAll(async () => {
  if (alice) await destroyActor(alice)
  if (bob) await destroyActor(bob)
})

async function writeEvent(client: Client, workspaceId: string, runId: string) {
  return client
    .from("workspace_events")
    .insert({
      workspace_id: workspaceId,
      event_type: "publish_run_started",
      run_id: runId,
      payload: { starts: [{ channel: "Mock Storefront", kind: "publish" }], skips: [] },
    })
    .select("id, event_type, run_id")
    .single()
}

describe("workspace_events is append-only", () => {
  it("a member may write one and read it back", async () => {
    const runId = crypto.randomUUID()
    const { data, error } = await writeEvent(alice.client, alice.workspaceId, runId)

    expect(error).toBeNull()
    expect(data).toMatchObject({ event_type: "publish_run_started", run_id: runId })
  })

  it("refuses a member's update and delete, before any trigger is reached", async () => {
    const runId = crypto.randomUUID()
    const { data: event } = await writeEvent(alice.client, alice.workspaceId, runId)

    // No update or delete grant exists, so the refusal is a privilege error
    // rather than a policy filter: there is no route to the row at all.
    const updated = await alice.client
      .from("workspace_events")
      .update({ event_type: "publish_run_job_settled" })
      .eq("id", event!.id)
    const deleted = await alice.client.from("workspace_events").delete().eq("id", event!.id)

    expect(updated.error?.code).toBe(RLS_DENIED)
    expect(deleted.error?.code).toBe(RLS_DENIED)

    const { data: after } = await adminClient()
      .from("workspace_events")
      .select("event_type")
      .eq("id", event!.id)
      .single()
    expect(after?.event_type).toBe("publish_run_started")
  })

  it("refuses the service role too, which is the line that matters", async () => {
    // The job runner holds this role. An activity log its own writer can edit
    // afterwards is not evidence of anything.
    const runId = crypto.randomUUID()
    const { data: event } = await writeEvent(alice.client, alice.workspaceId, runId)
    const admin = adminClient()

    const updated = await admin
      .from("workspace_events")
      .update({ payload: { rewritten: true } })
      .eq("id", event!.id)
    const deleted = await admin.from("workspace_events").delete().eq("id", event!.id)

    expect(updated.error?.code).toBe(CHECK_VIOLATION)
    expect(deleted.error?.code).toBe(CHECK_VIOLATION)
  })

  it("refuses an event type that is not one shape", async () => {
    const { error } = await alice.client.from("workspace_events").insert({
      workspace_id: alice.workspaceId,
      event_type: "Publish Run Started",
    })

    expect(error?.code).toBe(CHECK_VIOLATION)
  })
})

describe("workspace_events is tenant-scoped", () => {
  it("bob cannot read alice's events", async () => {
    const runId = crypto.randomUUID()
    await writeEvent(alice.client, alice.workspaceId, runId)

    const { data, error } = await bob.client
      .from("workspace_events")
      .select("id")
      .eq("run_id", runId)

    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it("bob cannot write an event into alice's workspace", async () => {
    const { error } = await writeEvent(bob.client, alice.workspaceId, crypto.randomUUID())

    expect(error?.code).toBe(RLS_DENIED)

    const { data: rows } = await adminClient()
      .from("workspace_events")
      .select("id")
      .eq("workspace_id", alice.workspaceId)
      .eq("actor_user_id", bob.userId)
    expect(rows).toEqual([])
  })
})

describe("a run groups the jobs one click created", () => {
  it("carries the same run_id on every job, and none on a single publish", async () => {
    const admin = adminClient()
    const runId = crypto.randomUUID()

    const { data: channel } = await admin
      .from("channels")
      .select("id")
      .eq("key", "mock_api")
      .single()

    const { data: product, error: productError } = await alice.client
      .from("products")
      .insert({
        workspace_id: alice.workspaceId,
        name: "Run Grotesk",
        slug: `run-grotesk-${Date.now().toString(36)}`,
        product_type: "font",
      })
      .select("id")
      .single()
    if (productError) throw new Error(`product fixture: ${productError.message}`)

    // Two connections, because a product holds at most one listing per
    // connection: the schema says a product is on a shop once, which is exactly
    // the rule that makes a run one job per channel rather than several.
    const connect = async (account: string) => {
      const { data, error } = await alice.client
        .from("channel_connections")
        .insert({
          workspace_id: alice.workspaceId,
          channel_id: channel!.id,
          external_account_id: account,
        })
        .select("id")
        .single()
      if (error) throw new Error(`connection fixture: ${error.message}`)
      return data!.id
    }

    const listing = async (connectionId: string, title: string) => {
      const { data, error } = await alice.client
        .from("channel_listings")
        .insert({
          workspace_id: alice.workspaceId,
          product_id: product!.id,
          channel_id: channel!.id,
          channel_connection_id: connectionId,
          title,
        })
        .select("id")
        .single()
      if (error) throw new Error(`listing fixture: ${error.message}`)
      return data!.id
    }

    const suffix = Date.now().toString(36)
    const first = await listing(await connect(`run-shop-a-${suffix}`), "Run Grotesk one")
    const second = await listing(await connect(`run-shop-b-${suffix}`), "Run Grotesk two")

    const job = async (listingId: string, run: string | null, key: string) =>
      alice.client.from("publication_jobs").insert({
        workspace_id: alice.workspaceId,
        channel_listing_id: listingId,
        kind: "publish",
        idempotency_key: key,
        run_id: run,
      })

    const stamp = Date.now().toString(36)
    expect((await job(first, runId, `run-a-${stamp}`)).error).toBeNull()
    expect((await job(second, runId, `run-b-${stamp}`)).error).toBeNull()
    // A single-channel publish belongs to no run, and the column stays null.
    expect((await job(first, null, `run-solo-${stamp}`)).error).toBeNull()

    const { data: grouped } = await alice.client
      .from("publication_jobs")
      .select("id, run_id")
      .eq("run_id", runId)
    expect(grouped).toHaveLength(2)

    const { data: ungrouped } = await alice.client
      .from("publication_jobs")
      .select("id")
      .is("run_id", null)
      .eq("channel_listing_id", first)
    expect(ungrouped).toHaveLength(1)
  })
})
