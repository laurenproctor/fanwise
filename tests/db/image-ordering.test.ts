import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { adminClient, createActor, destroyActor, type Actor } from "./harness"

/**
 * The A5 narrowing of the asset immutability trigger.
 *
 * A2 froze `asset_type` alongside the content columns. The trigger's stated
 * reason — the derivative cache key omits the source checksum, so the bytes
 * behind derived_from must never change — does not cover `asset_type`, which is
 * in neither the key nor the bytes. So one transition is now permitted, in both
 * directions, and every other change a ready asset could suffer is still
 * refused. These tests pin both halves, because a narrowing that quietly became
 * a removal would take the derivative cache's soundness with it.
 */

let alice: Actor
let productId: string

const CONTENT_COLUMN_VIOLATION = "23514"

async function makeAsset(assetType: string, state: "ready" | "pending" = "ready") {
  const admin = adminClient()
  const { data, error } = await admin
    .from("product_assets")
    .insert({
      workspace_id: alice.workspaceId,
      product_id: productId,
      asset_type: assetType as "cover_image",
      asset_state: state,
      storage_path: `${alice.workspaceId}/${productId}/${crypto.randomUUID()}.png`,
      filename: "image.png",
      mime_type: "image/png",
      byte_size: 1024,
      checksum: "a".repeat(64),
    })
    .select("id")
    .single()
  if (error) throw new Error(`could not create asset: ${error.message}`)
  return data.id
}

beforeAll(async () => {
  alice = await createActor("img-order")
  const { data, error } = await alice.client
    .from("products")
    .insert({
      workspace_id: alice.workspaceId,
      name: "Ordered Font",
      slug: "ordered-font",
      product_type: "font",
    })
    .select("id")
    .single()
  if (error) throw new Error(`could not create product: ${error.message}`)
  productId = data.id
})

afterAll(async () => {
  await destroyActor(alice)
})

describe("an image may change which presentation role it holds", () => {
  it("promotes a ready preview image to cover", async () => {
    const id = await makeAsset("preview_image")
    const { error } = await adminClient()
      .from("product_assets")
      .update({ asset_type: "cover_image" })
      .eq("id", id)
    expect(error).toBeNull()

    const { data } = await adminClient()
      .from("product_assets")
      .select("asset_type")
      .eq("id", id)
      .single()
    expect(data?.asset_type).toBe("cover_image")
  })

  it("demotes a ready cover image back to preview", async () => {
    const id = await makeAsset("cover_image")
    const { error } = await adminClient()
      .from("product_assets")
      .update({ asset_type: "preview_image" })
      .eq("id", id)
    expect(error).toBeNull()
  })

  it("still allows sort_order to move, which is what ordering writes", async () => {
    const id = await makeAsset("preview_image")
    const { error } = await adminClient()
      .from("product_assets")
      .update({ sort_order: 4 })
      .eq("id", id)
    expect(error).toBeNull()
  })
})

describe("everything else about a ready asset is still frozen", () => {
  it("refuses a deliverable becoming a cover image", async () => {
    // The failure this forbids is the buyer's zip published as a public product
    // picture. Permitting the general case to buy one drag interaction would be
    // a bad trade, so the migration allows exactly one pair.
    const id = await makeAsset("deliverable")
    const { error } = await adminClient()
      .from("product_assets")
      .update({ asset_type: "cover_image" })
      .eq("id", id)
    expect(error?.code).toBe(CONTENT_COLUMN_VIOLATION)

    const { data } = await adminClient()
      .from("product_assets")
      .select("asset_type")
      .eq("id", id)
      .single()
    expect(data?.asset_type).toBe("deliverable")
  })

  it("refuses a cover image becoming a deliverable", async () => {
    const id = await makeAsset("cover_image")
    const { error } = await adminClient()
      .from("product_assets")
      .update({ asset_type: "deliverable" })
      .eq("id", id)
    expect(error?.code).toBe(CONTENT_COLUMN_VIOLATION)
  })

  it("still refuses a change of storage path", async () => {
    const id = await makeAsset("cover_image")
    const { error } = await adminClient()
      .from("product_assets")
      .update({ storage_path: "somewhere/else.png" })
      .eq("id", id)
    expect(error?.code).toBe(CONTENT_COLUMN_VIOLATION)
  })

  it("still refuses a change of checksum, which is what keeps the cache key sound", async () => {
    const id = await makeAsset("cover_image")
    const { error } = await adminClient()
      .from("product_assets")
      .update({ checksum: "b".repeat(64) })
      .eq("id", id)
    expect(error?.code).toBe(CONTENT_COLUMN_VIOLATION)
  })

  it("still refuses moving an asset to another product", async () => {
    const id = await makeAsset("cover_image")
    const { error } = await adminClient()
      .from("product_assets")
      .update({ product_id: crypto.randomUUID() })
      .eq("id", id)
    expect(error).not.toBeNull()
  })
})

describe("a pending asset is still free to change", () => {
  it("may become any type, because nothing has depended on it yet", async () => {
    const id = await makeAsset("preview_image", "pending")
    const { error } = await adminClient()
      .from("product_assets")
      .update({ asset_type: "deliverable" })
      .eq("id", id)
    expect(error).toBeNull()
  })
})
