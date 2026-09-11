import { afterAll, describe, expect, it } from "vitest"
import {
  RLS_DENIED,
  adminClient,
  anonClient,
  createActor,
  destroyActor,
  type Actor,
  type Client,
} from "./harness"

/**
 * First-run provisioning, at the database.
 *
 * The route that provisions a workspace is a GET, and browsers replay GETs, so
 * "one personal workspace, however many times it runs" has to hold where
 * requests cannot race past it. These run as real users holding real JWTs, like
 * every tenancy test, and count rows with the service role afterwards: a
 * returned id is not by itself proof that nothing else was written.
 */

const PASSWORD = "correct-horse-battery-staple"
const UNIQUE_VIOLATION = "23505"
const CHECK_VIOLATION = "23514"

interface Newcomer {
  userId: string
  client: Client
}

const newcomers: Newcomer[] = []
const actors: Actor[] = []

let counter = 0
function next(): number {
  counter += 1
  return counter
}

/** A confirmed, signed-in user who belongs to no workspace yet. */
async function newcomer(label: string): Promise<Newcomer> {
  const email = `prov-${label}-${Date.now()}-${next()}@fanwise.test`
  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`could not create test user: ${error?.message}`)

  const client = anonClient()
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (signInError) throw new Error(`could not sign in test user: ${signInError.message}`)

  const created = { userId: data.user.id, client }
  newcomers.push(created)
  return created
}

async function actor(label: string): Promise<Actor> {
  const created = await createActor(label)
  actors.push(created)
  return created
}

function slug(label: string): string {
  return `prov-${label}-${Date.now().toString(36)}-${next().toString(36)}`
}

function provision(client: Client, p_slug: string, p_name = "My studio") {
  return client.rpc("provision_personal_workspace", { p_name, p_slug })
}

async function ownedWorkspaceIds(userId: string): Promise<string[]> {
  const { data, error } = await adminClient()
    .from("workspaces")
    .select("id")
    .eq("owner_user_id", userId)
  if (error) throw error
  return (data ?? []).map((w) => w.id)
}

afterAll(async () => {
  const admin = adminClient()
  for (const n of newcomers) {
    // owner_user_id is on delete restrict, so the workspace goes first.
    await admin.from("workspaces").delete().eq("owner_user_id", n.userId)
    await admin.auth.admin.deleteUser(n.userId)
  }
  for (const a of actors) await destroyActor(a)
})

describe("provision_personal_workspace", () => {
  it("refuses an anonymous caller", async () => {
    const { data, error } = await provision(anonClient(), slug("anon"))
    expect(error?.code).toBe(RLS_DENIED)
    expect(data).toBeNull()
  })

  it("gives a user with no workspace exactly one, which they own and can read", async () => {
    const n = await newcomer("one")
    const requested = slug("one")

    const { data, error } = await provision(n.client, requested)

    expect(error).toBeNull()
    expect(data).toMatchObject({ slug: requested, name: "My studio", owner_user_id: n.userId })
    expect(await ownedWorkspaceIds(n.userId)).toEqual([data!.id])

    const { data: memberships } = await adminClient()
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("user_id", n.userId)
    expect(memberships).toEqual([{ workspace_id: data!.id, role: "owner" }])

    // And RLS agrees with the service role about what they can see.
    const { data: visible } = await n.client.from("workspaces").select("id")
    expect(visible?.map((w) => w.id)).toEqual([data!.id])
  })

  it("returns the same workspace on a retry, ignoring the new name and slug", async () => {
    const n = await newcomer("retry")

    const first = await provision(n.client, slug("retry-a"))
    const second = await provision(n.client, slug("retry-b"), "Another studio")

    expect(first.error).toBeNull()
    expect(second.error).toBeNull()
    expect(second.data).toEqual(first.data)
    expect(await ownedWorkspaceIds(n.userId)).toEqual([first.data!.id])
  })

  it("creates one workspace when many calls race", async () => {
    // The case that "check, then insert" in application code gets wrong. Each
    // call is its own request and its own transaction, asking for a different
    // slug so that no unique constraint can be what saves it.
    const n = await newcomer("race")

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => provision(n.client, slug(`race-${i}`))),
    )

    for (const result of results) expect(result.error).toBeNull()
    expect(new Set(results.map((r) => r.data?.id)).size).toBe(1)
    expect(await ownedWorkspaceIds(n.userId)).toHaveLength(1)
  })

  it("routes a user who already has a workspace to it, creating nothing", async () => {
    const existing = await actor("prov-existing")

    const { data, error } = await provision(existing.client, slug("existing"))

    expect(error).toBeNull()
    expect(data?.id).toBe(existing.workspaceId)
    expect(await ownedWorkspaceIds(existing.userId)).toEqual([existing.workspaceId])
  })

  it("never hands back another user's workspace, even when given its slug", async () => {
    const owner = await actor("prov-owner")
    const other = await actor("prov-other")

    const { data, error } = await provision(other.client, owner.workspaceSlug)

    expect(error).toBeNull()
    expect(data?.id).toBe(other.workspaceId)
    expect(data?.id).not.toBe(owner.workspaceId)
  })

  it("rolls a slug collision back whole, and a retry with another slug succeeds", async () => {
    const owner = await actor("prov-taken")
    const n = await newcomer("collide")

    const collided = await provision(n.client, owner.workspaceSlug)
    expect(collided.error?.code).toBe(UNIQUE_VIOLATION)
    expect(collided.data).toBeNull()
    expect(await ownedWorkspaceIds(n.userId)).toEqual([])

    // Nothing half-made: no orphan membership either.
    const { data: memberships } = await adminClient()
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", n.userId)
    expect(memberships).toEqual([])

    const retried = await provision(n.client, slug("collide-retry"))
    expect(retried.error).toBeNull()
    expect(await ownedWorkspaceIds(n.userId)).toEqual([retried.data!.id])
  })

  it("still enforces the table's rules on the name and slug it is given", async () => {
    const n = await newcomer("rules")

    const badSlug = await provision(n.client, "Not A Slug!")
    expect(badSlug.error?.code).toBe(CHECK_VIOLATION)

    const blankName = await provision(n.client, slug("rules"), "   ")
    expect(blankName.error?.code).toBe(CHECK_VIOLATION)

    expect(await ownedWorkspaceIds(n.userId)).toEqual([])
  })
})
