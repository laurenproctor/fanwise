import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Json } from "@/lib/supabase/database.types"
import {
  RLS_DENIED,
  adminClient,
  anonClient,
  createActor,
  destroyActor,
  type Actor,
} from "./harness"

/**
 * Publishing a profile, against a real database.
 *
 * `publish_public_profile()` is where "a draft becomes public" actually
 * happens, so its guarantees are proven here rather than inferred from the
 * action that calls it:
 *
 *   - atomic: a handle somebody else holds fails the whole publish, and the
 *     live profile, its pages and the draft are exactly as they were;
 *   - idempotent: the same publish twice writes one publication;
 *   - reviewed: a draft changed since review is refused;
 *   - authorized: another workspace, and anon, are refused;
 *   - only what the draft shows is public, and hiding a product takes its page
 *     off the public web;
 *   - drafts and the publication log are never readable signed out.
 */

let alice: Actor
let bob: Actor
let carol: Actor
const suffix = Date.now().toString(36)

let aliceProfileId: string
const products: string[] = []
let bobHandle: string

async function profileFor(actor: Actor, handle: string, name: string): Promise<string> {
  const { data, error } = await actor.client
    .from("public_profiles")
    .insert({ workspace_id: actor.workspaceId, handle, display_name: name })
    .select("id")
    .single()
  if (error) throw new Error(`profile: ${error.message}`)
  const { error: draftError } = await actor.client.from("public_profile_drafts").insert({
    public_profile_id: data.id,
    workspace_id: actor.workspaceId,
    handle,
    display_name: name,
  })
  if (draftError) throw new Error(`draft: ${draftError.message}`)
  return data.id
}

/** Writes the draft's products and returns its new updated_at, as step 3 would read it. */
async function arrangeDraft(
  actor: Actor,
  profileId: string,
  entries: Array<{ productId: string; visible: boolean }>,
  patch: { handle?: string; display_name?: string } = {},
): Promise<string> {
  const { data, error } = await actor.client
    .from("public_profile_drafts")
    .update({ products: entries as unknown as Json, ...patch })
    .eq("public_profile_id", profileId)
    .select("updated_at")
    .single()
  if (error) throw new Error(`arrange: ${error.message}`)
  return data.updated_at
}

function values(handle: string, name = "Alice Studio") {
  return {
    handle,
    display_name: name,
    short_bio: "Type and templates.",
    links: [
      { url: "https://alice.example/", label: "" },
      { url: "https://www.instagram.com/alice/", label: "" },
    ],
  }
}

function publish(
  actor: Actor | "anon",
  profileId: string,
  expected: string,
  handle: string,
  productIds: string[],
  name?: string,
) {
  const client = actor === "anon" ? anonClient() : actor.client
  return client.rpc("publish_public_profile", {
    p_public_profile_id: profileId,
    p_expected_draft_updated_at: expected,
    p_values: values(handle, name),
    p_product_ids: productIds,
  })
}

async function liveProfile(id: string) {
  const { data } = await adminClient()
    .from("public_profiles")
    .select("handle, display_name, short_bio, website_url, status")
    .eq("id", id)
    .single()
  return data
}

async function publicationCount(id: string): Promise<number> {
  const { count } = await adminClient()
    .from("public_profile_publications")
    .select("id", { count: "exact", head: true })
    .eq("public_profile_id", id)
  return count ?? 0
}

async function pages(profileId: string) {
  const { data } = await adminClient()
    .from("public_product_pages")
    .select("product_id, status, display_order, featured")
    .eq("public_profile_id", profileId)
    .order("display_order")
  return data ?? []
}

beforeAll(async () => {
  alice = await createActor("pub-alice")
  bob = await createActor("pub-bob")
  carol = await createActor("pub-carol")

  aliceProfileId = await profileFor(alice, `alice-${suffix}`, "Alice Studio")
  bobHandle = `bob-held-${suffix}`
  await profileFor(bob, bobHandle, "Bob Studio")

  for (const name of ["First", "Second", "Third"]) {
    const { data, error } = await alice.client
      .from("products")
      .insert({
        workspace_id: alice.workspaceId,
        name,
        slug: `${name.toLowerCase()}-${suffix}`,
        product_type: "template",
      })
      .select("id")
      .single()
    if (error) throw new Error(`product: ${error.message}`)
    products.push(data.id)
  }
})

afterAll(async () => {
  for (const actor of [alice, bob, carol]) if (actor) await destroyActor(actor)
})

describe("authorization", () => {
  it("refuses a signed-out caller", async () => {
    const expected = await arrangeDraft(alice, aliceProfileId, [])
    const { error } = await publish("anon", aliceProfileId, expected, `alice-${suffix}`, [])
    expect(error?.code).toBe(RLS_DENIED)
    expect((await liveProfile(aliceProfileId))?.status).toBe("draft")
  })

  it("refuses a member of another workspace", async () => {
    const expected = await arrangeDraft(alice, aliceProfileId, [])
    const { error } = await publish(bob, aliceProfileId, expected, `alice-${suffix}`, [])
    expect(error?.code).toBe(RLS_DENIED)
    expect((await liveProfile(aliceProfileId))?.status).toBe("draft")
    expect(await publicationCount(aliceProfileId)).toBe(0)
  })
})

describe("atomic slug claiming", () => {
  it("fails the whole publish when another profile holds the handle, changing nothing", async () => {
    const entries = [{ productId: products[0]!, visible: true }]
    const expected = await arrangeDraft(alice, aliceProfileId, entries, { handle: bobHandle })

    const { error } = await publish(alice, aliceProfileId, expected, bobHandle, [products[0]!])
    expect(error?.code).toBe("23505")

    // Live profile, pages and publication log untouched.
    expect(await liveProfile(aliceProfileId)).toMatchObject({
      handle: `alice-${suffix}`,
      display_name: "Alice Studio",
      status: "draft",
    })
    expect(await pages(aliceProfileId)).toEqual([])
    expect(await publicationCount(aliceProfileId)).toBe(0)

    // The draft keeps what the creator typed, so they can fix it.
    const { data: draft } = await alice.client
      .from("public_profile_drafts")
      .select("handle, products")
      .eq("public_profile_id", aliceProfileId)
      .single()
    expect(draft).toEqual({ handle: bobHandle, products: entries })
  })

  it("refuses a reserved handle at the database, whatever the caller sends", async () => {
    const expected = await arrangeDraft(alice, aliceProfileId, [], { handle: `alice-${suffix}` })
    const { error } = await publish(alice, aliceProfileId, expected, "settings", [])
    expect(error?.code).toBe("23514")
    expect((await liveProfile(aliceProfileId))?.handle).toBe(`alice-${suffix}`)
  })
})

describe("publishing", () => {
  let expected: string

  it("refuses a draft that changed after review", async () => {
    const stale = await arrangeDraft(alice, aliceProfileId, [
      { productId: products[0]!, visible: true },
    ])
    await arrangeDraft(alice, aliceProfileId, [{ productId: products[0]!, visible: false }])
    const { error } = await publish(alice, aliceProfileId, stale, `alice-${suffix}`, [products[0]!])
    expect(error?.code).toBe("PT409")
    expect((await liveProfile(aliceProfileId))?.status).toBe("draft")
  })

  it("refuses a product list that is not the draft's selection, in the draft's order", async () => {
    expected = await arrangeDraft(alice, aliceProfileId, [
      { productId: products[0]!, visible: true },
      { productId: products[1]!, visible: true },
      { productId: products[2]!, visible: false },
    ])
    const hiddenOne = await publish(alice, aliceProfileId, expected, `alice-${suffix}`, [
      products[2]!,
    ])
    expect(hiddenOne.error?.code).toBe("23514")
    const reordered = await publish(alice, aliceProfileId, expected, `alice-${suffix}`, [
      products[1]!,
      products[0]!,
    ])
    expect(reordered.error?.code).toBe("23514")
    expect(await publicationCount(aliceProfileId)).toBe(0)
  })

  it("publishes the profile and exactly the selected pages, in order, in one call", async () => {
    const { data, error } = await publish(alice, aliceProfileId, expected, `alice-${suffix}`, [
      products[0]!,
      products[1]!,
    ])
    expect(error).toBeNull()
    expect(data).toMatchObject({ outcome: "published", handle: `alice-${suffix}` })

    expect(await liveProfile(aliceProfileId)).toMatchObject({
      status: "published",
      short_bio: "Type and templates.",
      // Links live in their own table now; the retired column is cleared.
      website_url: null,
    })
    const { data: links } = await adminClient()
      .from("public_profile_links")
      .select("position, url, label")
      .eq("public_profile_id", aliceProfileId)
      .order("position")
    expect(links).toEqual([
      { position: 0, url: "https://alice.example/", label: null },
      { position: 1, url: "https://www.instagram.com/alice/", label: null },
    ])
    expect(await pages(aliceProfileId)).toEqual([
      { product_id: products[0], status: "published", display_order: 0, featured: false },
      { product_id: products[1], status: "published", display_order: 1, featured: false },
    ])
    expect(await publicationCount(aliceProfileId)).toBe(1)
  })

  it("is idempotent: publishing the same draft again writes nothing new", async () => {
    const { data, error } = await publish(alice, aliceProfileId, expected, `alice-${suffix}`, [
      products[0]!,
      products[1]!,
    ])
    expect(error).toBeNull()
    expect(data).toMatchObject({ outcome: "unchanged" })
    expect(await publicationCount(aliceProfileId)).toBe(1)
  })

  it("is visible signed out only after it succeeded, and only the published pages", async () => {
    const anon = anonClient()
    const { data: profile } = await anon
      .from("public_profiles")
      .select("id, display_name")
      .eq("id", aliceProfileId)
      .maybeSingle()
    expect(profile?.display_name).toBe("Alice Studio")

    const { data: visiblePages } = await anon
      .from("public_product_pages")
      .select("product_id")
      .eq("public_profile_id", aliceProfileId)
    expect((visiblePages ?? []).map((p) => p.product_id).sort()).toEqual(
      [products[0], products[1]].sort(),
    )
  })

  it("keeps the live profile on the last publish while the draft is edited", async () => {
    await arrangeDraft(
      alice,
      aliceProfileId,
      [
        { productId: products[0]!, visible: true },
        { productId: products[1]!, visible: false },
        { productId: products[2]!, visible: false },
      ],
      { display_name: "Alice Renamed" },
    )
    expect(await liveProfile(aliceProfileId)).toMatchObject({ display_name: "Alice Studio" })
    expect((await pages(aliceProfileId)).map((p) => p.status)).toEqual(["published", "published"])
  })

  it("takes a hidden product's page off the public web when the update is published", async () => {
    const { data: draft } = await alice.client
      .from("public_profile_drafts")
      .select("updated_at")
      .eq("public_profile_id", aliceProfileId)
      .single()

    const { data, error } = await publish(
      alice,
      aliceProfileId,
      draft!.updated_at,
      `alice-${suffix}`,
      [products[0]!],
      "Alice Renamed",
    )
    expect(error).toBeNull()
    expect(data).toMatchObject({ outcome: "published" })
    expect(await publicationCount(aliceProfileId)).toBe(2)

    const anon = anonClient()
    const { data: hiddenPage } = await anon
      .from("public_product_pages")
      .select("id")
      .eq("public_profile_id", aliceProfileId)
      .eq("product_id", products[1]!)
    expect(hiddenPage).toEqual([])

    const { data: hiddenProduct } = await anon.from("products").select("id").eq("id", products[1]!)
    expect(hiddenProduct).toEqual([])

    expect(await liveProfile(aliceProfileId)).toMatchObject({ display_name: "Alice Renamed" })
  })

  it("keeps a published profile's old handle as a redirect after a rename", async () => {
    const renamed = `alice-moved-${suffix}`
    const updatedAt = await arrangeDraft(
      alice,
      aliceProfileId,
      [
        { productId: products[0]!, visible: true },
        { productId: products[1]!, visible: false },
        { productId: products[2]!, visible: false },
      ],
      { handle: renamed },
    )
    const { error } = await publish(
      alice,
      aliceProfileId,
      updatedAt,
      renamed,
      [products[0]!],
      "Alice Renamed",
    )
    expect(error).toBeNull()

    const { data: history } = await anonClient()
      .from("public_handle_history")
      .select("handle, public_profiles!inner(handle)")
      .eq("handle", `alice-${suffix}`)
      .maybeSingle()
    expect(history?.public_profiles.handle).toBe(renamed)
  })

  it("does not reserve a never-published profile's old handle", async () => {
    const first = `carol-${suffix}`
    const carolProfileId = await profileFor(carol, first, "Carol Studio")
    const updatedAt = await arrangeDraft(carol, carolProfileId, [], {
      handle: `carol-final-${suffix}`,
    })
    const { error } = await carol.client.rpc("publish_public_profile", {
      p_public_profile_id: carolProfileId,
      p_expected_draft_updated_at: updatedAt,
      p_values: values(`carol-final-${suffix}`, "Carol Studio"),
      p_product_ids: [],
    })
    expect(error).toBeNull()

    const { data: history } = await adminClient()
      .from("public_handle_history")
      .select("handle")
      .eq("public_profile_id", carolProfileId)
    expect(history).toEqual([])
  })
})

describe("location and the Contact button", () => {
  let dave: Actor
  let profileId: string
  const handle = `dave-${suffix}`

  const daveValues = (overrides: Record<string, string> = {}) => ({
    handle,
    display_name: "Dave Studio",
    short_bio: "",
    website_url: "",
    instagram_url: "",
    behance_url: "",
    location: "Brooklyn, New York",
    contact_url: "mailto:hello@dave.example",
    ...overrides,
  })

  async function publishDave(values: Record<string, string>) {
    const expected = await arrangeDraft(dave, profileId, [])
    return dave.client.rpc("publish_public_profile", {
      p_public_profile_id: profileId,
      p_expected_draft_updated_at: expected,
      p_values: values,
      p_product_ids: [],
    })
  }

  async function live() {
    const { data } = await adminClient()
      .from("public_profiles")
      .select("location, contact_url, status")
      .eq("id", profileId)
      .single()
    return data
  }

  beforeAll(async () => {
    dave = await createActor("pub-dave")
    profileId = await profileFor(dave, handle, "Dave Studio")
  })

  afterAll(async () => {
    if (dave) await destroyActor(dave)
  })

  it("publishes both onto the live row, where a signed-out visitor can read them", async () => {
    const { data, error } = await publishDave(daveValues())
    expect(error).toBeNull()
    expect(data).toMatchObject({ outcome: "published" })
    expect(await live()).toEqual({
      location: "Brooklyn, New York",
      contact_url: "mailto:hello@dave.example",
      status: "published",
    })

    const { data: seen } = await anonClient()
      .from("public_profiles")
      .select("location, contact_url")
      .eq("id", profileId)
      .single()
    expect(seen).toEqual({
      location: "Brooklyn, New York",
      contact_url: "mailto:hello@dave.example",
    })
  })

  it("treats the same location and contact as unchanged", async () => {
    const before = await publicationCount(profileId)
    const { data, error } = await publishDave(daveValues())
    expect(error).toBeNull()
    expect(data).toMatchObject({ outcome: "unchanged" })
    expect(await publicationCount(profileId)).toBe(before)
  })

  it("changes the contact to a web page", async () => {
    const { error } = await publishDave(daveValues({ contact_url: "https://dave.example/contact" }))
    expect(error).toBeNull()
    expect((await live())?.contact_url).toBe("https://dave.example/contact")
  })

  it("removes the Contact button and the location when both are published empty", async () => {
    const before = await publicationCount(profileId)
    const { data, error } = await publishDave(daveValues({ location: "", contact_url: "" }))
    expect(error).toBeNull()
    expect(data).toMatchObject({ outcome: "published" })
    expect(await live()).toMatchObject({ location: null, contact_url: null })
    expect(await publicationCount(profileId)).toBe(before + 1)
  })

  it("refuses a contact that is not an https page or a plain mailto, changing nothing", async () => {
    await publishDave(daveValues())
    for (const contact_url of ["javascript:alert(1)", "http://dave.example", "mailto:"]) {
      const { error } = await publishDave(daveValues({ contact_url }))
      expect(error?.code, contact_url).toBe("23514")
    }
    expect((await live())?.contact_url).toBe("mailto:hello@dave.example")
  })

  /**
   * A publication recorded before this migration has no location or
   * contact_url key. The old function never wrote those columns, so the live
   * row holds what was published; an otherwise identical republish must be a
   * no-op, not a new publication.
   */
  it("counts an older publication without the two keys as unchanged", async () => {
    await publishDave(daveValues())
    const admin = adminClient()
    const { data: latest } = await admin
      .from("public_profile_publications")
      .select("snapshot, draft_updated_at, workspace_id, handle")
      .eq("public_profile_id", profileId)
      .order("published_at", { ascending: false })
      .limit(1)
      .single()
    const legacy = Object.fromEntries(
      Object.entries(latest!.snapshot as Record<string, unknown>).filter(
        ([key]) => key !== "location" && key !== "contact_url",
      ),
    )
    expect(Object.keys(legacy)).not.toContain("location")
    const { error: insertError } = await admin.from("public_profile_publications").insert({
      public_profile_id: profileId,
      workspace_id: latest!.workspace_id,
      handle: latest!.handle,
      draft_updated_at: latest!.draft_updated_at,
      snapshot: legacy as Json,
      published_at: new Date(Date.now() + 60_000).toISOString(),
    })
    expect(insertError).toBeNull()

    const before = await publicationCount(profileId)
    const { data, error } = await publishDave(daveValues())
    expect(error).toBeNull()
    expect(data).toMatchObject({ outcome: "unchanged" })
    expect(await publicationCount(profileId)).toBe(before)
  })
})

describe("what a signed-out visitor can never read", () => {
  it("cannot read the publication log or any draft", async () => {
    const anon = anonClient()
    const publications = await anon.from("public_profile_publications").select("*")
    expect(publications.error?.code).toBe(RLS_DENIED)
    const drafts = await anon.from("public_profile_drafts").select("*")
    expect(drafts.error?.code).toBe(RLS_DENIED)
  })

  it("does not let another workspace read the publication log", async () => {
    const { data } = await bob.client
      .from("public_profile_publications")
      .select("id")
      .eq("public_profile_id", aliceProfileId)
    expect(data).toEqual([])
  })

  it("keeps a publication immutable, even to its own workspace", async () => {
    const { data, error } = await alice.client
      .from("public_profile_publications")
      .update({ handle: "forged" })
      .eq("public_profile_id", aliceProfileId)
      .select("id")
    expect(error?.code === RLS_DENIED || (data ?? []).length === 0).toBe(true)
  })
})
