import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { profileAnalyticsSchema } from "@/lib/public/analytics"
import {
  RLS_DENIED,
  adminClient,
  anonClient,
  createActor,
  destroyActor,
  type Actor,
} from "./harness"

/**
 * The page-view log and the numbers read from it (migration 20260923120000).
 *
 * Held from the outside, over PostgREST, as each role a browser can be:
 *
 *   1. Nobody writes a view but the service role. `anon` and `authenticated`
 *      are refused outright, because the table is the kind anybody on the
 *      internet would fill if they could.
 *   2. A workspace reads its own views and nobody else's.
 *   3. public_profile_analytics() counts what it should, in the right window,
 *      and — being security invoker — counts nothing of another workspace's,
 *      answering zeros rather than an error or the other creator's numbers.
 */

let alice: Actor
let bob: Actor
let alice_: Seed
let bob_: Seed
let channelId: string

interface Seed {
  profileId: string
  pageId: string
}

async function seed(actor: Actor, handle: string): Promise<Seed> {
  const { data: profile, error: profileError } = await actor.client
    .from("public_profiles")
    .insert({ workspace_id: actor.workspaceId, handle, display_name: "Northline Studio" })
    .select("id")
    .single()
  if (profileError) throw new Error(`profile: ${profileError.message}`)

  const { data: product, error: productError } = await actor.client
    .from("products")
    .insert({
      workspace_id: actor.workspaceId,
      name: "Aster Grotesk",
      slug: `${handle}-aster`,
      product_type: "font",
      canonical_title: "Aster Grotesk",
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
      slug: "aster",
    })
    .select("id")
    .single()
  if (pageError) throw new Error(`page: ${pageError.message}`)

  return { profileId: profile.id, pageId: page.id }
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

beforeAll(async () => {
  alice = await createActor("pv-alice")
  bob = await createActor("pv-bob")
  alice_ = await seed(alice, `pv-alice-${Date.now()}`)
  bob_ = await seed(bob, `pv-bob-${Date.now()}`)

  const admin = adminClient()
  channelId = (await admin.from("channels").select("id").eq("key", "mock_api").single()).data!.id

  const view = (actor: Actor, s: Seed, n: number, page: boolean, referrer: string | null) => ({
    workspace_id: actor.workspaceId,
    public_profile_id: s.profileId,
    public_product_page_id: page ? s.pageId : null,
    occurred_at: daysAgo(n),
    referrer_host: referrer,
  })

  const { error } = await admin.from("public_page_views").insert([
    // Alice, inside a 7-day window: three profile views, two product views.
    view(alice, alice_, 0, false, "instagram.com"),
    view(alice, alice_, 0, false, "instagram.com"),
    view(alice, alice_, 3, false, null),
    view(alice, alice_, 1, true, null),
    view(alice, alice_, 2, true, "google.com"),
    // The seven days before: one profile view.
    view(alice, alice_, 9, false, null),
    // Outside both: never counted for a 7-day window.
    view(alice, alice_, 30, false, null),
    // Bob, who alice must never see.
    view(bob, bob_, 0, false, "bob.example"),
  ])
  if (error) throw new Error(`views: ${error.message}`)

  const clicks = await admin.from("public_outbound_clicks").insert({
    workspace_id: alice.workspaceId,
    public_profile_id: alice_.profileId,
    public_product_page_id: alice_.pageId,
    channel_id: channelId,
    occurred_at: daysAgo(1),
  })
  if (clicks.error) throw new Error(`clicks: ${clicks.error.message}`)
})

afterAll(async () => {
  await destroyActor(alice)
  await destroyActor(bob)
})

describe("nobody but the service role writes a view", () => {
  it("refuses anon, for reading and for writing", async () => {
    const read = await anonClient().from("public_page_views").select("id")
    expect(read.error?.code).toBe(RLS_DENIED)
    const write = await anonClient().from("public_page_views").insert({
      workspace_id: alice.workspaceId,
      public_profile_id: alice_.profileId,
    })
    expect(write.error?.code).toBe(RLS_DENIED)
  })

  it("refuses a signed-in member writing to their own workspace", async () => {
    const { error } = await alice.client.from("public_page_views").insert({
      workspace_id: alice.workspaceId,
      public_profile_id: alice_.profileId,
    })
    expect(error?.code).toBe(RLS_DENIED)
  })
})

describe("workspace A cannot reach workspace B's views", () => {
  it("alice reads her own views and none of bob's", async () => {
    const { data } = await alice.client.from("public_page_views").select("public_profile_id")
    expect(data?.length).toBe(7)
    expect(data?.every((row) => row.public_profile_id === alice_.profileId)).toBe(true)
  })

  it("asking for bob's numbers answers zeros, not bob's numbers", async () => {
    const { data, error } = await alice.client.rpc("public_profile_analytics", {
      p_public_profile_id: bob_.profileId,
      p_days: 7,
    })
    expect(error).toBeNull()
    const numbers = profileAnalyticsSchema.parse(data)
    expect(numbers.profileViews).toBe(0)
    expect(numbers.referrers).toEqual([])
  })
})

describe("public_profile_analytics()", () => {
  it("counts the window, the window before it, and nothing older", async () => {
    const { data, error } = await alice.client.rpc("public_profile_analytics", {
      p_public_profile_id: alice_.profileId,
      p_days: 7,
    })
    expect(error).toBeNull()
    const numbers = profileAnalyticsSchema.parse(data)

    expect(numbers.days).toBe(7)
    expect(numbers.profileViews).toBe(3)
    expect(numbers.productViews).toBe(2)
    expect(numbers.outboundClicks).toBe(1)
    expect(numbers.previousProfileViews).toBe(1)
    expect(numbers.previousProductViews).toBe(0)

    // One entry per day, the series summing to the totals.
    expect(numbers.daily).toHaveLength(7)
    const sum = numbers.daily.reduce((n, d) => n + d.profileViews + d.productViews, 0)
    expect(sum).toBe(5)

    expect(numbers.products).toEqual([
      { slug: "aster", title: "Aster Grotesk", views: 2, clicks: 1 },
    ])
    expect(numbers.referrers[0]).toEqual({ host: "instagram.com", views: 2 })
    expect(numbers.channels).toHaveLength(1)
    expect(numbers.channels[0]!.clicks).toBe(1)
  })

  it("clamps an out-of-range period instead of failing", async () => {
    const { data, error } = await alice.client.rpc("public_profile_analytics", {
      p_public_profile_id: alice_.profileId,
      p_days: 10_000,
    })
    expect(error).toBeNull()
    expect(profileAnalyticsSchema.parse(data).days).toBe(365)
  })
})
