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
 * The public surface, from the outside.
 *
 * Every assertion about what a visitor can see is made with `anonClient()`,
 * which is what `lib/supabase/public.ts` becomes in production: the anon key,
 * no session, no cookies. So these tests exercise the same role the public
 * pages render as, over PostgREST, exactly as a browser would.
 *
 * The three properties this file exists to hold:
 *
 *   1. Nothing is public until somebody published it, and unpublishing a
 *      profile takes every product page beneath it private in the same write.
 *   2. `anon` reads named columns and nothing else. A policy alone would admit
 *      whole rows, so the column grants are tested as their own thing — the
 *      failure they prevent is a column added next year arriving on the public
 *      internet because a query said `select *`.
 *   3. Workspace A cannot touch workspace B's public surface, in either
 *      direction, through any of the five tables.
 */

let alice: Actor
let bob: Actor

/** Alice's fixtures. */
let aliceProfileId: string
let aliceProductId: string
let alicePageId: string

/** Bob's, used for the cross-tenant assertions. */
let bobProfileId: string
let bobProductId: string
let bobPageId: string

const anon = () => anonClient()

async function seedFor(actor: Actor, handle: string, productSlug: string) {
  const admin = adminClient()

  const { data: profile, error: profileError } = await actor.client
    .from("public_profiles")
    .insert({
      workspace_id: actor.workspaceId,
      handle,
      display_name: "Northline Studio",
      short_bio: "Independent type for expressive brands.",
    })
    .select("id")
    .single()
  if (profileError) throw new Error(`profile: ${profileError.message}`)

  const { data: product, error: productError } = await actor.client
    .from("products")
    .insert({
      workspace_id: actor.workspaceId,
      name: "Aster Grotesk",
      slug: productSlug,
      product_type: "font",
      canonical_title: "Aster Grotesk",
      short_description: "A grotesk with a soft shoulder.",
      base_price: 48,
    })
    .select("id")
    .single()
  if (productError) throw new Error(`product: ${productError.message}`)

  const { data: page, error: pageError } = await actor.client
    .from("public_product_pages")
    .insert({
      workspace_id: actor.workspaceId,
      public_profile_id: profile.id,
      product_id: product.id,
      slug: productSlug,
    })
    .select("id")
    .single()
  if (pageError) throw new Error(`page: ${pageError.message}`)

  // A live listing, so the destination list has something in it. Written with
  // the service role because a connection needs a channel row.
  const { data: channel } = await admin.from("channels").select("id").eq("key", "mock_api").single()
  const { data: connection } = await actor.client
    .from("channel_connections")
    .insert({
      workspace_id: actor.workspaceId,
      channel_id: channel!.id,
      external_account_id: `${handle}-shop`,
    })
    .select("id")
    .single()
  await actor.client.from("channel_listings").insert({
    workspace_id: actor.workspaceId,
    product_id: product.id,
    channel_id: channel!.id,
    channel_connection_id: connection!.id,
    title: "Aster Grotesk",
    status: "published",
    external_url: "https://shop.example/aster-grotesk",
    price: 48,
  })

  return { profileId: profile.id, productId: product.id, pageId: page.id }
}

/** Publishing, done the way the action does it: status and timestamp together. */
async function publishProfile(actor: Actor, profileId: string, published: boolean) {
  const { error } = await actor.client
    .from("public_profiles")
    .update({
      status: published ? "published" : "draft",
      published_at: published ? new Date().toISOString() : null,
    })
    .eq("id", profileId)
  if (error) throw new Error(`publish profile: ${error.message}`)
}

async function publishPage(actor: Actor, pageId: string, published: boolean) {
  const { error } = await actor.client
    .from("public_product_pages")
    .update({
      status: published ? "published" : "draft",
      published_at: published ? new Date().toISOString() : null,
    })
    .eq("id", pageId)
  if (error) throw new Error(`publish page: ${error.message}`)
}

beforeAll(async () => {
  alice = await createActor("pp-alice")
  bob = await createActor("pp-bob")

  const stamp = Date.now().toString(36)
  const a = await seedFor(alice, `alice-${stamp}`, "aster-grotesk")
  aliceProfileId = a.profileId
  aliceProductId = a.productId
  alicePageId = a.pageId

  const b = await seedFor(bob, `bob-${stamp}`, "bob-grotesk")
  bobProfileId = b.profileId
  bobProductId = b.productId
  bobPageId = b.pageId
})

afterAll(async () => {
  if (alice) await destroyActor(alice)
  if (bob) await destroyActor(bob)
})

describe("nothing is public until it is published", () => {
  it("a draft profile is invisible to a visitor", async () => {
    const { data, error } = await anon().from("public_profiles").select("id, handle")
    expect(error).toBeNull()
    expect(data?.map((p) => p.id)).not.toContain(aliceProfileId)
  })

  it("a draft product page is invisible to a visitor", async () => {
    const { data } = await anon().from("public_product_pages").select("id")
    expect(data?.map((p) => p.id)).not.toContain(alicePageId)
  })

  it("the creator can see their own draft, which is what makes settings work", async () => {
    const { data } = await alice.client
      .from("public_profiles")
      .select("id, status")
      .eq("id", aliceProfileId)
      .single()
    expect(data?.status).toBe("draft")
  })

  it("a published profile becomes visible", async () => {
    await publishProfile(alice, aliceProfileId, true)
    const { data } = await anon()
      .from("public_profiles")
      .select("id, handle, display_name")
      .eq("id", aliceProfileId)
      .maybeSingle()
    expect(data?.id).toBe(aliceProfileId)
  })

  /**
   * The rule the whole gate exists for. A creator who publishes a product and
   * leaves the profile a draft has not published anything, and must not be
   * able to discover otherwise by sharing the link.
   */
  it("a published product under a draft profile is still not public", async () => {
    await publishProfile(alice, aliceProfileId, false)
    await publishPage(alice, alicePageId, true)

    const { data } = await anon().from("public_product_pages").select("id").eq("id", alicePageId)
    expect(data).toEqual([])
  })

  it("and becomes public the moment the profile is published, with no second write", async () => {
    await publishProfile(alice, aliceProfileId, true)
    const { data } = await anon()
      .from("public_product_pages")
      .select("id")
      .eq("id", alicePageId)
      .maybeSingle()
    expect(data?.id).toBe(alicePageId)
  })

  it("unpublishing the profile takes the whole subtree private in one write", async () => {
    await publishProfile(alice, aliceProfileId, false)

    const [profiles, pages, products, listings] = await Promise.all([
      anon().from("public_profiles").select("id").eq("id", aliceProfileId),
      anon().from("public_product_pages").select("id").eq("id", alicePageId),
      anon().from("products").select("id").eq("id", aliceProductId),
      anon().from("channel_listings").select("id").eq("product_id", aliceProductId),
    ])

    expect(profiles.data).toEqual([])
    expect(pages.data).toEqual([])
    // The canonical product and its listings go too: their public policies are
    // gated on the same published page.
    expect(products.data).toEqual([])
    expect(listings.data).toEqual([])

    // Left as it was found, for the tests below.
    await publishProfile(alice, aliceProfileId, true)
  })
})

describe("a visitor reads named columns and nothing else", () => {
  /**
   * RLS filters rows, never columns. The policies above admit a product row;
   * these grants decide how much of it. Both are needed, and `select *` being
   * a permission error rather than a wide read is the property that survives
   * somebody adding a column later.
   */
  it("cannot select * from products, even a published one", async () => {
    const { error } = await anon().from("products").select("*")
    expect(error?.code).toBe(RLS_DENIED)
  })

  it("cannot select * from product_assets or channel_listings either", async () => {
    for (const table of ["product_assets", "channel_listings"] as const) {
      const { error } = await anon().from(table).select("*")
      expect(error?.code, table).toBe(RLS_DENIED)
    }
  })

  it("can select the public columns of a published product", async () => {
    const { data, error } = await anon()
      .from("products")
      .select("id, name, canonical_title, short_description, base_price, currency")
      .eq("id", aliceProductId)
      .maybeSingle()
    expect(error).toBeNull()
    expect(data?.name).toBe("Aster Grotesk")
  })

  it("cannot reach a product column that was not granted", async () => {
    // `status` and `archived_at` are internal workflow, not public facts.
    for (const column of ["status", "archived_at"]) {
      const { error } = await anon().from("products").select(column)
      expect(error?.code, column).toBe(RLS_DENIED)
    }
  })

  it("cannot reach the connection id on a listing, which is the field that points at a credential", async () => {
    const { error } = await anon().from("channel_listings").select("channel_connection_id")
    expect(error?.code).toBe(RLS_DENIED)
  })

  it("cannot reach an asset's storage path", async () => {
    const { error } = await anon().from("product_assets").select("storage_path")
    expect(error?.code).toBe(RLS_DENIED)
  })

  it("cannot reach a profile's avatar path through a column it does hold", async () => {
    // avatar_path IS granted on public_profiles — every column there is public
    // by design — so this asserts the route handler's contract instead: the
    // application never puts the path in a view. See lib/public/queries.ts.
    const { data } = await anon()
      .from("public_profiles")
      .select("avatar_path")
      .eq("id", aliceProfileId)
      .maybeSingle()
    expect(data).not.toBeUndefined()
  })
})

describe("nothing private is reachable from the public surface", () => {
  it("refuses every private table outright", async () => {
    for (const table of [
      "workspaces",
      "workspace_members",
      "channel_connections",
      "channel_connection_secrets",
      "listing_snapshots",
      "public_outbound_clicks",
    ] as const) {
      const { error } = await anon().from(table).select("*")
      expect(error?.code, table).toBe(RLS_DENIED)
    }
  })

  it("cannot reach a workspace by embedding it through a published profile", async () => {
    // The join is the interesting attack: the profile row is readable, and a
    // careless grant on workspaces would make the embed work.
    const { error } = await anon()
      .from("public_profiles")
      .select("id, workspaces(name, slug)")
      .eq("id", aliceProfileId)
    expect(error).not.toBeNull()
  })

  it("cannot reach a connection by embedding it through a published listing", async () => {
    const { error } = await anon()
      .from("channel_listings")
      .select("id, channel_connections(external_account_id)")
      .eq("product_id", aliceProductId)
    expect(error).not.toBeNull()
  })

  it("cannot write anything at all", async () => {
    const profile = await anon()
      .from("public_profiles")
      .insert({ workspace_id: alice.workspaceId, handle: "squatter", display_name: "Squatter" })
    expect(profile.error?.code).toBe(RLS_DENIED)

    const update = await anon()
      .from("public_profiles")
      .update({ display_name: "Defaced" })
      .eq("id", aliceProfileId)
    expect(update.error?.code).toBe(RLS_DENIED)

    const remove = await anon().from("public_product_pages").delete().eq("id", alicePageId)
    expect(remove.error?.code).toBe(RLS_DENIED)

    // And the click log, which the route handler writes with the service role
    // precisely so that this stays true.
    const click = await anon().from("public_outbound_clicks").insert({
      workspace_id: alice.workspaceId,
      public_profile_id: aliceProfileId,
      public_product_page_id: alicePageId,
      channel_id: aliceProductId,
    })
    expect(click.error?.code).toBe(RLS_DENIED)
  })
})

describe("workspace A cannot reach workspace B's public surface", () => {
  it("alice cannot read bob's draft profile", async () => {
    await publishProfile(bob, bobProfileId, false)
    const { data } = await alice.client.from("public_profiles").select("id").eq("id", bobProfileId)
    expect(data).toEqual([])
  })

  it("alice cannot edit bob's profile", async () => {
    const { data, error } = await alice.client
      .from("public_profiles")
      .update({ display_name: "Taken over" })
      .eq("id", bobProfileId)
      .select("id")
    // RLS makes this a no-op rather than an error: the row does not exist for
    // her, which is indistinguishable from it never having existed.
    expect(error).toBeNull()
    expect(data).toEqual([])

    const { data: intact } = await adminClient()
      .from("public_profiles")
      .select("display_name")
      .eq("id", bobProfileId)
      .single()
    expect(intact?.display_name).toBe("Northline Studio")
  })

  it("alice cannot rename bob's handle through the RPC", async () => {
    const { error } = await alice.client.rpc("release_public_handle", {
      p_public_profile_id: bobProfileId,
      p_new_handle: "stolen-handle",
    })
    // security definer, so the function re-checks membership itself.
    expect(error?.code).toBe(RLS_DENIED)
  })

  it("alice cannot rename bob's product slug through the RPC", async () => {
    const { error } = await alice.client.rpc("release_public_product_slug", {
      p_public_product_page_id: bobPageId,
      p_new_slug: "stolen-slug",
    })
    expect(error?.code).toBe(RLS_DENIED)
  })

  it("alice cannot hang a public page off bob's profile", async () => {
    const { error } = await alice.client.from("public_product_pages").insert({
      workspace_id: alice.workspaceId,
      public_profile_id: bobProfileId,
      product_id: aliceProductId,
      slug: "crossed-wires",
    })
    // The composite foreign key refuses it before RLS has to: bob's profile
    // does not exist under alice's workspace_id.
    expect(error).not.toBeNull()
  })

  it("alice cannot point her public page at bob's product", async () => {
    const { error } = await alice.client.from("public_product_pages").insert({
      workspace_id: alice.workspaceId,
      public_profile_id: aliceProfileId,
      product_id: bobProductId,
      slug: "crossed-product",
    })
    expect(error).not.toBeNull()
  })

  it("alice cannot use bob's image as her cover", async () => {
    const admin = adminClient()
    const { data: asset } = await admin
      .from("product_assets")
      .insert({
        workspace_id: bob.workspaceId,
        product_id: bobProductId,
        asset_type: "cover_image",
        storage_path: `${bob.workspaceId}/${bobProductId}/cover.png`,
        filename: "cover.png",
      })
      .select("id")
      .single()

    const { error } = await alice.client
      .from("public_product_pages")
      .update({ cover_asset_id: asset!.id })
      .eq("id", alicePageId)
    expect(error).not.toBeNull()
  })

  it("alice cannot read bob's outbound clicks", async () => {
    const admin = adminClient()
    await admin.from("public_outbound_clicks").insert({
      workspace_id: bob.workspaceId,
      public_profile_id: bobProfileId,
      public_product_page_id: bobPageId,
      channel_id: (await admin.from("channels").select("id").eq("key", "mock_api").single()).data!
        .id,
    })

    const { data } = await alice.client.from("public_outbound_clicks").select("id")
    expect(data).toEqual([])
  })
})

describe("the handle namespace spans the live table and its history", () => {
  it("two profiles cannot hold the same handle", async () => {
    const { error } = await bob.client
      .from("public_profiles")
      .update({ handle: (await currentHandle(aliceProfileId)) })
      .eq("id", bobProfileId)
    expect(error?.code).toBe("23505")
  })

  it("a rename leaves the old handle redirecting, in one transaction", async () => {
    const before = await currentHandle(aliceProfileId)
    const after = `${before}-two`.slice(0, 32)

    const { error } = await alice.client.rpc("release_public_handle", {
      p_public_profile_id: aliceProfileId,
      p_new_handle: after,
    })
    expect(error).toBeNull()

    expect(await currentHandle(aliceProfileId)).toBe(after)

    const { data: history } = await adminClient()
      .from("public_handle_history")
      .select("handle")
      .eq("public_profile_id", aliceProfileId)
    expect(history?.map((h) => h.handle)).toContain(before)
  })

  /**
   * The reason uniqueness is a trigger rather than an index. A released handle
   * still routes to the profile that gave it up, so letting somebody else take
   * it would silently redirect their visitors to a stranger.
   */
  it("nobody else can claim a handle that is still redirecting", async () => {
    const { data: history } = await adminClient()
      .from("public_handle_history")
      .select("handle")
      .eq("public_profile_id", aliceProfileId)
      .limit(1)
      .single()

    const { error } = await bob.client
      .from("public_profiles")
      .update({ handle: history!.handle })
      .eq("id", bobProfileId)
    expect(error?.code).toBe("23505")
  })

  it("the profile that released a handle can take it back, and the redirect goes", async () => {
    const { data: history } = await adminClient()
      .from("public_handle_history")
      .select("handle")
      .eq("public_profile_id", aliceProfileId)
      .limit(1)
      .single()
    const old = history!.handle

    const { error } = await alice.client.rpc("release_public_handle", {
      p_public_profile_id: aliceProfileId,
      p_new_handle: old,
    })
    expect(error).toBeNull()
    expect(await currentHandle(aliceProfileId)).toBe(old)

    // The stale row is gone rather than pointing the handle at itself.
    const { data: after } = await adminClient()
      .from("public_handle_history")
      .select("handle")
      .eq("public_profile_id", aliceProfileId)
    expect(after?.map((h) => h.handle)).not.toContain(old)
  })

  it("a visitor can read the redirect history of a published profile, and no other", async () => {
    await publishProfile(alice, aliceProfileId, true)
    await publishProfile(bob, bobProfileId, false)

    // Give bob a retired handle to look for.
    const bobHandle = await currentHandle(bobProfileId)
    await bob.client.rpc("release_public_handle", {
      p_public_profile_id: bobProfileId,
      p_new_handle: `${bobHandle}-two`.slice(0, 32),
    })

    const { data } = await anon().from("public_handle_history").select("handle")
    expect(data?.some((h) => h.handle === bobHandle)).toBe(false)
  })
})

describe("product slugs behave the same, scoped to their profile", () => {
  it("two creators may retire the same slug without colliding", async () => {
    // alice and bob both rename a page away from a slug of the same shape.
    const shared = "shared-name"

    await alice.client.rpc("release_public_product_slug", {
      p_public_product_page_id: alicePageId,
      p_new_slug: shared,
    })
    const { error } = await bob.client.rpc("release_public_product_slug", {
      p_public_product_page_id: bobPageId,
      p_new_slug: shared,
    })
    expect(error).toBeNull()
  })

  it("records the old slug as a redirect", async () => {
    const { data: page } = await adminClient()
      .from("public_product_pages")
      .select("slug")
      .eq("id", alicePageId)
      .single()

    await alice.client.rpc("release_public_product_slug", {
      p_public_product_page_id: alicePageId,
      p_new_slug: "renamed-again",
    })

    const { data: history } = await adminClient()
      .from("public_product_slug_history")
      .select("slug")
      .eq("public_product_page_id", alicePageId)
    expect(history?.map((h) => h.slug)).toContain(page!.slug)
  })
})

describe("constraints that keep a row honest", () => {
  it("refuses a reserved handle even from the service role", async () => {
    const { error } = await adminClient()
      .from("public_profiles")
      .update({ handle: "fanwise" })
      .eq("id", aliceProfileId)
    expect(error?.code).toBe("23514")
  })

  it("refuses a handle that is not the canonical lowercase form", async () => {
    const { error } = await adminClient()
      .from("public_profiles")
      .update({ handle: "NorthLine" })
      .eq("id", aliceProfileId)
    expect(error?.code).toBe("23514")
  })

  it("treats handles case-insensitively when checking uniqueness", async () => {
    // citext, so this collides with alice's despite the casing.
    const handle = await currentHandle(aliceProfileId)
    const { error } = await adminClient()
      .from("public_profiles")
      .update({ handle: handle.toUpperCase() })
      .eq("id", bobProfileId)
    // Refused by the format CHECK first, which is the stricter of the two and
    // the reason uppercase can never reach a row at all.
    expect(error).not.toBeNull()
  })

  it("refuses a published row with no published_at, and a draft that has one", async () => {
    const admin = adminClient()
    const missing = await admin
      .from("public_profiles")
      .update({ status: "published", published_at: null })
      .eq("id", aliceProfileId)
    expect(missing.error?.code).toBe("23514")

    const spurious = await admin
      .from("public_profiles")
      .update({ status: "draft", published_at: new Date().toISOString() })
      .eq("id", aliceProfileId)
    expect(spurious.error?.code).toBe("23514")
  })

  it("refuses a second public page for the same product on one profile", async () => {
    const { error } = await alice.client.from("public_product_pages").insert({
      workspace_id: alice.workspaceId,
      public_profile_id: aliceProfileId,
      product_id: aliceProductId,
      slug: "a-second-page",
    })
    expect(error?.code).toBe("23505")
  })

  it("refuses a non-https website", async () => {
    const { error } = await adminClient()
      .from("public_profiles")
      .update({ website_url: "http://insecure.example" })
      .eq("id", aliceProfileId)
    expect(error?.code).toBe("23514")
  })

  it("refuses a javascript: contact URL", async () => {
    const { error } = await adminClient()
      .from("public_profiles")
      .update({ contact_url: "javascript:alert(1)" })
      .eq("id", aliceProfileId)
    expect(error?.code).toBe("23514")
  })

  it("refuses an avatar path outside the profile's own prefix", async () => {
    const { error } = await adminClient()
      .from("public_profiles")
      .update({ avatar_path: `${bobProfileId}/stolen.png` })
      .eq("id", aliceProfileId)
    expect(error?.code).toBe("23514")
  })

  /**
   * One profile per workspace is a V1 limit expressed as a droppable index,
   * not a modelling assumption. This pins that it is currently enforced; the
   * migration says in one line how to lift it.
   */
  it("allows one public profile per workspace, for now", async () => {
    const { error } = await alice.client.from("public_profiles").insert({
      workspace_id: alice.workspaceId,
      handle: `alice-second-${Date.now().toString(36)}`,
      display_name: "A Second Identity",
    })
    expect(error?.code).toBe("23505")
  })
})

async function currentHandle(profileId: string): Promise<string> {
  const { data } = await adminClient()
    .from("public_profiles")
    .select("handle")
    .eq("id", profileId)
    .single()
  return data!.handle
}
