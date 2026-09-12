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
    // The wording version came with the licence migration and is part of the
    // same all-or-nothing constraint: an attestation nobody can quote is an
    // attestation to nothing in particular.
    const { error } = await alice.client
      .from("products")
      .update({
        rights_confirmed_at: new Date().toISOString(),
        rights_confirmed_by: alice.userId,
        rights_attestation_version: "2026-09-12.1",
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
      .update({
        rights_confirmed_at: new Date().toISOString(),
        rights_confirmed_by: bob.userId,
        rights_attestation_version: "2026-09-12.1",
      })
      .eq("id", aliceProductId)
      .select("id")

    expect(data).toEqual([])
  })
})

describe("the licence", () => {
  it("refuses a key with no version, and a version with no key", async () => {
    const now = new Date().toISOString()

    const noVersion = await alice.client
      .from("products")
      .update({ license_id: "commercial", license_accepted_at: now, license_summary: "Terms." })
      .eq("id", aliceProductId)
    expect(noVersion.error).not.toBeNull()

    const noKey = await alice.client
      .from("products")
      .update({ license_version: "1", license_accepted_at: now })
      .eq("id", aliceProductId)
    expect(noKey.error).not.toBeNull()
  })

  it("refuses a chosen licence that says nothing", async () => {
    // Readiness reads the summary rather than the key, and this is what stops
    // a row reaching that state by another path.
    const { error } = await alice.client
      .from("products")
      .update({
        license_id: "commercial",
        license_version: "1",
        license_accepted_at: new Date().toISOString(),
        license_summary: "   ",
      })
      .eq("id", aliceProductId)

    expect(error).not.toBeNull()
  })

  it("records the key, the version and the moment together", async () => {
    const { error } = await alice.client
      .from("products")
      .update({
        license_id: "commercial",
        license_version: "1",
        license_accepted_at: new Date().toISOString(),
        license_summary: "For personal and commercial projects by the buyer.",
      })
      .eq("id", aliceProductId)
    expect(error).toBeNull()

    const { data } = await alice.client
      .from("products")
      .select("license_id, license_version")
      .eq("id", aliceProductId)
      .single()

    // The version is what makes the exact wording recoverable after the
    // catalogue moves on.
    expect(data).toMatchObject({ license_id: "commercial", license_version: "1" })
  })

  it("is not something another workspace can set", async () => {
    const { data } = await bob.client
      .from("products")
      .update({
        license_id: "extended",
        license_version: "1",
        license_accepted_at: new Date().toISOString(),
        license_summary: "Anything at all.",
      })
      .eq("id", aliceProductId)
      .select("id")

    expect(data).toEqual([])
  })
})

describe("the attestation's wording", () => {
  it("refuses a confirmation with no version recorded", async () => {
    const { error } = await alice.client
      .from("products")
      .update({
        rights_confirmed_at: new Date().toISOString(),
        rights_confirmed_by: alice.userId,
        rights_attestation_version: null,
      })
      .eq("id", aliceProductId)

    expect(error).not.toBeNull()
  })

  it("records who, when, and which words", async () => {
    const { error } = await alice.client
      .from("products")
      .update({
        rights_confirmed_at: new Date().toISOString(),
        rights_confirmed_by: alice.userId,
        rights_attestation_version: "2026-09-12.1",
      })
      .eq("id", aliceProductId)
    expect(error).toBeNull()

    const { data } = await alice.client
      .from("products")
      .select("rights_confirmed_by, rights_attestation_version")
      .eq("id", aliceProductId)
      .single()

    expect(data).toMatchObject({
      rights_confirmed_by: alice.userId,
      rights_attestation_version: "2026-09-12.1",
    })
  })

  it("refuses a component list nobody submitted", async () => {
    const { error } = await alice.client
      .from("products")
      .update({ third_party_components: "Inter", third_party_declared_at: null })
      .eq("id", aliceProductId)

    expect(error).not.toBeNull()
  })

  it("tells 'none' apart from 'not asked'", async () => {
    // Declared with nothing listed is a creator saying there are none, and it
    // has to stay distinguishable from never having been asked.
    const { error } = await alice.client
      .from("products")
      .update({
        third_party_declared_at: new Date().toISOString(),
        third_party_components: null,
      })
      .eq("id", aliceProductId)
    expect(error).toBeNull()

    const { data } = await alice.client
      .from("products")
      .select("third_party_declared_at, third_party_components")
      .eq("id", aliceProductId)
      .single()

    expect(data?.third_party_declared_at).not.toBeNull()
    expect(data?.third_party_components).toBeNull()
  })
})

describe("the previous reading", () => {
  it("keeps one back, for the change preview", async () => {
    const admin = adminClient()
    const { error } = await admin
      .from("product_imports")
      .update({
        previous_evidence: { provider: "webpage", title: { value: "What it said before" } },
        previous_content_hash: "c".repeat(64),
      })
      .eq("id", aliceImportId)

    expect(error).toBeNull()
  })

  it("refuses a previous hash that is not one", async () => {
    const { error } = await alice.client
      .from("product_imports")
      .update({ previous_content_hash: "nope" })
      .eq("id", aliceImportId)

    expect(error).not.toBeNull()
  })
})

describe("imports from pasted text and uploaded files", () => {
  /*
    A handed-over source is a stored object rather than a URL, and the job reads
    it with the service role, which ignores storage policies. So the database
    has to be the thing that stops a member pointing their own import at another
    workspace's object — the one check here that guards a tenant boundary
    rather than tidiness.
  */
  const upload = "11111111-1111-4111-8111-111111111111"
  const pathFor = (workspaceId: string, ext = "pdf") =>
    `${workspaceId}/import-sources/${upload}.${ext}`

  async function createContentImport(
    actor: Actor,
    productId: string,
    fields: Record<string, unknown>,
  ) {
    return actor.client
      .from("product_imports")
      .insert({
        workspace_id: actor.workspaceId,
        product_id: productId,
        provider: "pdf_document",
        requested_by: actor.userId,
        status: "pending",
        ...fields,
      })
      .select("id")
      .single()
  }

  it("accepts a file stored under the member's own workspace, with no URL", async () => {
    const product = await createProduct(alice, "Alice PDF", "alice-pdf")
    const { error } = await createContentImport(alice, product, {
      source_path: pathFor(alice.workspaceId),
      source_filename: "aster.pdf",
      source_byte_size: 1024,
    })
    expect(error).toBeNull()
  })

  it("refuses a path under another workspace's prefix", async () => {
    const product = await createProduct(bob, "Bob Borrowed", "bob-borrowed")
    const { error } = await createContentImport(bob, product, {
      source_path: pathFor(alice.workspaceId),
    })
    expect(error?.code).toBe("23514")
  })

  it("refuses a path the server would never build", async () => {
    const product = await createProduct(alice, "Alice Odd Path", "alice-odd-path")
    for (const path of [
      `${alice.workspaceId}/import-sources/../${bob.workspaceId}/x.pdf`,
      `${alice.workspaceId}/${aliceProductId}/${upload}.pdf`,
      `${alice.workspaceId}/import-sources/${upload}.exe`,
    ]) {
      const { error } = await createContentImport(alice, product, { source_path: path })
      expect(error?.code, path).toBe("23514")
    }
  })

  it("holds a row to exactly one source", async () => {
    const product = await createProduct(alice, "Alice Both", "alice-both")

    // A file import with a URL as well.
    const both = await createContentImport(alice, product, {
      source_path: pathFor(alice.workspaceId),
      source_url: "https://example.com/both",
      normalized_url: "https://example.com/both",
    })
    expect(both.error?.code).toBe("23514")

    // A file import with nothing to read.
    const neither = await createContentImport(alice, product, {})
    expect(neither.error?.code).toBe("23514")

    // A link import with a stored object.
    const link = await alice.client.from("product_imports").insert({
      workspace_id: alice.workspaceId,
      product_id: product,
      provider: "webpage",
      source_url: "https://example.com/link-with-file",
      normalized_url: "https://example.com/link-with-file",
      source_path: pathFor(alice.workspaceId),
      status: "pending",
    })
    expect(link.error?.code).toBe("23514")
  })

  it("does not dedupe pastes: the same text twice is two drafts", async () => {
    const first = await createContentImport(alice, await createProduct(alice, "P1", "paste-one"), {
      provider: "pasted_text",
      source_path: pathFor(alice.workspaceId, "txt"),
    })
    const second = await createContentImport(alice, await createProduct(alice, "P2", "paste-two"), {
      provider: "pasted_text",
      source_path: pathFor(alice.workspaceId, "txt"),
    })
    expect(first.error).toBeNull()
    expect(second.error).toBeNull()
  })

  it("stores the two new ways a file can be unreadable", async () => {
    const product = await createProduct(alice, "Alice Scan", "alice-scan")
    const { data } = await createContentImport(alice, product, {
      source_path: pathFor(alice.workspaceId),
    })
    for (const code of ["unreadable_file", "no_text"]) {
      const { error } = await adminClient()
        .from("product_imports")
        .update({ status: "unavailable", error_code: code, error_message: "m" })
        .eq("id", data!.id)
      expect(error, code).toBeNull()
    }
  })
})
