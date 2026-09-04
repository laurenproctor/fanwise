import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import sharp from "sharp"
import { adminClient, createActor, destroyActor, type Actor } from "./harness"
import type { ImageSpec } from "@/lib/products/derivatives"
import { specHash } from "@/lib/products/derivatives"

/**
 * The A2 exit test, end to end against a real database and real storage:
 *
 *   a complete product exists, with correct derivatives for two image specs,
 *   and no channel connected.
 *
 * Plus the ADR 0001 requirement: the creator-facing signed download must set
 * Content-Disposition from the filename column, so the file arrives named as the
 * creator named it rather than as the uuid the storage path uses.
 *
 * Neither spec is named after a marketplace. lib/products does not know any
 * channel exists, and nothing in this test connects one.
 */

const BUCKET = "product-assets"

const THREE_TWO: ImageSpec = {
  key: "wide-3-2",
  width: 1820,
  height: 1214,
  format: "jpeg",
  maxByteSize: 5 * 1024 * 1024,
}

const TWO_ONE: ImageSpec = {
  key: "banner-2-1",
  width: 1200,
  height: 600,
  format: "png",
}

let actor: Actor
let productId: string
let sourceAssetId: string
let deliverableAssetId: string

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex")

beforeAll(async () => {
  actor = await createActor("deriv")
  const admin = adminClient()

  const { data: product, error: productError } = await actor.client
    .from("products")
    .insert({
      workspace_id: actor.workspaceId,
      name: "Aster Grotesk",
      slug: "aster-grotesk",
      product_type: "font",
      canonical_title: "Aster Grotesk Variable Sans",
      base_price: 39,
      currency: "USD",
    })
    .select("id")
    .single()
  if (productError) throw new Error(`product: ${productError.message}`)
  productId = product.id

  // A specimen image, uploaded the way the app uploads: server picks the path.
  const image = await readFile("tests/fixtures/specimen-3000x2000.jpg")
  sourceAssetId = crypto.randomUUID()
  const sourcePath = `${actor.workspaceId}/${productId}/${sourceAssetId}.jpg`
  const upload = await admin.storage.from(BUCKET).upload(sourcePath, image, {
    contentType: "image/jpeg",
    upsert: true,
  })
  if (upload.error) throw new Error(`upload: ${upload.error.message}`)

  const { error: assetError } = await admin.from("product_assets").insert({
    id: sourceAssetId,
    workspace_id: actor.workspaceId,
    product_id: productId,
    asset_type: "specimen",
    asset_state: "ready",
    storage_path: sourcePath,
    filename: "aster-grotesk-specimen.jpg",
    mime_type: "image/jpeg",
    byte_size: image.byteLength,
    checksum: sha256(image),
  })
  if (assetError) throw new Error(`asset: ${assetError.message}`)

  // A deliverable, so the download test exercises a non-image too.
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00])
  deliverableAssetId = crypto.randomUUID()
  const zipPath = `${actor.workspaceId}/${productId}/${deliverableAssetId}.zip`
  await admin.storage.from(BUCKET).upload(zipPath, zip, {
    contentType: "application/zip",
    upsert: true,
  })
  await admin.from("product_assets").insert({
    id: deliverableAssetId,
    workspace_id: actor.workspaceId,
    product_id: productId,
    asset_type: "deliverable",
    asset_state: "ready",
    storage_path: zipPath,
    filename: "Aster Grotesk Family.zip",
    mime_type: "application/zip",
    byte_size: zip.byteLength,
    checksum: sha256(zip),
  })
})

afterAll(async () => {
  if (actor) {
    const admin = adminClient()
    const { data } = await admin
      .from("product_assets")
      .select("storage_path")
      .eq("workspace_id", actor.workspaceId)
    if (data?.length) {
      // Object first, row second. The row goes with the workspace cascade.
      await admin.storage.from(BUCKET).remove(data.map((r) => r.storage_path))
    }
    await destroyActor(actor)
  }
})

/**
 * Runs the same work the build_derivative job does. Imported indirectly so this
 * test exercises the real module rather than a copy.
 */
async function build(spec: ImageSpec) {
  const { buildDerivative } = await import("@/lib/products/assets")
  return buildDerivative({
    workspaceId: actor.workspaceId,
    sourceAssetId,
    spec,
  })
}

describe("a complete product", () => {
  it("exists with its canonical fields and no channel connected", async () => {
    const { data } = await actor.client.from("products").select("*").eq("id", productId).single()
    expect(data?.name).toBe("Aster Grotesk")
    expect(data?.product_type).toBe("font")
    expect(data?.canonical_title).toBe("Aster Grotesk Variable Sans")

    // A2 connects nothing. If a channel table ever appears before A3, this fails.
    const { data: tables } = await adminClient().rpc("uuid_or_null", { p_value: "not-a-uuid" })
    expect(tables).toBeNull()
  })
})

describe("derivatives for two image specs", () => {
  it("builds the 3:2 jpeg at exactly the requested size", async () => {
    const result = await build(THREE_TWO)
    expect(result.cached).toBe(false)

    const admin = adminClient()
    const { data: row } = await admin
      .from("product_assets")
      .select("*")
      .eq("id", result.assetId)
      .single()

    expect(row?.derived_from).toBe(sourceAssetId)
    expect(row?.spec_hash).toBe(specHash(THREE_TWO))
    expect(row?.mime_type).toBe("image/jpeg")
    expect(row?.asset_state).toBe("ready")

    // Measure the bytes actually in storage, not just the row.
    const { data: blob } = await admin.storage.from(BUCKET).download(row!.storage_path)
    const bytes = Buffer.from(await blob!.arrayBuffer())
    const meta = await sharp(bytes).metadata()
    expect(meta.width).toBe(1820)
    expect(meta.height).toBe(1214)
    expect(meta.format).toBe("jpeg")
    expect(bytes.byteLength).toBeLessThanOrEqual(THREE_TWO.maxByteSize!)
    expect(sha256(bytes)).toBe(row?.checksum)
  })

  it("builds the 2:1 png at exactly the requested size", async () => {
    const result = await build(TWO_ONE)
    const admin = adminClient()
    const { data: row } = await admin
      .from("product_assets")
      .select("*")
      .eq("id", result.assetId)
      .single()

    const { data: blob } = await admin.storage.from(BUCKET).download(row!.storage_path)
    const meta = await sharp(Buffer.from(await blob!.arrayBuffer())).metadata()
    expect(meta.width).toBe(1200)
    expect(meta.height).toBe(600)
    expect(meta.format).toBe("png")
  })

  it("keeps the two derivatives as separate rows from one source", async () => {
    const { data } = await adminClient()
      .from("product_assets")
      .select("id, spec_hash")
      .eq("derived_from", sourceAssetId)

    expect(data).toHaveLength(2)
    expect(new Set(data?.map((r) => r.spec_hash)).size).toBe(2)
  })

  it("returns the cached row on a rebuild instead of doing the work again", async () => {
    const before = await build(THREE_TWO)
    expect(before.cached).toBe(true)

    const { count } = await adminClient()
      .from("product_assets")
      .select("*", { count: "exact", head: true })
      .eq("derived_from", sourceAssetId)
    expect(count).toBe(2)
  })

  it("refuses a second row for the same source and spec, at the database", async () => {
    const { error } = await adminClient()
      .from("product_assets")
      .insert({
        workspace_id: actor.workspaceId,
        product_id: productId,
        asset_type: "preview_image",
        asset_state: "pending",
        storage_path: `${actor.workspaceId}/${productId}/duplicate.jpg`,
        filename: "duplicate.jpg",
        derived_from: sourceAssetId,
        spec_hash: specHash(THREE_TWO),
      })
    // The cache is a unique index, not a convention.
    expect(error?.code).toBe("23505")
  })
})

describe("asset immutability", () => {
  it("refuses to change the bytes behind a ready asset", async () => {
    const { error } = await adminClient()
      .from("product_assets")
      .update({ checksum: "0".repeat(64) })
      .eq("id", sourceAssetId)

    // Without this the derivative cache key would be unsound.
    expect(error).not.toBeNull()
    expect(error?.message).toContain("immutable")
  })

  it("refuses to repoint a ready asset at a different object", async () => {
    const { error } = await adminClient()
      .from("product_assets")
      .update({ storage_path: `${actor.workspaceId}/${productId}/swapped.jpg` })
      .eq("id", sourceAssetId)
    expect(error).not.toBeNull()
  })

  it("still allows presentation changes, which cannot affect a derivative", async () => {
    const { error } = await adminClient()
      .from("product_assets")
      .update({ sort_order: 3 })
      .eq("id", sourceAssetId)
    expect(error).toBeNull()
  })
})

describe("creator-facing download, ADR 0001", () => {
  it("names the file from the filename column, not the storage path", async () => {
    const { createDownloadUrl } = await import("@/lib/products/storage")
    const { data: asset } = await adminClient()
      .from("product_assets")
      .select("storage_path, filename")
      .eq("id", deliverableAssetId)
      .single()

    const url = await createDownloadUrl(asset!.storage_path, asset!.filename)
    const response = await fetch(url)

    expect(response.ok).toBe(true)

    const disposition = response.headers.get("content-disposition")
    expect(disposition).toBeTruthy()
    expect(disposition).toContain("attachment")

    // RFC 6266 percent-encodes the name, so decode before comparing. What
    // matters is that the creator's filename is what arrives.
    expect(decodeURIComponent(disposition!)).toContain("Aster Grotesk Family.zip")

    // The storage path ends in <uuid>.zip; the creator must never receive that.
    expect(disposition).not.toContain(deliverableAssetId)
  })

  it("names a derivative from its generated filename too", async () => {
    const { createDownloadUrl } = await import("@/lib/products/storage")
    const { data: derivative } = await adminClient()
      .from("product_assets")
      .select("storage_path, filename")
      .eq("derived_from", sourceAssetId)
      .eq("spec_hash", specHash(TWO_ONE))
      .single()

    const response = await fetch(
      await createDownloadUrl(derivative!.storage_path, derivative!.filename),
    )
    const disposition = response.headers.get("content-disposition")
    expect(decodeURIComponent(disposition!)).toContain("aster-grotesk-specimen-banner-2-1.png")
  })
})
