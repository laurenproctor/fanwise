import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
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
 * Who may execute what, in the exposed schema.
 *
 * Migration 20260909170000 made every function's execute privilege explicit
 * and turned the default for a new one to nothing. These tests hold that line
 * from both sides: the roles a browser can hold are refused on everything that
 * is not meant for them, and the two things that are meant for them still
 * work. The denial shape is the one docs/security.md records for a call with
 * no grant: refused before RLS is consulted, SQLSTATE 42501.
 *
 * The last describe reads pg_proc directly, because the next function someone
 * adds is the one these behavioral tests cannot name in advance.
 */

/** Functions a signed-in user may call, and why. Everything else is refused. */
const AUTHENTICATED_MAY_EXECUTE = new Set([
  "create_workspace(p_name text, p_slug text)", // RPC, which the tenancy harness uses
  "provision_personal_workspace(p_name text, p_slug text)", // RPC, first-run provisioning
  "is_workspace_member(p_workspace_id uuid)", // read by RLS policies
  "is_workspace_owner(p_workspace_id uuid)", // read by RLS policies
  "uuid_or_null(p_value text)", // read by the storage.objects policies
  "storage_object_workspace_id(p_name text)", // read by the storage.objects policies
  // read by the public-profile-avatars policies on storage.objects
  "storage_object_profile_workspace_id(p_name text)",
  /*
    RPC, called by a server action as the signed-in creator. Each changes a
    public identifier and writes its redirect in one transaction, which is the
    reason they are functions rather than two statements: a rename split in
    two leaves a window where the old address is dead, and a failure in the
    second half leaves it dead for good.

    Both are security definer and both re-check is_workspace_member()
    themselves. That is not belt and braces — security definer means the
    function's own privileges apply once it is running, so without the check
    the grant below would let any signed-in user rename any handle.
    tests/db/public-pages-tenancy.test.ts holds that line from the outside.
  */
  "release_public_handle(p_public_profile_id uuid, p_new_handle text)",
  "release_public_product_slug(p_public_product_page_id uuid, p_new_slug text)",
])

/**
 * Functions that exist only to be fired by a trigger. No role needs execute.
 *
 * PostgREST does not list a function that returns `trigger` in its schema
 * cache, so a browser role asking for one by name gets "not found" (PGRST202)
 * before Postgres is asked anything. That is the refusal shape for these, and
 * the catalog test at the bottom is what proves the grant itself is gone.
 */
const TRIGGER_ONLY = [
  "set_updated_at",
  "enforce_asset_immutability",
  "enforce_listing_status_source",
  "enforce_snapshot_immutability",
  // The public handle and slug namespaces. Each spans a live table and its
  // history table, which no single unique index can express, so a trigger
  // checks it from both sides.
  "check_handle_available",
  "check_history_handle_available",
  "check_product_slug_available",
  "check_history_product_slug_available",
  // A profile draft's jsonb product list may only name its own workspace's products.
  "check_profile_draft_products",
] as const

/** PostgREST's answer for a function that is not in its schema cache. */
const NOT_EXPOSED = "PGRST202"

let alice: Actor
let bob: Actor

beforeAll(async () => {
  alice = await createActor("fp-alice")
  bob = await createActor("fp-bob")
})

afterAll(async () => {
  if (alice) await destroyActor(alice)
  if (bob) await destroyActor(bob)
})

describe("anon cannot execute anything", () => {
  it("is refused on create_workspace", async () => {
    const { error } = await anonClient().rpc("create_workspace", {
      p_name: "Nope",
      p_slug: "anon-nope",
    })
    expect(error?.code).toBe(RLS_DENIED)
  })

  it("is refused on provision_personal_workspace", async () => {
    const { error } = await anonClient().rpc("provision_personal_workspace", {
      p_name: "Nope",
      p_slug: "anon-provision-nope",
    })
    expect(error?.code).toBe(RLS_DENIED)
  })

  it("is refused on the membership helpers", async () => {
    const anon = anonClient()
    const member = await anon.rpc("is_workspace_member", { p_workspace_id: alice.workspaceId })
    const owner = await anon.rpc("is_workspace_owner", { p_workspace_id: alice.workspaceId })
    expect(member.error?.code).toBe(RLS_DENIED)
    expect(owner.error?.code).toBe(RLS_DENIED)
  })

  it("is refused on the storage helpers", async () => {
    const anon = anonClient()
    const cast = await anon.rpc("uuid_or_null", { p_value: alice.workspaceId })
    const owner = await anon.rpc("storage_object_workspace_id", {
      p_name: `${alice.workspaceId}/x/y.png`,
    })
    expect(cast.error?.code).toBe(RLS_DENIED)
    expect(owner.error?.code).toBe(RLS_DENIED)
  })

  it.each(TRIGGER_ONLY)("cannot reach %s by name", async (name) => {
    // The typed client does not know these as callable, which is the point.
    const { error } = await anonClient().rpc(name as "create_workspace", {} as never)
    expect(error?.code).toBe(NOT_EXPOSED)
  })
})

describe("a signed-in user can execute exactly what is granted", () => {
  it("create_workspace still works, and the caller becomes its owner", async () => {
    const slug = `fp-extra-${Date.now().toString(36)}`
    const { data, error } = await alice.client.rpc("create_workspace", {
      p_name: "Alice Second",
      p_slug: slug,
    })
    expect(error).toBeNull()
    expect(data?.slug).toBe(slug)

    const { data: owner } = await alice.client.rpc("is_workspace_owner", {
      p_workspace_id: data!.id,
    })
    expect(owner).toBe(true)

    await adminClient().from("workspaces").delete().eq("id", data!.id)
  })

  it("the membership helpers answer for the caller and nobody else", async () => {
    const mine = await alice.client.rpc("is_workspace_member", {
      p_workspace_id: alice.workspaceId,
    })
    const theirs = await alice.client.rpc("is_workspace_member", {
      p_workspace_id: bob.workspaceId,
    })
    expect(mine.data).toBe(true)
    expect(theirs.data).toBe(false)
  })

  it("membership-backed RLS still filters: alice sees her workspace and not bob's", async () => {
    const { data, error } = await alice.client.from("workspaces").select("id")
    expect(error).toBeNull()
    expect(data?.map((w) => w.id)).toEqual([alice.workspaceId])
  })

  it("the storage helpers are callable and total", async () => {
    const good = await alice.client.rpc("storage_object_workspace_id", {
      p_name: `${alice.workspaceId}/product/asset.png`,
    })
    const bad = await alice.client.rpc("storage_object_workspace_id", {
      p_name: "not-a-uuid/product/asset.png",
    })
    expect(good.error).toBeNull()
    expect(good.data).toBe(alice.workspaceId)
    expect(bad.error).toBeNull()
    expect(bad.data).toBeNull()
  })

  it.each(TRIGGER_ONLY)("cannot reach %s by name", async (name) => {
    const { error } = await alice.client.rpc(name as "create_workspace", {} as never)
    expect(error?.code).toBe(NOT_EXPOSED)
  })
})

describe("triggers still fire for a member with no grant on their function", () => {
  it("set_updated_at moves updated_at on a member's own update", async () => {
    const { data: product, error } = await alice.client
      .from("products")
      .insert({
        workspace_id: alice.workspaceId,
        name: "Trigger Grotesk",
        slug: "trigger-grotesk",
        product_type: "font",
      })
      .select("id, updated_at")
      .single()
    if (error) throw new Error(`could not create product: ${error.message}`)

    // Same second is possible; the trigger sets now(), which is the statement's
    // start time, so wait past the original stamp before updating.
    await new Promise((resolve) => setTimeout(resolve, 20))

    const { data: updated, error: updateError } = await alice.client
      .from("products")
      .update({ name: "Trigger Grotesk Two" })
      .eq("id", product.id)
      .select("updated_at")
      .single()
    expect(updateError).toBeNull()
    expect(new Date(updated!.updated_at).getTime()).toBeGreaterThan(
      new Date(product.updated_at).getTime(),
    )
  })

  it("enforce_snapshot_immutability still blocks the service role", async () => {
    const admin = adminClient()
    const { data: channel } = await admin
      .from("channels")
      .select("id")
      .eq("key", "mock_api")
      .single()
    const { data: product } = await alice.client
      .from("products")
      .insert({
        workspace_id: alice.workspaceId,
        name: "Snapshot Grotesk",
        slug: "snapshot-grotesk",
        product_type: "font",
      })
      .select("id")
      .single()
    const { data: connection } = await alice.client
      .from("channel_connections")
      .insert({
        workspace_id: alice.workspaceId,
        channel_id: channel!.id,
        external_account_id: "fp-alice-shop",
      })
      .select("id")
      .single()
    const { data: listing } = await alice.client
      .from("channel_listings")
      .insert({
        workspace_id: alice.workspaceId,
        product_id: product!.id,
        channel_id: channel!.id,
        channel_connection_id: connection!.id,
        title: "Snapshot Grotesk",
      })
      .select("id")
      .single()
    const { data: snapshot, error: snapshotError } = await alice.client
      .from("listing_snapshots")
      .insert({
        workspace_id: alice.workspaceId,
        channel_listing_id: listing!.id,
        product_id: product!.id,
        channel_id: channel!.id,
        snapshot_type: "build",
        payload: { listing: { title: "Snapshot Grotesk" } },
      })
      .select("id")
      .single()
    expect(snapshotError).toBeNull()

    const { error: updateError } = await admin
      .from("listing_snapshots")
      .update({ payload: { listing: { title: "Rewritten" } } })
      .eq("id", snapshot!.id)
    expect(updateError?.code).toBe("23514")

    const { error: deleteError } = await admin
      .from("listing_snapshots")
      .delete()
      .eq("id", snapshot!.id)
    expect(deleteError?.code).toBe("23514")
  })
})

/**
 * The catalog, read directly.
 *
 * PostgREST exposes `public` and nothing else, so pg_proc has to be read over
 * a database connection. The suite already requires the local stack, whose
 * database container is named by the project id in supabase/config.toml, and
 * `docker exec` into it is the same path `supabase db reset` takes. When the
 * container cannot be reached this fails rather than skips: an unreadable
 * catalog is not a passing one.
 */
function publicFunctionAcls(): Array<{ signature: string; acl: string[] }> {
  const configPath = join(__dirname, "..", "..", "supabase", "config.toml")
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync(configPath, "utf8"))?.[1]
  if (!projectId) throw new Error("supabase/config.toml has no project_id")

  const sql = `
    select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
           coalesce(array_to_string(p.proacl, ','), '')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
    order by 1
  `
  const out = execFileSync(
    "docker",
    [
      "exec",
      `supabase_db_${projectId}`,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-At",
      "-F",
      "\t",
      "-c",
      sql,
    ],
    { encoding: "utf8" },
  )
  return out
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [signature, acl] = line.split("\t") as [string, string]
      return { signature, acl: acl ? acl.split(",") : [] }
    })
}

/** True when an aclitem grants the role execute. An empty grantee is PUBLIC. */
function grantsExecute(acl: string[], role: string): boolean {
  return acl.some((item) => {
    const [grantee, rest] = item.split("=") as [string, string]
    return grantee === role && rest.split("/")[0]!.includes("X")
  })
}

describe("every function in public has an explicit, minimal execute grant", () => {
  const functions = publicFunctionAcls()

  it("finds the catalog", () => {
    expect(functions.length).toBeGreaterThan(0)
    // A proacl of null means the hard-wired default, which includes PUBLIC.
    // Every function here has been mentioned by a migration, so none is null.
    expect(functions.filter((f) => f.acl.length === 0).map((f) => f.signature)).toEqual([])
  })

  it("grants PUBLIC nothing", () => {
    expect(functions.filter((f) => grantsExecute(f.acl, "")).map((f) => f.signature)).toEqual([])
  })

  it("grants anon nothing", () => {
    expect(functions.filter((f) => grantsExecute(f.acl, "anon")).map((f) => f.signature)).toEqual(
      [],
    )
  })

  it("grants authenticated exactly the allowlist", () => {
    const granted = functions
      .filter((f) => grantsExecute(f.acl, "authenticated"))
      .map((f) => f.signature)
      .sort()
    expect(granted).toEqual([...AUTHENTICATED_MAY_EXECUTE].sort())
  })

  it("grants the service role every function, which is what the job runner and the credential service rely on", () => {
    expect(
      functions.filter((f) => !grantsExecute(f.acl, "service_role")).map((f) => f.signature),
    ).toEqual([])
  })
})
