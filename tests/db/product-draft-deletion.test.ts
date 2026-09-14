import { randomUUID } from "node:crypto"
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
 * `delete_product_draft` and `product_draft_deletion_blocker`, against real
 * Postgres with RLS on.
 *
 * A product may be permanently deleted by its workspace's owner only while it
 * has never left Fanwise. What is proven here is that the database — not the
 * page that offers the button — holds every part of that: who may ask, what
 * blocks, what cascades, what is handed back for storage cleanup, what happens
 * to the profile builder's arrangement, and that publishing and deleting at the
 * same moment cannot both succeed.
 *
 * Fixture rows a background job or a channel would write are inserted with the
 * service role, as the finalize job, the runner and the import job would. Every
 * deletion is called as a signed-in actor through PostgREST.
 */

type DeleteResult = {
  outcome: "deleted" | "blocked" | "not_found"
  blocker: string | null
  asset_paths: string[]
  import_source_paths: string[]
}

let alice: Actor
let bob: Actor
let carol: Actor
let channelId: string
let connectionId: string
let profileId: string
let counter = 0

const next = () => {
  counter += 1
  return `${Date.now().toString(36)}-${counter}`
}

async function createProduct(actor: Actor = alice): Promise<string> {
  const tag = next()
  const { data, error } = await actor.client
    .from("products")
    .insert({
      workspace_id: actor.workspaceId,
      name: `Deletable ${tag}`,
      slug: `deletable-${tag}`,
      product_type: "font",
    })
    .select("id")
    .single()
  if (error) throw new Error(`could not create product: ${error.message}`)
  return data.id
}

async function listing(
  product: string,
  overrides: {
    status?: "draft" | "ready" | "publishing" | "published" | "failed" | "archived"
    external_listing_id?: string
    external_url?: string
  } = {},
): Promise<string> {
  const { data, error } = await adminClient()
    .from("channel_listings")
    .insert({
      workspace_id: alice.workspaceId,
      product_id: product,
      channel_id: channelId,
      channel_connection_id: connectionId,
      title: "A listing",
      ...overrides,
    })
    .select("id")
    .single()
  if (error) throw new Error(`could not create listing: ${error.message}`)
  return data.id
}

async function asset(product: string, state: "ready" | "pending" | "failed" = "ready") {
  const tag = next()
  const storagePath = `${alice.workspaceId}/${product}/${tag}.png`
  const measured =
    state === "ready" ? { mime_type: "image/png", byte_size: 1024, checksum: `sha256:${tag}` } : {}
  const { data, error } = await adminClient()
    .from("product_assets")
    .insert({
      workspace_id: alice.workspaceId,
      product_id: product,
      asset_type: "preview_image",
      asset_state: state,
      storage_path: storagePath,
      filename: `${tag}.png`,
      ...measured,
    })
    .select("id")
    .single()
  if (error) throw new Error(`could not create asset: ${error.message}`)
  return { id: data.id, storagePath }
}

const sourcePath = (extension: "pdf" | "txt") =>
  `${alice.workspaceId}/import-sources/${randomUUID()}.${extension}`

/** A composed import, with one uploaded PDF source in the given state. */
async function importWithSource(
  product: string,
  importStatus: "pending" | "retrieving" | "analyzing" | "ready" = "ready",
  sourceStatus: "uploading" | "transcribing" | "pending" | "reading" | "ready" = "ready",
): Promise<{ importId: string; path: string }> {
  const admin = adminClient()
  const { data: session, error } = await admin
    .from("product_imports")
    .insert({
      workspace_id: alice.workspaceId,
      product_id: product,
      provider: "composed",
      status: importStatus,
    })
    .select("id")
    .single()
  if (error) throw new Error(`could not create import: ${error.message}`)

  const path = sourcePath("pdf")
  const { error: sourceError } = await admin.from("product_import_sources").insert({
    workspace_id: alice.workspaceId,
    import_id: session.id,
    source_type: "pdf",
    status: sourceStatus,
    position: 0,
    display_name: "Specimen.pdf",
    storage_path: path,
  })
  if (sourceError) throw new Error(`could not create source: ${sourceError.message}`)
  return { importId: session.id, path }
}

function deleteDraft(actor: Actor, product: string) {
  return actor.client.rpc("delete_product_draft", { p_product_id: product })
}

async function deleted(actor: Actor, product: string): Promise<DeleteResult> {
  const { data, error } = await deleteDraft(actor, product)
  if (error) throw new Error(`delete_product_draft errored: ${error.message}`)
  return data as unknown as DeleteResult
}

async function blocker(actor: Actor, product: string): Promise<string | null> {
  const { data, error } = await actor.client.rpc("product_draft_deletion_blocker", {
    p_product_id: product,
  })
  if (error) throw new Error(`product_draft_deletion_blocker errored: ${error.message}`)
  return data as string | null
}

async function count(table: string, column: string, value: string): Promise<number> {
  const { count: n, error } = await adminClient()
    // A table name from this file, never from input.
    .from(table as "products")
    .select("*", { count: "exact", head: true })
    .eq(column as "id", value)
  if (error) throw new Error(`count ${table}: ${error.message}`)
  return n ?? 0
}

const productExists = async (product: string) => (await count("products", "id", product)) === 1

beforeAll(async () => {
  const admin = adminClient()
  const { data: channels, error } = await admin.from("channels").select("id, key")
  if (error) throw new Error(`could not read channels: ${error.message}`)
  channelId = channels.find((channel) => channel.key === "mock_api")!.id

  alice = await createActor("dd-alice")
  bob = await createActor("dd-bob")
  carol = await createActor("dd-carol")

  // Carol is a member of alice's workspace, but not its owner.
  const { error: memberError } = await alice.client.from("workspace_members").insert({
    workspace_id: alice.workspaceId,
    user_id: carol.userId,
    role: "editor",
  })
  if (memberError) throw new Error(`membership: ${memberError.message}`)

  const { data: connection, error: connectionError } = await alice.client
    .from("channel_connections")
    .insert({
      workspace_id: alice.workspaceId,
      channel_id: channelId,
      external_account_id: `dd-shop-${next()}`,
    })
    .select("id")
    .single()
  if (connectionError) throw new Error(`connection: ${connectionError.message}`)
  connectionId = connection.id

  const { data: profile, error: profileError } = await alice.client
    .from("public_profiles")
    .insert({
      workspace_id: alice.workspaceId,
      handle: `dd-studio-${Date.now().toString(36)}`,
      display_name: "Deletion Studio",
    })
    .select("id")
    .single()
  if (profileError) throw new Error(`profile: ${profileError.message}`)
  profileId = profile.id
})

afterAll(async () => {
  if (alice) await destroyActor(alice)
  if (bob) await destroyActor(bob)
  if (carol) await destroyActor(carol)
})

describe("an owner deletes a clean draft", () => {
  it("deletes a product with nothing attached, and reports no paths", async () => {
    const product = await createProduct()

    expect(await blocker(alice, product)).toBeNull()
    expect(await deleted(alice, product)).toEqual({
      outcome: "deleted",
      blocker: null,
      asset_paths: [],
      import_source_paths: [],
    })
    expect(await productExists(product)).toBe(false)
  })

  it("cascades internal dependents: assets, draft listings, snapshots, open manual steps, finished generations, the import and its sources", async () => {
    const product = await createProduct()
    const admin = adminClient()
    const image = await asset(product)
    const derivative = await admin
      .from("product_assets")
      .insert({
        workspace_id: alice.workspaceId,
        product_id: product,
        asset_type: "thumbnail",
        // Not pending: an unfinished row is the upload blocker, which is not
        // what this test measures.
        asset_state: "failed",
        storage_path: `${alice.workspaceId}/${product}/${next()}-thumb.webp`,
        filename: "thumb.webp",
        derived_from: image.id,
        spec_hash: "spec-thumb",
      })
      .select("id")
      .single()
    expect(derivative.error).toBeNull()

    const listingId = await listing(product, { status: "ready" })
    await admin.from("listing_snapshots").insert({
      workspace_id: alice.workspaceId,
      channel_listing_id: listingId,
      product_id: product,
      channel_id: channelId,
      snapshot_type: "build",
      payload: { listing: {} },
    })
    await admin.from("listing_manual_steps").insert({
      workspace_id: alice.workspaceId,
      channel_listing_id: listingId,
      step_key: "attach_digital_file",
    })
    await admin.from("ai_generations").insert({
      workspace_id: alice.workspaceId,
      product_id: product,
      channel_listing_id: listingId,
      status: "succeeded",
    })
    const { importId } = await importWithSource(product)

    const result = await deleted(alice, product)
    expect(result.outcome).toBe("deleted")

    expect(await productExists(product)).toBe(false)
    expect(await count("product_assets", "product_id", product)).toBe(0)
    expect(await count("channel_listings", "product_id", product)).toBe(0)
    expect(await count("listing_snapshots", "channel_listing_id", listingId)).toBe(0)
    expect(await count("listing_manual_steps", "channel_listing_id", listingId)).toBe(0)
    expect(await count("ai_generations", "product_id", product)).toBe(0)
    expect(await count("product_imports", "product_id", product)).toBe(0)
    expect(await count("product_import_sources", "import_id", importId)).toBe(0)
  })

  it("returns every stored object's path, deduplicated, in two lists", async () => {
    const product = await createProduct()
    const one = await asset(product)
    const two = await asset(product, "failed")

    // A legacy single-source import, whose backfilled source row names the
    // same object as the session's own column, plus a second source.
    const admin = adminClient()
    const shared = sourcePath("pdf")
    const { data: session, error } = await admin
      .from("product_imports")
      .insert({
        workspace_id: alice.workspaceId,
        product_id: product,
        provider: "pdf_document",
        status: "ready",
        source_path: shared,
        source_filename: "Specimen.pdf",
      })
      .select("id")
      .single()
    expect(error).toBeNull()
    const pasted = sourcePath("txt")
    const sources = await admin.from("product_import_sources").insert([
      {
        workspace_id: alice.workspaceId,
        import_id: session!.id,
        source_type: "pdf",
        status: "ready",
        position: 0,
        display_name: "Specimen.pdf",
        storage_path: shared,
      },
      {
        workspace_id: alice.workspaceId,
        import_id: session!.id,
        source_type: "pasted_text",
        status: "ready",
        position: 1,
        display_name: "Pasted text",
        storage_path: pasted,
      },
    ])
    expect(sources.error).toBeNull()

    const result = await deleted(alice, product)

    expect(result.outcome).toBe("deleted")
    expect([...result.asset_paths].sort()).toEqual([one.storagePath, two.storagePath].sort())
    expect([...result.import_source_paths].sort()).toEqual([shared, pasted].sort())
  })

  it("takes the product out of the profile builder's arrangement and moves the revision", async () => {
    const target = await createProduct()
    const kept = await createProduct()
    const stale = await createProduct()
    const admin = adminClient()

    await admin.from("public_profile_drafts").delete().eq("public_profile_id", profileId)
    const { error: draftError } = await alice.client.from("public_profile_drafts").insert({
      public_profile_id: profileId,
      workspace_id: alice.workspaceId,
      products: [
        { productId: stale, visible: true },
        { productId: target, visible: true },
        { productId: kept, visible: false },
      ],
      revision: 4,
    })
    expect(draftError).toBeNull()

    // A product removed before this function existed, still named by the
    // draft. Left in, it would make the rewrite — and so the deletion — fail
    // the draft's ownership trigger.
    await admin.from("products").delete().eq("id", stale)

    expect((await deleted(alice, target)).outcome).toBe("deleted")

    const { data: draft } = await admin
      .from("public_profile_drafts")
      .select("products, revision")
      .eq("public_profile_id", profileId)
      .single()
    expect(draft?.products).toEqual([{ productId: kept, visible: false }])
    expect(draft?.revision).toBe(5)
  })

  it("leaves a draft that never named the product exactly as it was", async () => {
    const named = await createProduct()
    const unrelated = await createProduct()
    const admin = adminClient()

    await admin.from("public_profile_drafts").delete().eq("public_profile_id", profileId)
    await alice.client.from("public_profile_drafts").insert({
      public_profile_id: profileId,
      workspace_id: alice.workspaceId,
      products: [{ productId: named, visible: true }],
      revision: 2,
    })

    expect((await deleted(alice, unrelated)).outcome).toBe("deleted")

    const { data: draft } = await admin
      .from("public_profile_drafts")
      .select("products, revision")
      .eq("public_profile_id", profileId)
      .single()
    expect(draft?.products).toEqual([{ productId: named, visible: true }])
    expect(draft?.revision).toBe(2)
  })
})

describe("who may delete", () => {
  it("hides another workspace's product: not found, the same answer as a missing id, and nothing deleted", async () => {
    const product = await createProduct()

    const theirs = await deleted(bob, product)
    const missing = await deleted(bob, randomUUID())

    expect(theirs).toEqual(missing)
    expect(theirs).toEqual({
      outcome: "not_found",
      blocker: null,
      asset_paths: [],
      import_source_paths: [],
    })
    expect(await blocker(bob, product)).toBe("not_found")
    expect(await productExists(product)).toBe(true)
  })

  it("does not let a member who is not the owner delete, and tells them nothing more", async () => {
    const product = await createProduct()
    await asset(product)

    expect((await deleted(carol, product)).outcome).toBe("not_found")
    expect(await blocker(carol, product)).toBe("not_found")
    expect(await productExists(product)).toBe(true)
  })

  it("refuses a visitor with no session before the function runs", async () => {
    const product = await createProduct()

    const { error } = await anonClient().rpc("delete_product_draft", { p_product_id: product })

    expect(error?.code).toBe(RLS_DENIED)
    expect(await productExists(product)).toBe(true)
  })

  it("refuses a direct delete on products, even of the owner's own clean draft", async () => {
    const product = await createProduct()

    const { error } = await alice.client.from("products").delete().eq("id", product)

    // No grant: refused before RLS is consulted.
    expect(error?.code).toBe(RLS_DENIED)
    expect(await productExists(product)).toBe(true)
  })
})

describe("what blocks", () => {
  async function expectBlocked(product: string, code: string) {
    // The page's question and the deletion's answer agree.
    expect(await blocker(alice, product)).toBe(code)
    const result = await deleted(alice, product)
    expect(result).toEqual({
      outcome: "blocked",
      blocker: code,
      asset_paths: [],
      import_source_paths: [],
    })
    expect(await productExists(product)).toBe(true)
  }

  it.each(["pending", "running", "succeeded", "failed"] as const)(
    "a publication job in any state (%s)",
    async (status) => {
      const product = await createProduct()
      const listingId = await listing(product)
      const { error } = await adminClient()
        .from("publication_jobs")
        .insert({
          workspace_id: alice.workspaceId,
          channel_listing_id: listingId,
          kind: "publish",
          idempotency_key: `publish:${listingId}:${next()}`,
          status,
        })
      expect(error).toBeNull()

      await expectBlocked(product, "publication_history")
    },
  )

  it("an activity event about the product", async () => {
    const product = await createProduct()
    const { error } = await adminClient().from("workspace_events").insert({
      workspace_id: alice.workspaceId,
      event_type: "publish_run_started",
      product_id: product,
    })
    expect(error).toBeNull()

    await expectBlocked(product, "activity_history")
  })

  it("an activity event about one of its listings only", async () => {
    const product = await createProduct()
    const listingId = await listing(product)
    const { error } = await adminClient().from("workspace_events").insert({
      workspace_id: alice.workspaceId,
      event_type: "publish_run_job_settled",
      channel_listing_id: listingId,
    })
    expect(error).toBeNull()

    await expectBlocked(product, "activity_history")
  })

  it("an external listing id", async () => {
    const product = await createProduct()
    await listing(product, { external_listing_id: `ext-${next()}` })
    await expectBlocked(product, "listing_external_reference")
  })

  it("an external url", async () => {
    const product = await createProduct()
    await listing(product, { external_url: "https://shop.example/products/aster" })
    await expectBlocked(product, "listing_external_reference")
  })

  it.each(["publishing", "published"] as const)("a %s listing", async (status) => {
    const product = await createProduct()
    await listing(product, { status })
    await expectBlocked(product, "listing_live")
  })

  it("a completed manual step, which is a person saying they did the channel's half", async () => {
    const product = await createProduct()
    const listingId = await listing(product)
    await adminClient().from("listing_manual_steps").insert({
      workspace_id: alice.workspaceId,
      channel_listing_id: listingId,
      step_key: "attach_digital_file",
      completed_at: new Date().toISOString(),
    })
    await expectBlocked(product, "listing_live")
  })

  it.each(["draft", "published"] as const)("a public page, even a %s one", async (status) => {
    const product = await createProduct()
    const { error } = await adminClient()
      .from("public_product_pages")
      .insert({
        workspace_id: alice.workspaceId,
        public_profile_id: profileId,
        product_id: product,
        slug: `page-${next()}`,
        status,
        published_at: status === "published" ? new Date().toISOString() : null,
      })
    expect(error).toBeNull()

    await expectBlocked(product, "public_page")
  })

  it.each(["pending", "retrieving", "analyzing"] as const)(
    "an import that is %s",
    async (status) => {
      const product = await createProduct()
      await importWithSource(product, status, "ready")
      await expectBlocked(product, "import_in_progress")
    },
  )

  it.each(["uploading", "transcribing", "pending", "reading"] as const)(
    "an import source that is %s, which covers transcription",
    async (status) => {
      const product = await createProduct()
      await importWithSource(product, "ready", status)
      await expectBlocked(product, "import_in_progress")
    },
  )

  it.each(["pending", "running"] as const)("an AI generation that is %s", async (status) => {
    const product = await createProduct()
    const listingId = await listing(product)
    const { error } = await adminClient().from("ai_generations").insert({
      workspace_id: alice.workspaceId,
      product_id: product,
      channel_listing_id: listingId,
      status,
    })
    expect(error).toBeNull()

    await expectBlocked(product, "generation_in_progress")
  })

  it("an upload that has not finished", async () => {
    const product = await createProduct()
    await asset(product, "pending")
    await expectBlocked(product, "upload_in_progress")
  })

  it("names the permanent reason before the temporary one", async () => {
    const product = await createProduct()
    await listing(product, { status: "published" })
    await asset(product, "pending")
    await expectBlocked(product, "listing_live")
  })
})

describe("concurrency", () => {
  it("never lets a publication and a deletion both succeed", async () => {
    /*
      A publication job inserted at the same moment as the deletion, over
      separate requests and so separate transactions. Whichever commits first
      wins: the job is seen and the deletion refuses, or the product and its
      listing are gone and the job's foreign key fails. Repeated, because a
      race lost once can be won by luck the next time.
    */
    for (let round = 0; round < 10; round += 1) {
      const product = await createProduct()
      const listingId = await listing(product)

      const [deletion, job] = await Promise.all([
        deleteDraft(alice, product),
        alice.client
          .from("publication_jobs")
          .insert({
            workspace_id: alice.workspaceId,
            channel_listing_id: listingId,
            kind: "publish",
            idempotency_key: `publish:${listingId}:race-${round}`,
          })
          .select("id")
          .single(),
      ])

      expect(deletion.error, `round ${round}: the deletion itself errored`).toBeNull()
      const outcome = (deletion.data as unknown as DeleteResult).outcome
      const exists = await productExists(product)
      const jobs = await count("publication_jobs", "channel_listing_id", listingId)

      if (outcome === "deleted") {
        expect(job.error, `round ${round}: a job was written for a deleted product`).not.toBeNull()
        expect(exists).toBe(false)
        expect(jobs).toBe(0)
      } else {
        expect(deletion.data as unknown as DeleteResult, `round ${round}`).toMatchObject({
          outcome: "blocked",
          blocker: "publication_history",
        })
        expect(job.error, `round ${round}: the job lost to nothing`).toBeNull()
        expect(exists).toBe(true)
        expect(jobs).toBe(1)
      }
    }
  })

  it("makes two deletions at once one deletion and one not found", async () => {
    for (let round = 0; round < 5; round += 1) {
      const product = await createProduct()
      const image = await asset(product)

      const results = await Promise.all([deleted(alice, product), deleted(alice, product)])
      const outcomes = results.map((result) => result.outcome).sort()

      expect(outcomes, `round ${round}`).toEqual(["deleted", "not_found"])
      // The paths come back once, from the call that deleted.
      expect(results.flatMap((result) => result.asset_paths)).toEqual([image.storagePath])
      expect(await productExists(product)).toBe(false)
    }
  })

  it("answers a repeated deletion with not found, and nothing else", async () => {
    const product = await createProduct()

    expect((await deleted(alice, product)).outcome).toBe("deleted")
    expect(await deleted(alice, product)).toEqual({
      outcome: "not_found",
      blocker: null,
      asset_paths: [],
      import_source_paths: [],
    })
  })
})
