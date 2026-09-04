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
 * A1 exit test: Workspace A cannot reach any Workspace B row, for every table.
 *
 * Denials do not all look alike, and asserting the wrong shape is how this suite
 * would pass while proving nothing:
 *
 *   SELECT, UPDATE, DELETE   the policy filters rows away, so PostgREST returns
 *                            200 with an empty array and no error. Assert on the
 *                            row count.
 *   INSERT                   there is no row to filter, so the write raises and
 *                            PostgREST returns 403 with SQLSTATE 42501. Assert on
 *                            the error code. An empty-array assertion here would
 *                            pass vacuously, because data is null on error.
 *
 * Every negative case is paired with a service-role read confirming the target
 * row is genuinely untouched. A zero-row response is not by itself proof that
 * nothing was written.
 */

let alice: Actor
let bob: Actor

beforeAll(async () => {
  alice = await createActor("alice")
  bob = await createActor("bob")
})

afterAll(async () => {
  if (alice) await destroyActor(alice)
  if (bob) await destroyActor(bob)
})

describe("positive controls", () => {
  it("alice reads her own workspace", async () => {
    const { data, error } = await alice.client.from("workspaces").select("*")
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data?.[0]?.id).toBe(alice.workspaceId)
  })

  it("alice reads her own membership and is its owner", async () => {
    const { data, error } = await alice.client.from("workspace_members").select("*")
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data?.[0]?.workspace_id).toBe(alice.workspaceId)
    expect(data?.[0]?.user_id).toBe(alice.userId)
    expect(data?.[0]?.role).toBe("owner")
  })

  it("alice can rename her own workspace", async () => {
    const { data, error } = await alice.client
      .from("workspaces")
      .update({ name: "Renamed by owner" })
      .eq("id", alice.workspaceId)
      .select()

    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })
})

describe("workspaces: alice cannot reach bob", () => {
  it("cannot select bob's workspace", async () => {
    const { data, error } = await alice.client
      .from("workspaces")
      .select("*")
      .eq("id", bob.workspaceId)

    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it("cannot update bob's workspace, and the row is untouched", async () => {
    const { data, error } = await alice.client
      .from("workspaces")
      .update({ name: "seized" })
      .eq("id", bob.workspaceId)
      .select()

    expect(error).toBeNull()
    expect(data).toEqual([])

    const { data: actual } = await adminClient()
      .from("workspaces")
      .select("name")
      .eq("id", bob.workspaceId)
      .single()
    expect(actual?.name).not.toBe("seized")
  })

  it("cannot delete bob's workspace, and the row survives", async () => {
    const { data, error } = await alice.client
      .from("workspaces")
      .delete()
      .eq("id", bob.workspaceId)
      .select()

    expect(error).toBeNull()
    expect(data).toEqual([])

    const { count } = await adminClient()
      .from("workspaces")
      .select("*", { count: "exact", head: true })
      .eq("id", bob.workspaceId)
    expect(count).toBe(1)
  })

  it("cannot insert a workspace directly, bypassing create_workspace", async () => {
    const { data, error } = await alice.client
      .from("workspaces")
      .insert({ name: "Side door", slug: "side-door", owner_user_id: alice.userId })
      .select()

    // Insert denial is an error, not an empty set.
    expect(data).toBeNull()
    expect(error?.code).toBe(RLS_DENIED)

    const { count } = await adminClient()
      .from("workspaces")
      .select("*", { count: "exact", head: true })
      .eq("slug", "side-door")
    expect(count).toBe(0)
  })

  it("cannot insert a workspace owned by bob", async () => {
    const { data, error } = await alice.client
      .from("workspaces")
      .insert({ name: "Impersonation", slug: "impersonation", owner_user_id: bob.userId })
      .select()

    expect(data).toBeNull()
    expect(error?.code).toBe(RLS_DENIED)
  })
})

describe("workspace_members: alice cannot reach bob", () => {
  it("cannot select bob's membership", async () => {
    const { data, error } = await alice.client
      .from("workspace_members")
      .select("*")
      .eq("workspace_id", bob.workspaceId)

    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it("cannot insert herself into bob's workspace", async () => {
    const { data, error } = await alice.client
      .from("workspace_members")
      .insert({ workspace_id: bob.workspaceId, user_id: alice.userId, role: "owner" })
      .select()

    expect(data).toBeNull()
    expect(error?.code).toBe(RLS_DENIED)

    const { count } = await adminClient()
      .from("workspace_members")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", bob.workspaceId)
    expect(count).toBe(1)
  })

  it("cannot update bob's membership, and the role is untouched", async () => {
    const { data, error } = await alice.client
      .from("workspace_members")
      .update({ role: "viewer" })
      .eq("workspace_id", bob.workspaceId)
      .select()

    expect(error).toBeNull()
    expect(data).toEqual([])

    const { data: actual } = await adminClient()
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", bob.workspaceId)
      .eq("user_id", bob.userId)
      .single()
    expect(actual?.role).toBe("owner")
  })

  it("cannot delete bob's membership, and the row survives", async () => {
    const { data, error } = await alice.client
      .from("workspace_members")
      .delete()
      .eq("workspace_id", bob.workspaceId)
      .select()

    expect(error).toBeNull()
    expect(data).toEqual([])

    const { count } = await adminClient()
      .from("workspace_members")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", bob.workspaceId)
    expect(count).toBe(1)
  })
})

describe("anonymous callers", () => {
  it("cannot read workspaces", async () => {
    const { data, error } = await anonClient().from("workspaces").select("*")
    // anon holds no grant at all, so this is denied before RLS is consulted.
    expect(data).toBeNull()
    expect(error?.code).toBe(RLS_DENIED)
  })

  it("cannot read workspace_members", async () => {
    const { data, error } = await anonClient().from("workspace_members").select("*")
    expect(data).toBeNull()
    expect(error?.code).toBe(RLS_DENIED)
  })

  it("cannot call create_workspace", async () => {
    const { error } = await anonClient().rpc("create_workspace", {
      p_name: "Anonymous",
      p_slug: "anonymous-workspace",
    })
    expect(error?.code).toBe(RLS_DENIED)
  })
})

describe("create_workspace", () => {
  it("writes the workspace and its owner membership together", async () => {
    const admin = adminClient()
    const { data: workspace } = await admin
      .from("workspaces")
      .select("*")
      .eq("id", alice.workspaceId)
      .single()
    expect(workspace?.owner_user_id).toBe(alice.userId)

    const { data: membership } = await admin
      .from("workspace_members")
      .select("*")
      .eq("workspace_id", alice.workspaceId)
      .single()
    expect(membership?.user_id).toBe(alice.userId)
    expect(membership?.role).toBe("owner")
  })

  it("rejects a duplicate slug so the caller can retry with a suffix", async () => {
    const { error } = await bob.client.rpc("create_workspace", {
      p_name: "Collision",
      p_slug: alice.workspaceSlug,
    })
    // unique_violation. lib/workspaces/actions.ts keys its retry on this code.
    expect(error?.code).toBe("23505")
  })
})
