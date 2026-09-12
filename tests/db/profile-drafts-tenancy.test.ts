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
 * The public-profile builder's draft, from both sides of the tenant boundary.
 *
 * What this file holds, against a real database rather than a mock:
 *
 *   1. A draft is private. `anon` has no grant on the table at all, so a
 *      signed-out read is a permission error, not an empty result.
 *   2. Workspace B cannot read, write, delete or attach to workspace A's draft,
 *      by any column it controls.
 *   3. Saving a draft does not change the live profile.
 *   4. The revision filter the save action uses really does refuse a stale
 *      write.
 *   5. The migration's other changes hold: Behance is https-only on the live
 *      row, and `channels` is a reserved handle.
 */

let alice: Actor
let bob: Actor
let aliceProfileId: string
let bobProfileId: string

async function profileFor(actor: Actor, handle: string): Promise<string> {
  const { data, error } = await actor.client
    .from("public_profiles")
    .insert({
      workspace_id: actor.workspaceId,
      handle,
      display_name: "Studio",
      short_bio: "Live bio.",
    })
    .select("id")
    .single()
  if (error) throw new Error(`profile: ${error.message}`)
  return data.id
}

beforeAll(async () => {
  alice = await createActor("drafts-alice")
  bob = await createActor("drafts-bob")
  const suffix = Date.now().toString(36)
  aliceProfileId = await profileFor(alice, `alice-${suffix}`)
  bobProfileId = await profileFor(bob, `bob-${suffix}`)

  const { error } = await alice.client.from("public_profile_drafts").insert({
    public_profile_id: aliceProfileId,
    workspace_id: alice.workspaceId,
    handle: "alice-draft-address",
    display_name: "Alice Draft",
    short_bio: "Unpublished words.",
  })
  if (error) throw new Error(`draft: ${error.message}`)
})

afterAll(async () => {
  if (alice) await destroyActor(alice)
  if (bob) await destroyActor(bob)
})

describe("a profile draft is private to its workspace", () => {
  it("is readable by its own members", async () => {
    const { data, error } = await alice.client
      .from("public_profile_drafts")
      .select("display_name")
      .eq("public_profile_id", aliceProfileId)
      .single()
    expect(error).toBeNull()
    expect(data?.display_name).toBe("Alice Draft")
  })

  it("is not readable signed out at all: no grant, not an empty filter", async () => {
    const { data, error } = await anonClient().from("public_profile_drafts").select("*")
    expect(error?.code).toBe(RLS_DENIED)
    expect(data).toBeNull()
  })

  it("is invisible to another workspace", async () => {
    const { data } = await bob.client
      .from("public_profile_drafts")
      .select("*")
      .eq("public_profile_id", aliceProfileId)
    expect(data).toEqual([])
  })

  it("cannot be updated or deleted by another workspace", async () => {
    const { data: updated } = await bob.client
      .from("public_profile_drafts")
      .update({ display_name: "Bob was here" })
      .eq("public_profile_id", aliceProfileId)
      .select("public_profile_id")
    expect(updated).toEqual([])

    const { data: deleted } = await bob.client
      .from("public_profile_drafts")
      .delete()
      .eq("public_profile_id", aliceProfileId)
      .select("public_profile_id")
    expect(deleted).toEqual([])

    const { data: still } = await adminClient()
      .from("public_profile_drafts")
      .select("display_name")
      .eq("public_profile_id", aliceProfileId)
      .single()
    expect(still?.display_name).toBe("Alice Draft")
  })

  it("cannot be attached to another workspace's profile", async () => {
    // Bob's workspace id with Alice's profile: the composite foreign key refuses it.
    const asBob = await bob.client.from("public_profile_drafts").insert({
      public_profile_id: aliceProfileId,
      workspace_id: bob.workspaceId,
    })
    expect(asBob.error).not.toBeNull()

    // Alice's workspace id: RLS refuses it, because Bob is not a member.
    const asAlice = await bob.client.from("public_profile_drafts").insert({
      public_profile_id: bobProfileId,
      workspace_id: alice.workspaceId,
    })
    expect(asAlice.error).not.toBeNull()
  })

  it("cannot point its image outside its own profile's folder", async () => {
    const { error } = await alice.client
      .from("public_profile_drafts")
      .update({ avatar_path: `${bobProfileId}/draft-x.png` })
      .eq("public_profile_id", aliceProfileId)
    expect(error).not.toBeNull()
  })
})

describe("saving a draft", () => {
  it("does not change the live profile", async () => {
    await alice.client
      .from("public_profile_drafts")
      .update({ short_bio: "Changed in the draft only." })
      .eq("public_profile_id", aliceProfileId)

    const { data } = await adminClient()
      .from("public_profiles")
      .select("short_bio, status")
      .eq("id", aliceProfileId)
      .single()
    expect(data).toEqual({ short_bio: "Live bio.", status: "draft" })
  })

  it("refuses a write against a stale revision", async () => {
    const first = await alice.client
      .from("public_profile_drafts")
      .update({ display_name: "Tab one", revision: 1 })
      .eq("public_profile_id", aliceProfileId)
      .eq("revision", 0)
      .select("revision")
    expect(first.data).toEqual([{ revision: 1 }])

    const stale = await alice.client
      .from("public_profile_drafts")
      .update({ display_name: "Tab two", revision: 1 })
      .eq("public_profile_id", aliceProfileId)
      .eq("revision", 0)
      .select("revision")
    expect(stale.data).toEqual([])
  })

  it("bounds the stored introduction at 160 characters", async () => {
    const { error } = await alice.client
      .from("public_profile_drafts")
      .update({ short_bio: "x".repeat(161) })
      .eq("public_profile_id", aliceProfileId)
    expect(error).not.toBeNull()
  })
})

describe("the live profile's new rules", () => {
  it("takes an https Behance link and refuses anything else", async () => {
    const ok = await alice.client
      .from("public_profiles")
      .update({ behance_url: "https://www.behance.net/alice" })
      .eq("id", aliceProfileId)
    expect(ok.error).toBeNull()

    const bad = await alice.client
      .from("public_profiles")
      .update({ behance_url: "javascript:alert(1)" })
      .eq("id", aliceProfileId)
    expect(bad.error).not.toBeNull()
  })

  it("reserves `channels` as a handle", async () => {
    const { error } = await alice.client
      .from("public_profiles")
      .update({ handle: "channels" })
      .eq("id", aliceProfileId)
    expect(error).not.toBeNull()
  })
})
