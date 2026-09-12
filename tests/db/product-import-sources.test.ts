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
 * `product_import_sources` and `create_import_session`, against real Postgres
 * with RLS on.
 *
 * What only the database can prove:
 *
 *   - **Tenancy.** Workspace B cannot read, add, change or attach a source to
 *     workspace A's import, and a stored path must sit under the row's own
 *     workspace, because the job reads it with the service role.
 *   - **Atomicity.** The session, its product and its sources exist together or
 *     not at all, and the same submission twice is one session.
 *   - **Shape.** A source carries exactly what its type needs; a staged source
 *     belongs to no import only while it is on its way in.
 */

let alice: Actor
let bob: Actor

type SessionArgs = {
  p_workspace_id: string
  p_submission_id: string
  p_product_name: string
  p_product_slug: string
  p_product_metadata: { kind: string }
  p_provider: "webpage" | "composed"
  p_source_url: string | null
  p_normalized_url: string | null
  p_url_display_name: string | null
  p_pasted_text: string | null
  p_staged_source_ids: string[]
}

function sessionArgs(actor: Actor, overrides: Partial<SessionArgs> = {}): SessionArgs {
  return {
    p_workspace_id: actor.workspaceId,
    p_submission_id: crypto.randomUUID(),
    p_product_name: "Canvas Tote",
    p_product_slug: `canvas-tote-${Math.random().toString(36).slice(2, 8)}`,
    p_product_metadata: { kind: "generic" },
    p_provider: "composed",
    p_source_url: null,
    p_normalized_url: null,
    p_url_display_name: null,
    p_pasted_text: "A canvas tote, printed by hand.",
    p_staged_source_ids: [],
    ...overrides,
  }
}

async function createSession(actor: Actor, overrides: Partial<SessionArgs> = {}) {
  // The generated types mark every parameter non-null; four are null by design.
  return actor.client
    .rpc("create_import_session", sessionArgs(actor, overrides) as never)
    .single<{ import_id: string; product_slug: string; existing: boolean }>()
}

const pathFor = (workspaceId: string, id: string, ext = "pdf") =>
  `${workspaceId}/import-sources/${id}.${ext}`

async function stage(actor: Actor, fields: Record<string, unknown> = {}) {
  const id = crypto.randomUUID()
  const { error } = await actor.client.from("product_import_sources").insert({
    id,
    workspace_id: actor.workspaceId,
    source_type: "pdf",
    status: "staged",
    display_name: "brand-guidelines.pdf",
    storage_path: pathFor(actor.workspaceId, id),
    ...fields,
  })
  return { id, error }
}

beforeAll(async () => {
  alice = await createActor("src-alice")
  bob = await createActor("src-bob")
})

afterAll(async () => {
  await destroyActor(alice)
  await destroyActor(bob)
})

describe("creating a session", () => {
  it("makes the product, the session and every source in one call", async () => {
    const staged = await stage(alice)
    expect(staged.error).toBeNull()

    const { data, error } = await createSession(alice, {
      p_provider: "webpage",
      p_source_url: "https://example.com/tote",
      p_normalized_url: "https://example.com/tote",
      p_url_display_name: "example.com/tote",
      p_staged_source_ids: [staged.id],
    })
    expect(error).toBeNull()
    expect(data?.existing).toBe(false)

    const { data: sources } = await alice.client
      .from("product_import_sources")
      .select("source_type, status, position, import_id")
      .eq("import_id", data!.import_id)
      .order("position")

    expect(sources).toEqual([
      { source_type: "public_url", status: "pending", position: 0, import_id: data!.import_id },
      { source_type: "pasted_text", status: "pending", position: 1, import_id: data!.import_id },
      { source_type: "pdf", status: "pending", position: 2, import_id: data!.import_id },
    ])
  })

  it("returns the same session for the same submission, and makes no second product", async () => {
    const submission = crypto.randomUUID()
    const first = await createSession(alice, { p_submission_id: submission })
    const second = await createSession(alice, {
      p_submission_id: submission,
      p_product_slug: "a-different-slug-entirely",
    })
    expect(first.error).toBeNull()
    expect(second.data).toEqual({ ...first.data, existing: true })

    const { count } = await alice.client
      .from("product_imports")
      .select("id", { count: "exact", head: true })
      .eq("submission_id", submission)
    expect(count).toBe(1)
  })

  it("rolls back entirely when a staged source is not available", async () => {
    const slug = `rolled-back-${Math.random().toString(36).slice(2, 8)}`
    const { error } = await createSession(alice, {
      p_product_slug: slug,
      p_staged_source_ids: [crypto.randomUUID()],
    })
    expect(error?.code).toBe("P0002")

    const { data } = await alice.client.from("products").select("id").eq("slug", slug)
    expect(data).toEqual([])
  })

  it("rolls back entirely on a link that is already being imported", async () => {
    const url = "https://example.com/already"
    const first = await createSession(alice, {
      p_provider: "webpage",
      p_source_url: url,
      p_normalized_url: url,
    })
    expect(first.error).toBeNull()

    const staged = await stage(alice)
    const slug = `dupe-${Math.random().toString(36).slice(2, 8)}`
    const second = await createSession(alice, {
      p_provider: "webpage",
      p_source_url: url,
      p_normalized_url: url,
      p_product_slug: slug,
      p_staged_source_ids: [staged.id],
    })
    expect(second.error?.code).toBe("23505")

    const { data: products } = await alice.client.from("products").select("id").eq("slug", slug)
    expect(products).toEqual([])
    // The staged file was not attached to anything and is still the creator's.
    const { data: still } = await alice.client
      .from("product_import_sources")
      .select("status, import_id")
      .eq("id", staged.id)
      .single()
    expect(still).toEqual({ status: "staged", import_id: null })
  })

  it("refuses to attach another workspace's staged source", async () => {
    const bobs = await stage(bob)
    expect(bobs.error).toBeNull()
    const { error } = await createSession(alice, { p_staged_source_ids: [bobs.id] })
    expect(error?.code).toBe("P0002")
  })

  it("refuses a caller who is not a member of the workspace", async () => {
    const { error } = await createSession(bob, { p_workspace_id: alice.workspaceId })
    expect(error).not.toBeNull()
  })

  it("refuses a signed-out caller outright", async () => {
    const { error } = await anonClient().rpc("create_import_session", sessionArgs(alice) as never)
    expect(error).not.toBeNull()
  })
})

describe("tenancy", () => {
  it("hides one workspace's sources from another", async () => {
    const staged = await stage(alice)
    const { data } = await bob.client
      .from("product_import_sources")
      .select("id")
      .eq("id", staged.id)
    expect(data).toEqual([])
  })

  it("refuses an insert carrying another workspace's id", async () => {
    const id = crypto.randomUUID()
    const { error } = await bob.client.from("product_import_sources").insert({
      id,
      workspace_id: alice.workspaceId,
      source_type: "pdf",
      status: "staged",
      display_name: "stolen.pdf",
      storage_path: pathFor(alice.workspaceId, id),
    })
    expect(error?.code).toBe(RLS_DENIED)
  })

  it("refuses a source attached to another workspace's import", async () => {
    const { data: session } = await createSession(alice)
    const { error } = await bob.client.from("product_import_sources").insert({
      workspace_id: bob.workspaceId,
      import_id: session!.import_id,
      source_type: "pasted_text",
      status: "pending",
      // A free position, so the position index cannot be what refuses this.
      position: 9,
      display_name: "Pasted text",
      text_content: "crossed",
    })
    // The composite foreign key, not the policy.
    expect(error?.code).toBe("23503")
  })

  it("refuses a stored path under another workspace's prefix", async () => {
    const id = crypto.randomUUID()
    const { error } = await bob.client.from("product_import_sources").insert({
      id,
      workspace_id: bob.workspaceId,
      source_type: "pdf",
      status: "staged",
      display_name: "borrowed.pdf",
      storage_path: pathFor(alice.workspaceId, id),
    })
    expect(error?.code).toBe("23514")
  })

  it("changes nothing when another workspace updates a source", async () => {
    const staged = await stage(alice)
    const { data } = await bob.client
      .from("product_import_sources")
      .update({ status: "removed" })
      .eq("id", staged.id)
      .select("id")
    expect(data).toEqual([])
  })

  it("grants no delete: removal is a status", async () => {
    const staged = await stage(alice)
    await alice.client.from("product_import_sources").delete().eq("id", staged.id)
    const { data } = await adminClient()
      .from("product_import_sources")
      .select("id")
      .eq("id", staged.id)
    expect(data).toHaveLength(1)
  })
})

describe("shape", () => {
  it("allows a source outside an import only while it is on its way in", async () => {
    const { error } = await stage(alice, { status: "pending" })
    expect(error?.code).toBe("23514")
  })

  it("holds each type to exactly what it needs", async () => {
    for (const [fields, why] of [
      [{ source_type: "audio" }, "audio with a .pdf path"],
      [{ source_type: "html" }, "html with a .pdf path"],
      [
        { source_url: "https://example.com/x", normalized_url: "https://example.com/x" },
        "a file with a URL",
      ],
      [{ storage_path: null }, "a file with no stored object"],
    ] as const) {
      const { error } = await stage(alice, fields)
      expect(error?.code, why).toBe("23514")
    }
  })

  it("accepts a recording stored as audio", async () => {
    const id = crypto.randomUUID()
    const { error } = await alice.client.from("product_import_sources").insert({
      id,
      workspace_id: alice.workspaceId,
      source_type: "audio",
      status: "transcribing",
      display_name: "Product notes · 01:24",
      storage_path: pathFor(alice.workspaceId, id, "webm"),
      duration_ms: 84_000,
    })
    expect(error).toBeNull()
  })

  it("keeps one link per live import", async () => {
    const url = "https://example.com/one-link"
    const { data: session } = await createSession(alice, {
      p_provider: "webpage",
      p_source_url: url,
      p_normalized_url: url,
    })
    const { error } = await alice.client.from("product_import_sources").insert({
      workspace_id: alice.workspaceId,
      import_id: session!.import_id,
      source_type: "public_url",
      status: "pending",
      position: 5,
      display_name: "second link",
      source_url: "https://example.com/second",
      normalized_url: "https://example.com/second",
    })
    expect(error?.code).toBe("23505")
  })

  it("requires an unhappy source to say why, and a happy one not to", async () => {
    const { error } = await stage(alice, { status: "failed" })
    expect(error?.code).toBe("23514")
    const ok = await stage(alice, {
      status: "failed",
      error_code: "transcription_unavailable",
      error_message: "m",
    })
    expect(ok.error).toBeNull()
  })

  it("keeps an import made before sessions readable, with its URL pair whole", async () => {
    const { data: product } = await alice.client
      .from("products")
      .insert({
        workspace_id: alice.workspaceId,
        name: "Legacy",
        slug: "legacy-link",
        product_type: "other",
      })
      .select("id")
      .single()
    const half = await alice.client.from("product_imports").insert({
      workspace_id: alice.workspaceId,
      product_id: product!.id,
      provider: "webpage",
      source_url: "https://example.com/half",
      status: "pending",
    })
    expect(half.error?.code).toBe("23514")
  })
})
