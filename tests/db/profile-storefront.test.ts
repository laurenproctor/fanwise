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
 * The profile as a storefront, against a real database (20260913030000).
 *
 *   - Links: written only by publication, in order, https only, at most eight,
 *     readable signed out only while the profile is published, and never
 *     writable directly by anybody.
 *   - Location: a city only ever with its country, the code in ISO form, and a
 *     legacy free-text location kept until a structured one replaces it.
 *   - Publish all: only the caller's own workspace, only a live profile, only
 *     unarchived products; additive; the draft follows; idempotent; and not a
 *     single channel listing touched.
 */

let alice: Actor
let bob: Actor
let carol: Actor
let dave: Actor
const suffix = Date.now().toString(36)

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

async function draftUpdatedAt(actor: Actor, profileId: string, products: unknown[] = []) {
  const { data, error } = await actor.client
    .from("public_profile_drafts")
    .update({ products: products as Json })
    .eq("public_profile_id", profileId)
    .select("updated_at")
    .single()
  if (error) throw new Error(`draft: ${error.message}`)
  return data.updated_at
}

async function publish(
  actor: Actor,
  profileId: string,
  values: Record<string, unknown>,
  productIds: string[] = [],
  draftProducts: unknown[] = [],
) {
  const expected = await draftUpdatedAt(actor, profileId, draftProducts)
  return actor.client.rpc("publish_public_profile", {
    p_public_profile_id: profileId,
    p_expected_draft_updated_at: expected,
    p_values: values as Json,
    p_product_ids: productIds,
  })
}

async function liveLinks(profileId: string) {
  const { data } = await adminClient()
    .from("public_profile_links")
    .select("position, url, label")
    .eq("public_profile_id", profileId)
    .order("position")
  return data ?? []
}

async function publicationCount(id: string): Promise<number> {
  const { count } = await adminClient()
    .from("public_profile_publications")
    .select("id", { count: "exact", head: true })
    .eq("public_profile_id", id)
  return count ?? 0
}

beforeAll(async () => {
  // One public profile per workspace, so each describe has its own creator.
  alice = await createActor("store-alice")
  bob = await createActor("store-bob")
  carol = await createActor("store-carol")
  dave = await createActor("store-dave")
})

afterAll(async () => {
  for (const actor of [alice, bob, carol, dave]) if (actor) await destroyActor(actor)
})

// ---------------------------------------------------------------------------

describe("links", () => {
  let profileId: string
  const handle = `links-${suffix}`
  const base = { handle, display_name: "Links Studio" }

  beforeAll(async () => {
    profileId = await profileFor(alice, handle, "Links Studio")
  })

  it("are written by publication, in the creator's order, labels only where given", async () => {
    const { data, error } = await publish(alice, profileId, {
      ...base,
      links: [
        { url: "https://are.na/links-studio", label: "Research" },
        { url: "https://links.example/", label: "" },
        { url: "https://www.instagram.com/links/", label: "  " },
      ],
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ outcome: "published" })
    expect(await liveLinks(profileId)).toEqual([
      { position: 0, url: "https://are.na/links-studio", label: "Research" },
      { position: 1, url: "https://links.example/", label: null },
      { position: 2, url: "https://www.instagram.com/links/", label: null },
    ])
  })

  it("are readable signed out while the profile is published, in order", async () => {
    const { data } = await anonClient()
      .from("public_profile_links")
      .select("url, label, position")
      .eq("public_profile_id", profileId)
      .order("position")
    expect(data?.map((row) => row.url)).toEqual([
      "https://are.na/links-studio",
      "https://links.example/",
      "https://www.instagram.com/links/",
    ])
  })

  it("treat the same links as unchanged, and a new order as a change", async () => {
    const same = [
      { url: "https://are.na/links-studio", label: "Research" },
      { url: "https://links.example/", label: "" },
      { url: "https://www.instagram.com/links/", label: "" },
    ]
    const before = await publicationCount(profileId)
    const unchanged = await publish(alice, profileId, { ...base, links: same })
    expect(unchanged.data).toMatchObject({ outcome: "unchanged" })
    expect(await publicationCount(profileId)).toBe(before)

    const reordered = await publish(alice, profileId, { ...base, links: [same[2], same[0]] })
    expect(reordered.data).toMatchObject({ outcome: "published" })
    expect((await liveLinks(profileId)).map((link) => link.url)).toEqual([
      "https://www.instagram.com/links/",
      "https://are.na/links-studio",
    ])
  })

  it.each([
    [[{ url: "javascript:alert(1)", label: "" }]],
    [[{ url: "http://links.example/", label: "" }]],
    [[{ url: "https://ok.example/", label: "x".repeat(41) }]],
    [Array.from({ length: 9 }, (_, i) => ({ url: `https://s${i}.example/`, label: "" }))],
    [[{ href: "https://links.example/" }]],
    ["https://links.example/"],
  ])("refuses unsafe or malformed links, changing nothing: %j", async (links) => {
    const before = await liveLinks(profileId)
    const { error } = await publish(alice, profileId, { ...base, links })
    expect(["22023", "23514"]).toContain(error?.code)
    expect(await liveLinks(profileId)).toEqual(before)
  })

  it("cannot be written directly by any signed-in user, their own workspace included", async () => {
    const insert = await alice.client.from("public_profile_links").insert({
      workspace_id: alice.workspaceId,
      public_profile_id: profileId,
      position: 7,
      url: "https://sneaky.example/",
    })
    expect(insert.error?.code).toBe(RLS_DENIED)

    const update = await alice.client
      .from("public_profile_links")
      .update({ url: "https://sneaky.example/" })
      .eq("public_profile_id", profileId)
    expect(update.error?.code).toBe(RLS_DENIED)

    const remove = await alice.client
      .from("public_profile_links")
      .delete()
      .eq("public_profile_id", profileId)
    expect(remove.error?.code).toBe(RLS_DENIED)
    expect(await liveLinks(profileId)).toHaveLength(2)
  })

  it("disappear from the public web with the profile, and stay visible to its own members", async () => {
    await alice.client
      .from("public_profiles")
      .update({ status: "draft", published_at: null })
      .eq("id", profileId)

    const { data: anon } = await anonClient()
      .from("public_profile_links")
      .select("url")
      .eq("public_profile_id", profileId)
    expect(anon).toEqual([])

    const { data: stranger } = await bob.client
      .from("public_profile_links")
      .select("url")
      .eq("public_profile_id", profileId)
    expect(stranger).toEqual([])

    const { data: own } = await alice.client
      .from("public_profile_links")
      .select("url")
      .eq("public_profile_id", profileId)
    expect(own).toHaveLength(2)
  })

  it("clears the retired link columns on publish, so a removed link is not left readable", async () => {
    await adminClient()
      .from("public_profiles")
      .update({ website_url: "https://old.example/", instagram_url: null, behance_url: null })
      .eq("id", profileId)
    const { error } = await publish(alice, profileId, { ...base, links: [] })
    expect(error).toBeNull()
    const { data } = await adminClient()
      .from("public_profiles")
      .select("website_url, instagram_url, behance_url")
      .eq("id", profileId)
      .single()
    expect(data).toEqual({ website_url: null, instagram_url: null, behance_url: null })
    expect(await liveLinks(profileId)).toEqual([])
  })

  /**
   * A publication recorded before 20260913030000 carries the three retired
   * keys and no `links`. The migration copied those values into the links
   * table, so republishing the same links must be a no-op.
   */
  it("counts a publication from before links existed as unchanged", async () => {
    const legacyLinks = [
      { url: "https://legacy.example/", label: "" },
      { url: "https://www.instagram.com/legacy/", label: "" },
    ]
    await publish(alice, profileId, { ...base, links: legacyLinks })
    const admin = adminClient()
    const { data: latest } = await admin
      .from("public_profile_publications")
      .select("snapshot, draft_updated_at, workspace_id, handle")
      .eq("public_profile_id", profileId)
      .order("published_at", { ascending: false })
      .limit(1)
      .single()
    const snapshot = { ...(latest!.snapshot as Record<string, unknown>) }
    delete snapshot.links
    delete snapshot.about
    delete snapshot.city
    delete snapshot.country_code
    snapshot.website_url = "https://legacy.example/"
    snapshot.instagram_url = "https://www.instagram.com/legacy/"
    snapshot.behance_url = null
    const { error: insertError } = await admin.from("public_profile_publications").insert({
      public_profile_id: profileId,
      workspace_id: latest!.workspace_id,
      handle: latest!.handle,
      draft_updated_at: latest!.draft_updated_at,
      snapshot: snapshot as Json,
      published_at: new Date(Date.now() + 60_000).toISOString(),
    })
    expect(insertError).toBeNull()

    const before = await publicationCount(profileId)
    const { data, error } = await publish(alice, profileId, { ...base, links: legacyLinks })
    expect(error).toBeNull()
    expect(data).toMatchObject({ outcome: "unchanged" })
    expect(await publicationCount(profileId)).toBe(before)
  })
})

// ---------------------------------------------------------------------------

describe("location and About", () => {
  let profileId: string
  const handle = `place-${suffix}`
  const base = { handle, display_name: "Place Studio", links: [] }

  async function live() {
    const { data } = await adminClient()
      .from("public_profiles")
      .select("city, country_code, location, about")
      .eq("id", profileId)
      .single()
    return data
  }

  beforeAll(async () => {
    profileId = await profileFor(carol, handle, "Place Studio")
    // A profile from before city and country: free text only.
    await adminClient()
      .from("public_profiles")
      .update({ location: "Brooklyn, New York" })
      .eq("id", profileId)
  })

  it("keeps a legacy location through a publish that does not replace it", async () => {
    const { error } = await publish(carol, profileId, {
      ...base,
      location: "Brooklyn, New York",
      about: "A studio.",
    })
    expect(error).toBeNull()
    expect(await live()).toEqual({
      city: null,
      country_code: null,
      location: "Brooklyn, New York",
      about: "A studio.",
    })
    // Signed out, too: nothing about the legacy value became private.
    const { data } = await anonClient()
      .from("public_profiles")
      .select("location")
      .eq("id", profileId)
      .single()
    expect(data?.location).toBe("Brooklyn, New York")
  })

  it("publishes a city and country, which retires the legacy text", async () => {
    const { error } = await publish(carol, profileId, {
      ...base,
      city: "Brooklyn",
      country_code: "US",
      location: "",
      about: "A studio.",
    })
    expect(error).toBeNull()
    expect(await live()).toEqual({
      city: "Brooklyn",
      country_code: "US",
      location: null,
      about: "A studio.",
    })
  })

  it.each([
    [{ city: "Paris", country_code: "" }],
    [{ city: "", country_code: "usa" }],
    [{ city: "", country_code: "us" }],
    [{ city: "x".repeat(81), country_code: "FR" }],
    [{ about: "x".repeat(2001) }],
  ])("refuses a location or About the columns do not allow, changing nothing: %j", async (bad) => {
    const before = await live()
    const { error } = await publish(carol, profileId, {
      ...base,
      city: "Brooklyn",
      country_code: "US",
      about: "A studio.",
      ...bad,
    })
    expect(error?.code).toBe("23514")
    expect(await live()).toEqual(before)
  })
})

// ---------------------------------------------------------------------------

describe("publish all products on the profile", () => {
  let profileId: string
  let bobProfileId: string
  const handle = `all-${suffix}`
  const product: Record<"shown" | "hidden" | "unarranged" | "archived", string> = {
    shown: "",
    hidden: "",
    unarranged: "",
    archived: "",
  }
  let bobProduct: string
  let listingId: string

  async function makeProduct(actor: Actor, name: string, archived = false): Promise<string> {
    const { data, error } = await actor.client
      .from("products")
      .insert({
        workspace_id: actor.workspaceId,
        name,
        slug: `${name.toLowerCase().replace(/\s+/g, "-")}-${suffix}`,
        product_type: "template",
        archived_at: archived ? new Date().toISOString() : null,
      })
      .select("id")
      .single()
    if (error) throw new Error(`product: ${error.message}`)
    return data.id
  }

  async function livePages(id: string) {
    const { data } = await adminClient()
      .from("public_product_pages")
      .select("product_id, display_order")
      .eq("public_profile_id", id)
      .eq("status", "published")
      .order("display_order")
    return (data ?? []).map((row) => row.product_id)
  }

  async function draft() {
    const { data } = await adminClient()
      .from("public_profile_drafts")
      .select("products, revision")
      .eq("public_profile_id", profileId)
      .single()
    return data!
  }

  function publishAll(actor: Actor | "anon", id: string, ids: string[]) {
    const client = actor === "anon" ? anonClient() : actor.client
    return client.rpc("publish_all_profile_products", {
      p_public_profile_id: id,
      p_product_ids: ids,
    })
  }

  beforeAll(async () => {
    profileId = await profileFor(dave, handle, "All Studio")
    product.shown = await makeProduct(dave, "Shown")
    product.hidden = await makeProduct(dave, "Hidden")
    product.unarranged = await makeProduct(dave, "Unarranged")
    product.archived = await makeProduct(dave, "Archived", true)
    bobProfileId = await profileFor(bob, `bob-all-${suffix}`, "Bob All")
    bobProduct = await makeProduct(bob, "Bobs")

    // A listing on one of dave's products, to prove nothing here touches it.
    const admin = adminClient()
    const { data: channel } = await admin
      .from("channels")
      .select("id")
      .eq("key", "mock_api")
      .single()
    const { data: connection, error: connectionError } = await admin
      .from("channel_connections")
      .insert({
        workspace_id: dave.workspaceId,
        channel_id: channel!.id,
        external_account_id: `store-${suffix}`,
        status: "active",
      })
      .select("id")
      .single()
    if (connectionError) throw connectionError
    const { data: listing, error: listingError } = await admin
      .from("channel_listings")
      .insert({
        workspace_id: dave.workspaceId,
        product_id: product.hidden,
        channel_id: channel!.id,
        channel_connection_id: connection!.id,
        title: "Hidden",
        status: "draft",
        status_source: "self_reported",
        external_listing_id: `store-${suffix}`,
      })
      .select("id")
      .single()
    if (listingError) throw listingError
    listingId = listing!.id
  })

  it("refuses a profile that is not published, changing nothing", async () => {
    const { error } = await publishAll(dave, profileId, [product.hidden])
    expect(error?.code).toBe("PT412")
    expect(await livePages(profileId)).toEqual([])
  })

  it("refuses a signed-out caller and a member of another workspace", async () => {
    // Publish the profile with one product shown and one arranged but hidden.
    const { error } = await publish(
      dave,
      profileId,
      { handle, display_name: "All Studio", links: [] },
      [product.shown],
      [
        { productId: product.shown, visible: true },
        { productId: product.hidden, visible: false },
      ],
    )
    expect(error).toBeNull()

    expect((await publishAll("anon", profileId, [product.hidden])).error?.code).toBe(RLS_DENIED)
    expect((await publishAll(bob, profileId, [product.hidden])).error?.code).toBe(RLS_DENIED)
    expect(await livePages(profileId)).toEqual([product.shown])
  })

  it("never publishes another workspace's product, even onto the caller's own profile", async () => {
    await publish(bob, bobProfileId, {
      handle: `bob-all-${suffix}`,
      display_name: "Bob All",
      links: [],
    })
    const { error } = await publishAll(bob, bobProfileId, [product.hidden])
    expect(error?.code).toBe(RLS_DENIED)
    const { error: mixed } = await publishAll(dave, profileId, [product.hidden, bobProduct])
    expect(mixed?.code).toBe(RLS_DENIED)
    expect(await livePages(profileId)).toEqual([product.shown])
    expect(await livePages(bobProfileId)).toEqual([])
  })

  it("refuses an archived product", async () => {
    const { error } = await publishAll(dave, profileId, [product.archived])
    expect(error?.code).toBe(RLS_DENIED)
    expect(await livePages(profileId)).toEqual([product.shown])
  })

  it("publishes the named products in the draft's arranged order, and records it", async () => {
    const before = await draft()
    const publications = await publicationCount(profileId)
    const { data: listingBefore } = await adminClient()
      .from("channel_listings")
      .select("*")
      .eq("id", listingId)
      .single()

    const { data, error } = await publishAll(dave, profileId, [product.unarranged, product.hidden])
    expect(error).toBeNull()
    expect(data).toMatchObject({ outcome: "published", published_count: 2 })

    // The draft's order where it has one, then the product it never arranged.
    expect(await livePages(profileId)).toEqual([product.shown, product.hidden, product.unarranged])
    const after = await draft()
    expect(after.products).toEqual([
      { productId: product.shown, visible: true },
      { productId: product.hidden, visible: true },
      { productId: product.unarranged, visible: true },
    ])
    expect(after.revision).toBe(before.revision + 1)
    expect(await publicationCount(profileId)).toBe(publications + 1)

    // The publication says what is live, for the builder's "no changes" check.
    const { data: latest } = await adminClient()
      .from("public_profile_publications")
      .select("snapshot")
      .eq("public_profile_id", profileId)
      .order("published_at", { ascending: false })
      .limit(1)
      .single()
    expect((latest!.snapshot as { product_ids: string[] }).product_ids).toEqual([
      product.shown,
      product.hidden,
      product.unarranged,
    ])

    // Visible to a stranger now, through the existing public gate.
    const { data: seen } = await anonClient()
      .from("public_product_pages")
      .select("product_id")
      .eq("public_profile_id", profileId)
    expect(seen?.map((row) => row.product_id).sort()).toEqual(
      [product.shown, product.hidden, product.unarranged].sort(),
    )

    // Public Fanwise visibility only: the listing is byte-for-byte the same.
    const { data: listingAfter } = await adminClient()
      .from("channel_listings")
      .select("*")
      .eq("id", listingId)
      .single()
    expect(listingAfter).toEqual(listingBefore)
  })

  it("is idempotent: a second press changes nothing and records nothing", async () => {
    const before = await draft()
    const publications = await publicationCount(profileId)
    const { data, error } = await publishAll(dave, profileId, [product.unarranged, product.hidden])
    expect(error).toBeNull()
    expect(data).toMatchObject({ outcome: "unchanged", published_count: 0 })
    expect(await draft()).toEqual(before)
    expect(await publicationCount(profileId)).toBe(publications)
  })

  it("leaves the per-product choice working: the builder can hide one again", async () => {
    const { error } = await publish(
      dave,
      profileId,
      { handle, display_name: "All Studio", links: [] },
      [product.shown, product.unarranged],
      [
        { productId: product.shown, visible: true },
        { productId: product.hidden, visible: false },
        { productId: product.unarranged, visible: true },
      ],
    )
    expect(error).toBeNull()
    expect(await livePages(profileId)).toEqual([product.shown, product.unarranged])
  })
})
