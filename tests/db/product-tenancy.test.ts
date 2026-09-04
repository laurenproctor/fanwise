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
 * Tenancy for the A2 tables. The suite grows with the schema, per
 * docs/security.md, and the denial shapes are the ones established in A1:
 *
 *   SELECT, UPDATE, DELETE   200, empty array, no error. Assert row count.
 *   INSERT                   403, SQLSTATE 42501. Assert the error code.
 *
 * An empty-array assertion on an INSERT passes vacuously, because data is null
 * whenever there is an error.
 */

let alice: Actor
let bob: Actor
let aliceProductId: string
let bobProductId: string
let bobAssetId: string

async function createProduct(actor: Actor, name: string, slug: string) {
  const { data, error } = await actor.client
    .from("products")
    .insert({
      workspace_id: actor.workspaceId,
      name,
      slug,
      product_type: "font",
    })
    .select("id")
    .single()
  if (error) throw new Error(`could not create product: ${error.message}`)
  return data.id
}

beforeAll(async () => {
  alice = await createActor("p-alice")
  bob = await createActor("p-bob")
  aliceProductId = await createProduct(alice, "Alice Grotesk", "alice-grotesk")
  bobProductId = await createProduct(bob, "Bravo Grotesk", "bravo-grotesk")

  const { data, error } = await bob.client
    .from("product_assets")
    .insert({
      workspace_id: bob.workspaceId,
      product_id: bobProductId,
      asset_type: "deliverable",
      storage_path: `${bob.workspaceId}/${bobProductId}/asset.zip`,
      filename: "bravo.zip",
    })
    .select("id")
    .single()
  if (error) throw new Error(`could not create asset: ${error.message}`)
  bobAssetId = data.id
})

afterAll(async () => {
  if (alice) await destroyActor(alice)
  if (bob) await destroyActor(bob)
})

describe("positive controls", () => {
  it("alice sees her own product and only hers", async () => {
    const { data, error } = await alice.client.from("products").select("*")
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data?.[0]?.id).toBe(aliceProductId)
  })

  it("product slugs are unique per workspace, not globally", async () => {
    // Bob may take a slug alice already uses. Neither learns of the other.
    const id = await createProduct(bob, "Same Name", "alice-grotesk")
    expect(id).toBeTruthy()
    await bob.client.from("products").delete().eq("id", id)
  })

  it("the same slug twice in one workspace is rejected", async () => {
    const { error } = await alice.client.from("products").insert({
      workspace_id: alice.workspaceId,
      name: "Duplicate",
      slug: "alice-grotesk",
      product_type: "font",
    })
    expect(error?.code).toBe("23505")
  })
})

describe("products: alice cannot reach bob", () => {
  it("cannot select bob's product", async () => {
    const { data, error } = await alice.client.from("products").select("*").eq("id", bobProductId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it("cannot update bob's product, and the row is untouched", async () => {
    const { data, error } = await alice.client
      .from("products")
      .update({ name: "seized" })
      .eq("id", bobProductId)
      .select()

    expect(error).toBeNull()
    expect(data).toEqual([])

    const { data: actual } = await adminClient()
      .from("products")
      .select("name")
      .eq("id", bobProductId)
      .single()
    expect(actual?.name).toBe("Bravo Grotesk")
  })

  it("cannot delete bob's product, and the row survives", async () => {
    const { data, error } = await alice.client
      .from("products")
      .delete()
      .eq("id", bobProductId)
      .select()

    expect(error).toBeNull()
    expect(data).toEqual([])

    const { count } = await adminClient()
      .from("products")
      .select("*", { count: "exact", head: true })
      .eq("id", bobProductId)
    expect(count).toBe(1)
  })

  it("cannot insert a product into bob's workspace", async () => {
    const { data, error } = await alice.client
      .from("products")
      .insert({
        workspace_id: bob.workspaceId,
        name: "Trespass",
        slug: "trespass",
        product_type: "font",
      })
      .select()

    expect(data).toBeNull()
    expect(error?.code).toBe(RLS_DENIED)

    const { count } = await adminClient()
      .from("products")
      .select("*", { count: "exact", head: true })
      .eq("slug", "trespass")
    expect(count).toBe(0)
  })
})

describe("product_assets: alice cannot reach bob", () => {
  it("cannot select bob's asset", async () => {
    const { data, error } = await alice.client
      .from("product_assets")
      .select("*")
      .eq("id", bobAssetId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it("cannot update bob's asset, and the row is untouched", async () => {
    const { data, error } = await alice.client
      .from("product_assets")
      .update({ filename: "seized.zip" })
      .eq("id", bobAssetId)
      .select()

    expect(error).toBeNull()
    expect(data).toEqual([])

    const { data: actual } = await adminClient()
      .from("product_assets")
      .select("filename")
      .eq("id", bobAssetId)
      .single()
    expect(actual?.filename).toBe("bravo.zip")
  })

  it("cannot delete bob's asset, and the row survives", async () => {
    const { data, error } = await alice.client
      .from("product_assets")
      .delete()
      .eq("id", bobAssetId)
      .select()

    expect(error).toBeNull()
    expect(data).toEqual([])

    const { count } = await adminClient()
      .from("product_assets")
      .select("*", { count: "exact", head: true })
      .eq("id", bobAssetId)
    expect(count).toBe(1)
  })

  it("cannot attach an asset to bob's product", async () => {
    const { data, error } = await alice.client
      .from("product_assets")
      .insert({
        workspace_id: bob.workspaceId,
        product_id: bobProductId,
        asset_type: "deliverable",
        storage_path: `${bob.workspaceId}/${bobProductId}/trespass.zip`,
        filename: "trespass.zip",
      })
      .select()

    expect(data).toBeNull()
    expect(error?.code).toBe(RLS_DENIED)
  })

  it("cannot smuggle an asset in under its own workspace id but bob's product", async () => {
    // The RLS policy checks workspace_id, and alice is passing her own, so the
    // policy alone would allow this. The composite foreign key
    // (product_id, workspace_id) -> products (id, workspace_id) is what stops
    // it: an asset's workspace must be the workspace that owns its product.
    const { data, error } = await alice.client
      .from("product_assets")
      .insert({
        workspace_id: alice.workspaceId,
        product_id: bobProductId,
        asset_type: "deliverable",
        storage_path: `${alice.workspaceId}/${bobProductId}/smuggled.zip`,
        filename: "smuggled.zip",
      })
      .select()

    expect(data).toBeNull()
    // foreign_key_violation, not an RLS denial. Both are correct answers; this
    // one is the one that cannot be argued with.
    expect(error?.code).toBe("23503")

    const { count } = await adminClient()
      .from("product_assets")
      .select("*", { count: "exact", head: true })
      .eq("product_id", bobProductId)
    expect(count).toBe(1) // bob's own asset, and nothing of alice's
  })

  it("cannot derive an asset from a source in another workspace", async () => {
    const aliceProductAsset = await alice.client
      .from("product_assets")
      .insert({
        workspace_id: alice.workspaceId,
        product_id: aliceProductId,
        asset_type: "specimen",
        storage_path: `${alice.workspaceId}/${aliceProductId}/own.png`,
        filename: "own.png",
      })
      .select("id")
      .single()
    expect(aliceProductAsset.error).toBeNull()

    // Point a derivative at bob's asset while claiming alice's workspace.
    const { error } = await alice.client.from("product_assets").insert({
      workspace_id: alice.workspaceId,
      product_id: aliceProductId,
      asset_type: "preview_image",
      storage_path: `${alice.workspaceId}/${aliceProductId}/derived.png`,
      filename: "derived.png",
      derived_from: bobAssetId,
      spec_hash: "deadbeef",
    })
    expect(error?.code).toBe("23503")
  })
})

describe("anonymous callers", () => {
  it("cannot read products", async () => {
    const { data, error } = await anonClient().from("products").select("*")
    expect(data).toBeNull()
    expect(error?.code).toBe(RLS_DENIED)
  })

  it("cannot read product assets", async () => {
    const { data, error } = await anonClient().from("product_assets").select("*")
    expect(data).toBeNull()
    expect(error?.code).toBe(RLS_DENIED)
  })
})
