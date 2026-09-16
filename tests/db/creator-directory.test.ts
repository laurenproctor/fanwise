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
 * The creator directory at /creators, from the outside (20260914100000).
 *
 * Every visibility assertion is made as `anon`, the role the directory renders
 * as. The views are `security_invoker`, so these tests are really about the
 * RLS beneath them showing through unchanged: who may appear, what counts
 * toward a creator's products, and that nobody but Fanwise can feature anyone.
 */

let alice: Actor
let bob: Actor
let aliceProfileId: string
let bobProfileId: string
const products: Record<string, { productId: string; pageId: string }> = {}
const stamp = Date.now().toString(36)

const anon = () => anonClient()

async function createProfile(actor: Actor, handle: string, displayName: string) {
  const { data, error } = await actor.client
    .from("public_profiles")
    .insert({
      workspace_id: actor.workspaceId,
      handle,
      display_name: displayName,
      short_bio: "Independent type for expressive brands.",
      city: "Lisbon",
      country_code: "PT",
    })
    .select("id")
    .single()
  if (error) throw new Error(`profile: ${error.message}`)
  return data.id
}

async function createProductPage(
  actor: Actor,
  profileId: string,
  slug: string,
  title: string,
  productType: "font" | "template",
) {
  const { data: product, error: productError } = await actor.client
    .from("products")
    .insert({
      workspace_id: actor.workspaceId,
      name: title,
      slug,
      product_type: productType,
      canonical_title: title,
    })
    .select("id")
    .single()
  if (productError) throw new Error(`product: ${productError.message}`)

  const { data: page, error: pageError } = await actor.client
    .from("public_product_pages")
    .insert({
      workspace_id: actor.workspaceId,
      public_profile_id: profileId,
      product_id: product.id,
      slug,
    })
    .select("id")
    .single()
  if (pageError) throw new Error(`page: ${pageError.message}`)

  products[slug] = { productId: product.id, pageId: page.id }
}

async function setStatus(
  actor: Actor,
  table: "public_profiles" | "public_product_pages",
  id: string,
  published: boolean,
) {
  const { error } = await actor.client
    .from(table)
    .update({
      status: published ? "published" : "draft",
      published_at: published ? new Date().toISOString() : null,
    })
    .eq("id", id)
  if (error) throw new Error(`${table} status: ${error.message}`)
}

async function directoryRow(profileId: string) {
  const { data, error } = await anon()
    .from("public_creator_directory")
    .select("id, product_count, previews, product_types, search_text, featured_rank")
    .eq("id", profileId)
    .maybeSingle()
  expect(error).toBeNull()
  return data
}

beforeAll(async () => {
  alice = await createActor("dir-alice")
  bob = await createActor("dir-bob")

  aliceProfileId = await createProfile(alice, `dir-alice-${stamp}`, "Mina Park")
  await createProductPage(alice, aliceProfileId, "aster-grotesk", "Aster Grotesk", "font")
  await createProductPage(alice, aliceProfileId, "secret-draft", "Unreleased Serif", "font")
  await createProductPage(alice, aliceProfileId, "brand-kit", "Brand Kit", "template")

  bobProfileId = await createProfile(bob, `dir-bob-${stamp}`, "Omar Sayeed")
  await createProductPage(bob, bobProfileId, "bob-grotesk", "Bob Grotesk", "font")
})

afterAll(async () => {
  const admin = adminClient()
  await admin
    .from("public_featured_profiles")
    .delete()
    .in("public_profile_id", [aliceProfileId, bobProfileId])
  if (alice) await destroyActor(alice)
  if (bob) await destroyActor(bob)
})

describe("who appears in the directory", () => {
  it("a draft profile does not, even with a published product page", async () => {
    await setStatus(alice, "public_product_pages", products["aster-grotesk"]!.pageId, true)
    expect(await directoryRow(aliceProfileId)).toBeNull()
  })

  it("a published profile with no published product does not", async () => {
    await setStatus(bob, "public_profiles", bobProfileId, true)
    expect(await directoryRow(bobProfileId)).toBeNull()
  })

  it("a published profile with a published product does", async () => {
    await setStatus(alice, "public_profiles", aliceProfileId, true)
    const row = await directoryRow(aliceProfileId)
    expect(row?.product_count).toBe(1)
    expect(row?.previews).toEqual([
      expect.objectContaining({
        slug: "aster-grotesk",
        title: "Aster Grotesk",
        coverAssetId: null,
      }),
    ])
  })

  it("counts, previews and searches published pages only", async () => {
    await setStatus(alice, "public_product_pages", products["brand-kit"]!.pageId, true)
    const row = await directoryRow(aliceProfileId)

    expect(row?.product_count).toBe(2)
    expect(row?.product_types).toEqual(["font", "template"])
    const slugs = (row?.previews as Array<{ slug: string }>).map((p) => p.slug)
    expect(slugs).not.toContain("secret-draft")
    // The draft's title must not be findable: a search is a way to read.
    expect(row?.search_text).toContain("aster grotesk")
    expect(row?.search_text).not.toContain("unreleased")
  })

  it("an archived product leaves the directory, its count and every other public read", async () => {
    const { productId } = products["brand-kit"]!
    const { error } = await adminClient()
      .from("products")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", productId)
    expect(error).toBeNull()

    const row = await directoryRow(aliceProfileId)
    expect(row?.product_count).toBe(1)
    expect(row?.product_types).toEqual(["font"])

    const { data: product } = await anon().from("products").select("id").eq("id", productId)
    expect(product).toEqual([])

    const { data: types } = await anon()
      .from("public_creator_product_types")
      .select("product_type, product_count")
      .eq("public_profile_id", aliceProfileId)
    expect(types).toEqual([{ product_type: "font", product_count: 1 }])
  })

  it("unpublishing the profile removes the creator and their places", async () => {
    await setStatus(alice, "public_profiles", aliceProfileId, false)
    expect(await directoryRow(aliceProfileId)).toBeNull()

    const { data: types } = await anon()
      .from("public_creator_product_types")
      .select("product_type")
      .eq("public_profile_id", aliceProfileId)
    expect(types).toEqual([])

    await setStatus(alice, "public_profiles", aliceProfileId, true)
    const { data: places } = await anon()
      .from("public_creator_locations")
      .select("country_code, city")
      .eq("country_code", "PT")
    expect(places).toContainEqual({ country_code: "PT", city: "Lisbon" })
  })

  it("is not readable as a signed-in member, whose own drafts RLS would let through", async () => {
    const { error } = await alice.client.from("public_creator_directory").select("id")
    expect(error?.code).toBe(RLS_DENIED)
  })
})

describe("featuring is editorial", () => {
  it("a creator cannot feature themselves", async () => {
    const { error } = await alice.client
      .from("public_featured_profiles")
      .insert({ public_profile_id: aliceProfileId, rank: 900 })
    expect(error?.code).toBe(RLS_DENIED)
  })

  it("nor can a visitor", async () => {
    const { error } = await anon()
      .from("public_featured_profiles")
      .insert({ public_profile_id: aliceProfileId, rank: 901 })
    expect(error?.code).toBe(RLS_DENIED)
  })

  it("Fanwise can, and the rank reaches the directory", async () => {
    const { error } = await adminClient()
      .from("public_featured_profiles")
      .insert({ public_profile_id: aliceProfileId, rank: 902 })
    expect(error).toBeNull()
    expect((await directoryRow(aliceProfileId))?.featured_rank).toBe(902)
  })

  it("featuring grants no visibility: a featured draft stays hidden, row and all", async () => {
    await setStatus(alice, "public_profiles", aliceProfileId, false)

    expect(await directoryRow(aliceProfileId)).toBeNull()
    const { data } = await anon()
      .from("public_featured_profiles")
      .select("public_profile_id")
      .eq("public_profile_id", aliceProfileId)
    expect(data).toEqual([])

    await setStatus(alice, "public_profiles", aliceProfileId, true)
  })

  it("ranks are unique, so the section's order is never a tie", async () => {
    const { error } = await adminClient()
      .from("public_featured_profiles")
      .insert({ public_profile_id: bobProfileId, rank: 902 })
    expect(error?.code).toBe("23505")
  })
})

describe("the route namespace", () => {
  it("refuses a workspace slugged `creators`, which /creators would shadow", async () => {
    const { error } = await bob.client
      .from("workspaces")
      .update({ slug: "creators" })
      .eq("id", bob.workspaceId)
    expect(error?.code).toBe("23514")
  })
})
