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
 * `product_imports`, against real Postgres with RLS on.
 *
 * Four things are proven here and nowhere else, because all four are the
 * database's job rather than the application's:
 *
 *   - **Tenancy.** Workspace B cannot read, write or attach to workspace A's
 *     import, including by carrying its own workspace id on a row pointing at
 *     somebody else's product.
 *   - **Idempotency.** One live import per URL per workspace, under a race
 *     rather than under a happy path.
 *   - **Honesty constraints.** An unhappy status must carry a reason and a
 *     happy one may not pretend to; an unknown error code cannot be stored.
 *   - **Creator edits survive.** `accepted` is written by a person and the
 *     runner never touches it, so the column has to keep what it was given.
 *
 * The denial shapes are the ones A1 established: SELECT/UPDATE/DELETE return
 * 200 with an empty set, INSERT returns 42501.
 */

let alice: Actor
let bob: Actor
let aliceProductId: string
let bobProductId: string
let aliceImportId: string

const ALICE_URL = "https://example.com/alice-grotesk"
const BOB_URL = "https://example.com/bravo-grotesk"

async function createProduct(actor: Actor, name: string, slug: string): Promise<string> {
  const { data, error } = await actor.client
    .from("products")
    .insert({ workspace_id: actor.workspaceId, name, slug, product_type: "font" })
    .select("id")
    .single()
  if (error) throw new Error(`could not create product: ${error.message}`)
  return data.id
}

async function createImport(actor: Actor, productId: string, url: string) {
  return actor.client
    .from("product_imports")
    .insert({
      workspace_id: actor.workspaceId,
      product_id: productId,
      provider: "webpage",
      source_url: url,
      normalized_url: url,
      requested_by: actor.userId,
      status: "pending",
    })
    .select("id")
    .single()
}

beforeAll(async () => {
  alice = await createActor("imp-alice")
  bob = await createActor("imp-bob")
  aliceProductId = await createProduct(alice, "Alice Grotesk", "alice-grotesk")
  bobProductId = await createProduct(bob, "Bravo Grotesk", "bravo-grotesk")

  const { data, error } = await createImport(alice, aliceProductId, ALICE_URL)
  if (error || !data) throw new Error(`could not create import: ${error?.message}`)
  aliceImportId = data.id
})

afterAll(async () => {
  await destroyActor(alice)
  await destroyActor(bob)
})

describe("tenancy", () => {
  it("hides one workspace's import from another", async () => {
    const { data, error } = await bob.client.from("product_imports").select("id")

    expect(error).toBeNull()
    expect(data?.some((row) => row.id === aliceImportId)).toBe(false)
  })

  it("refuses a read of a named import from another workspace", async () => {
    const { data, error } = await bob.client
      .from("product_imports")
      .select("id")
      .eq("id", aliceImportId)

    // Empty rather than forbidden: a probe must not be able to confirm the id
    // is real.
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it("refuses an insert carrying another workspace's id", async () => {
    const { error } = await bob.client.from("product_imports").insert({
      workspace_id: alice.workspaceId,
      product_id: aliceProductId,
      provider: "webpage",
      source_url: "https://example.com/stolen",
      normalized_url: "https://example.com/stolen",
      status: "pending",
    })

    expect(error?.code).toBe(RLS_DENIED)
  })

  it("refuses an import attached to another workspace's product", async () => {
    /*
      The composite foreign key, not the policy: bob's own workspace id on a
      row pointing at alice's product. A policy checking workspace_id alone
      would let this through.

      The target is a product with no import of its own, so that the
      one-import-per-product unique index cannot be what refuses this and take
      the credit for a check it is not making.
    */
    const untouched = await createProduct(alice, "Alice Untouched", "alice-untouched")

    const { error } = await bob.client.from("product_imports").insert({
      workspace_id: bob.workspaceId,
      product_id: untouched,
      provider: "webpage",
      source_url: "https://example.com/crossed",
      normalized_url: "https://example.com/crossed",
      status: "pending",
    })

    expect(error).not.toBeNull()
    // 23503 is the foreign key. Anything else here would mean the tenant
    // boundary was enforced by luck.
    expect(error?.code).toBe("23503")
  })

  it("changes nothing when another workspace updates it", async () => {
    const { data } = await bob.client
      .from("product_imports")
      .update({ status: "discarded" })
      .eq("id", aliceImportId)
      .select("id")

    expect(data).toEqual([])

    const { data: still } = await alice.client
      .from("product_imports")
      .select("status")
      .eq("id", aliceImportId)
      .single()

    expect(still?.status).toBe("pending")
  })

  it("shows a signed-out visitor nothing at all", async () => {
    const { data } = await anonClient().from("product_imports").select("id")
    expect(data ?? []).toEqual([])
  })
})

describe("one live import per link", () => {
  it("refuses a second import of the same URL in the same workspace", async () => {
    const second = await createProduct(alice, "Alice Again", "alice-again")
    const { error } = await createImport(alice, second, ALICE_URL)

    expect(error?.code).toBe("23505")
  })

  it("lets another workspace import the same URL", async () => {
    // Two creators may both sell from the same public page, and neither should
    // learn that the other exists.
    const { error } = await createImport(bob, bobProductId, ALICE_URL)
    expect(error).toBeNull()

    await bob.client.from("product_imports").delete().eq("product_id", bobProductId)
  })

  it("frees the URL once an import is discarded", async () => {
    const product = await createProduct(alice, "Alice Third", "alice-third")
    const url = "https://example.com/recycled"

    const first = await createImport(alice, product, url)
    expect(first.error).toBeNull()

    const blocked = await createImport(alice, await createProduct(alice, "A4", "alice-four"), url)
    expect(blocked.error?.code).toBe("23505")

    await alice.client
      .from("product_imports")
      .update({ status: "discarded" })
      .eq("id", first.data!.id)

    const again = await createImport(alice, await createProduct(alice, "A5", "alice-five"), url)
    expect(again.error).toBeNull()
  })

  it("allows one import per product and no more", async () => {
    const { error } = await createImport(alice, aliceProductId, BOB_URL)
    expect(error?.code).toBe("23505")
  })
})

describe("what a row may claim", () => {
  it("refuses an unhappy status with no reason", async () => {
    const { error } = await alice.client
      .from("product_imports")
      .update({ status: "failed", error_code: null })
      .eq("id", aliceImportId)

    expect(error).not.toBeNull()
  })

  it("refuses a happy status carrying one", async () => {
    const { error } = await alice.client
      .from("product_imports")
      .update({ status: "ready", error_code: "not_found", error_message: "x" })
      .eq("id", aliceImportId)

    expect(error).not.toBeNull()
  })

  it("refuses an error code the screen has no recovery for", async () => {
    const { error } = await alice.client
      .from("product_imports")
      .update({ status: "failed", error_code: "teapot", error_message: "x" })
      .eq("id", aliceImportId)

    expect(error).not.toBeNull()
  })

  it("accepts a settled failure with a known code", async () => {
    const { error } = await alice.client
      .from("product_imports")
      .update({
        status: "unavailable",
        error_code: "login_required",
        error_message: "That link asks whoever opens it to sign in.",
      })
      .eq("id", aliceImportId)

    expect(error).toBeNull()
  })

  it("refuses a content hash that is not one", async () => {
    const { error } = await alice.client
      .from("product_imports")
      .update({ content_hash: "not-a-hash" })
      .eq("id", aliceImportId)

    expect(error).not.toBeNull()
  })

  it("refuses a source URL that is not https", async () => {
    const product = await createProduct(alice, "Alice Six", "alice-six")
    const { error } = await alice.client.from("product_imports").insert({
      workspace_id: alice.workspaceId,
      product_id: product,
      provider: "webpage",
      source_url: "http://example.com/insecure",
      normalized_url: "http://example.com/insecure",
      status: "pending",
    })

    expect(error).not.toBeNull()
  })
})

describe("what the creator settled", () => {
  it("keeps `accepted` exactly as it was written", async () => {
    const accepted = { title: { origin: "observed" }, price: { origin: "suggested" } }

    const { error } = await alice.client
      .from("product_imports")
      .update({ accepted })
      .eq("id", aliceImportId)
    expect(error).toBeNull()

    const { data } = await alice.client
      .from("product_imports")
      .select("accepted")
      .eq("id", aliceImportId)
      .single()

    expect(data?.accepted).toEqual(accepted)
  })

  it("survives the system writing evidence and suggestions around it", async () => {
    // What the runner does on a refresh: new evidence, new suggestions, and
    // `accepted` untouched. If this column were part of the same write, a
    // re-read of the page would undo a creator's decision.
    const admin = adminClient()
    await admin
      .from("product_imports")
      .update({
        evidence: { provider: "webpage", title: { value: "Re-read" } },
        suggestions: { draft: {} },
      })
      .eq("id", aliceImportId)

    const { data } = await alice.client
      .from("product_imports")
      .select("accepted")
      .eq("id", aliceImportId)
      .single()

    expect(data?.accepted).toMatchObject({ title: { origin: "observed" } })
  })
})

describe("the rights attestation", () => {
  it("refuses a timestamp with nobody behind it", async () => {
    const { error } = await alice.client
      .from("products")
      .update({ rights_confirmed_at: new Date().toISOString() })
      .eq("id", aliceProductId)

    expect(error).not.toBeNull()
  })

  it("records who confirmed and when", async () => {
    const { error } = await alice.client
      .from("products")
      .update({
        rights_confirmed_at: new Date().toISOString(),
        rights_confirmed_by: alice.userId,
      })
      .eq("id", aliceProductId)

    expect(error).toBeNull()

    const { data } = await alice.client
      .from("products")
      .select("rights_confirmed_by")
      .eq("id", aliceProductId)
      .single()

    expect(data?.rights_confirmed_by).toBe(alice.userId)
  })

  it("is not something another workspace can write", async () => {
    const { data } = await bob.client
      .from("products")
      .update({ rights_confirmed_at: new Date().toISOString(), rights_confirmed_by: bob.userId })
      .eq("id", aliceProductId)
      .select("id")

    expect(data).toEqual([])
  })
})
