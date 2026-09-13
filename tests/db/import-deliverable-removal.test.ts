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
 * `remove_import_deliverable`, against real Postgres with RLS on.
 *
 * The rule is that a product never loses its last ready buyer file on the
 * import screen: the replacement has to be ready before the original can go.
 * The application used to check that and then delete in two requests, and two
 * removals arriving together could both pass. What is proven here is that the
 * database makes the pair atomic — under concurrency, not only one call at a
 * time — and that it does so as the signed-in creator, under their own RLS.
 *
 * Rows are written with the service role because a ready asset is a row the
 * finalize job writes, not the browser; the removals are called as the actor.
 */

let alice: Actor
let bob: Actor
let productId: string
let counter = 0

async function createProduct(actor: Actor): Promise<string> {
  counter += 1
  const { data, error } = await actor.client
    .from("products")
    .insert({
      workspace_id: actor.workspaceId,
      name: `Removal ${counter}`,
      slug: `removal-${Date.now().toString(36)}-${counter}`,
      product_type: "font",
    })
    .select("id")
    .single()
  if (error) throw new Error(`could not create product: ${error.message}`)
  return data.id
}

type AssetType = "deliverable" | "archive" | "source_file" | "cover_image"
type AssetState = "ready" | "pending" | "failed"

/** A buyer file in the state the finalize job would have left it. */
async function file(
  actor: Actor,
  product: string,
  state: AssetState = "ready",
  type: AssetType = "deliverable",
  derivedFrom?: string,
): Promise<{ id: string; storagePath: string }> {
  counter += 1
  const storagePath = `${actor.workspaceId}/${product}/file-${counter}.zip`
  const measured =
    state === "ready"
      ? { mime_type: "application/zip", byte_size: 2048, checksum: `sha256:file-${counter}` }
      : {}
  const { data, error } = await adminClient()
    .from("product_assets")
    .insert({
      workspace_id: actor.workspaceId,
      product_id: product,
      asset_type: type,
      asset_state: state,
      storage_path: storagePath,
      filename: `file-${counter}.zip`,
      sort_order: counter,
      ...measured,
      ...(derivedFrom ? { derived_from: derivedFrom, spec_hash: `spec-${counter}` } : {}),
    })
    .select("id")
    .single()
  if (error) throw new Error(`could not insert asset: ${error.message}`)
  return { id: data.id, storagePath }
}

async function remaining(product: string): Promise<Array<{ id: string; asset_state: string }>> {
  const { data, error } = await adminClient()
    .from("product_assets")
    .select("id, asset_state")
    .eq("product_id", product)
  if (error) throw new Error(error.message)
  return data
}

function remove(actor: Actor, product: string, assetId: string) {
  return actor.client.rpc("remove_import_deliverable", {
    p_product_id: product,
    p_asset_id: assetId,
  })
}

beforeAll(async () => {
  alice = await createActor("rm-alice")
  bob = await createActor("rm-bob")
  productId = await createProduct(alice)
})

afterAll(async () => {
  await destroyActor(alice)
  await destroyActor(bob)
})

describe("removing a buyer file", () => {
  it("refuses the only ready file, and it stays", async () => {
    const product = await createProduct(alice)
    const only = await file(alice, product)

    const { data, error } = await remove(alice, product, only.id)

    expect(data).toBeNull()
    expect(error?.code).toBe("P0001")
    expect(error?.message).toBe("only_ready_deliverable")
    expect(await remaining(product)).toEqual([{ id: only.id, asset_state: "ready" }])
  })

  it("still refuses while the only other file is pending or failed", async () => {
    const product = await createProduct(alice)
    const original = await file(alice, product)
    await file(alice, product, "pending")
    await file(alice, product, "failed")

    const { error } = await remove(alice, product, original.id)

    expect(error?.message).toBe("only_ready_deliverable")
    expect((await remaining(product)).map((row) => row.id)).toContain(original.id)
  })

  it("removes the original once another ready file exists, and returns its storage path", async () => {
    const product = await createProduct(alice)
    const original = await file(alice, product)
    const replacement = await file(alice, product)

    const { data, error } = await remove(alice, product, original.id)

    expect(error).toBeNull()
    expect(data).toEqual([original.storagePath])
    expect(await remaining(product)).toEqual([{ id: replacement.id, asset_state: "ready" }])
  })

  it("counts any buyer-file type as the other ready file", async () => {
    const product = await createProduct(alice)
    const original = await file(alice, product)
    await file(alice, product, "ready", "archive")

    const { error } = await remove(alice, product, original.id)

    expect(error).toBeNull()
  })

  it("lets a file that never became ready go, because nobody would receive it", async () => {
    const product = await createProduct(alice)
    await file(alice, product)
    const broken = await file(alice, product, "failed")

    const { error } = await remove(alice, product, broken.id)

    expect(error).toBeNull()
    expect((await remaining(product)).map((row) => row.id)).not.toContain(broken.id)
  })

  it("returns the paths of the file's derivatives too, and removes them with it", async () => {
    const product = await createProduct(alice)
    const original = await file(alice, product)
    await file(alice, product)
    const derivative = await file(alice, product, "ready", "deliverable", original.id)

    const { data, error } = await remove(alice, product, original.id)

    expect(error).toBeNull()
    expect([...(data ?? [])].sort()).toEqual([original.storagePath, derivative.storagePath].sort())
    const ids = (await remaining(product)).map((row) => row.id)
    expect(ids).not.toContain(original.id)
    expect(ids).not.toContain(derivative.id)
  })

  it("does not treat an image as a buyer file", async () => {
    const product = await createProduct(alice)
    await file(alice, product)
    await file(alice, product)
    const cover = await file(alice, product, "ready", "cover_image")

    const { error } = await remove(alice, product, cover.id)

    expect(error?.message).toBe("deliverable_not_found")
    expect((await remaining(product)).map((row) => row.id)).toContain(cover.id)
  })

  it("does not remove a file through a product it does not belong to", async () => {
    const other = await createProduct(alice)
    await file(alice, other)
    const elsewhere = await file(alice, productId)
    await file(alice, productId)

    const { error } = await remove(alice, other, elsewhere.id)

    expect(error?.message).toBe("deliverable_not_found")
    expect((await remaining(productId)).map((row) => row.id)).toContain(elsewhere.id)
  })
})

describe("two removals at once", () => {
  it("never leaves a product without a ready buyer file", async () => {
    /*
      The race this function exists for. Two ready files, and a removal of each
      sent at the same moment, over separate requests and so separate
      transactions. Whatever order they land in, exactly one may win: the other
      waits on the product lock and then reads one file left. Repeated, because
      a race that is lost once can be won by luck the next time.
    */
    for (let round = 0; round < 10; round += 1) {
      const product = await createProduct(alice)
      const a = await file(alice, product)
      const b = await file(alice, product)

      const [first, second] = await Promise.all([
        remove(alice, product, a.id),
        remove(alice, product, b.id),
      ])
      const outcomes = [first, second]

      const ready = (await remaining(product)).filter((row) => row.asset_state === "ready")
      expect(ready, `round ${round}: ready files left`).toHaveLength(1)
      expect(
        outcomes.filter((outcome) => outcome.error === null),
        `round ${round}: removals that succeeded`,
      ).toHaveLength(1)
      expect(
        outcomes.map((outcome) => outcome.error?.message).filter(Boolean),
        `round ${round}: the loser is refused as the last file`,
      ).toEqual(["only_ready_deliverable"])
    }
  })
})

describe("who may remove", () => {
  it("hides another workspace's product entirely: not found, and nothing removed", async () => {
    const product = await createProduct(alice)
    const one = await file(alice, product)
    const two = await file(alice, product)

    const { error } = await remove(bob, product, one.id)

    expect(error?.code).toBe("P0002")
    expect(error?.message).toBe("deliverable_not_found")
    expect((await remaining(product)).map((row) => row.id).sort()).toEqual([one.id, two.id].sort())
  })

  it("refuses a visitor with no session before the function runs", async () => {
    const product = await createProduct(alice)
    const one = await file(alice, product)
    await file(alice, product)

    const { error } = await anonClient().rpc("remove_import_deliverable", {
      p_product_id: product,
      p_asset_id: one.id,
    })

    expect(error?.code).toBe(RLS_DENIED)
    expect((await remaining(product)).map((row) => row.id)).toContain(one.id)
  })
})
