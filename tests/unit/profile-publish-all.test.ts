import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ProductCandidate } from "@/lib/public/product-arrangement"
import { confirmedAndEligible, planPublishAll } from "@/lib/public/publish-all"

/**
 * "Publish all products on my profile", below the browser.
 *
 * The database half (workspace scoping, archived products, a draft profile
 * refused, additive, idempotent, not one listing touched) is
 * tests/db/profile-storefront.test.ts. This file holds what the application
 * decides: who is eligible, what the action sends, and what the screen says.
 */

const pid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

function candidate(n: number, overrides: Partial<ProductCandidate> = {}): ProductCandidate {
  return {
    id: pid(n),
    slug: `product-${n}`,
    title: `Product ${n}`,
    typeLabel: "Template",
    imageUrl: null,
    eligibility: { eligible: true },
    existingOrder: null,
    ...overrides,
  }
}

const CANDIDATES = [
  candidate(1),
  candidate(2),
  candidate(3, { title: "Not Live Kit", eligibility: { eligible: false, reason: "not_live" } }),
  candidate(4, { eligibility: { eligible: false, reason: "archived" } }),
  candidate(5),
]

describe("the plan", () => {
  it("sorts products into ready, already shown, needing attention, and archived", () => {
    const plan = planPublishAll(CANDIDATES, new Set([pid(2)]))
    expect(plan.toPublish.map((c) => c.id)).toEqual([pid(1), pid(5)])
    expect(plan.alreadyShown.map((c) => c.id)).toEqual([pid(2)])
    expect(plan.needsAttention.map((c) => c.title)).toEqual(["Not Live Kit"])
    expect(plan.archivedCount).toBe(1)
  })

  it("has nothing to publish when every eligible product is already shown", () => {
    const plan = planPublishAll(CANDIDATES, new Set([pid(1), pid(2), pid(5)]))
    expect(plan.toPublish).toEqual([])
  })

  it("publishes only what was confirmed and is still eligible, and counts the rest", () => {
    const plan = planPublishAll(CANDIDATES, new Set([pid(2)]))
    expect(confirmedAndEligible([pid(1), pid(3), pid(9), pid(1)], plan)).toEqual({
      ids: [pid(1)],
      noLongerEligible: 2,
    })
  })
})

// ---------------------------------------------------------------------------
// The action
// ---------------------------------------------------------------------------

const rpc = vi.fn()
const revalidatePath = vi.fn()
let ctx: { profile: { id: string; handle: string; status: "draft" | "published" } } | null
let candidates: ProductCandidate[]
let live: Set<string>
const tablesTouched: string[] = []

vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (...a: unknown[]) => rpc(...a),
    from: (table: string) => {
      tablesTouched.push(table)
      throw new Error(`unexpected direct table access: ${table}`)
    },
  }),
}))
vi.mock("@/lib/public/draft-store", () => ({ loadBuilderContext: async () => ctx }))
vi.mock("@/lib/public/product-candidates", () => ({
  loadProductCandidates: async () => candidates,
}))
vi.mock("@/lib/public/workspace-queries", () => ({ loadLiveProductIds: async () => live }))
vi.mock("@/lib/public/publish-state", () => ({ loadPublishState: async () => null }))
vi.mock("@/lib/public/avatars", () => ({ removeAvatars: async () => {} }))

const { publishAllProductsAction } = await import("@/lib/public/publish-actions")

beforeEach(() => {
  rpc.mockReset()
  revalidatePath.mockReset()
  tablesTouched.length = 0
  ctx = { profile: { id: "profile-1", handle: "studio", status: "published" } }
  candidates = CANDIDATES
  live = new Set([pid(2)])
})

describe("publishing all through the action", () => {
  it("sends only the confirmed, still-eligible ids for the caller's own profile, and nothing else", async () => {
    rpc.mockResolvedValue({ data: { outcome: "published", published_count: 2 }, error: null })
    const result = await publishAllProductsAction("studio", { productIds: [pid(1), pid(5)] })
    expect(result).toEqual({
      ok: true,
      outcome: "published",
      publishedCount: 2,
      noLongerEligible: 0,
    })

    expect(rpc).toHaveBeenCalledTimes(1)
    const [name, args] = rpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(name).toBe("publish_all_profile_products")
    expect(args).toEqual({ p_public_profile_id: "profile-1", p_product_ids: [pid(1), pid(5)] })
    // No table written directly, and no channel operation named anywhere.
    expect(tablesTouched).toEqual([])
    expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/listing|channel|publication_run|workspace/i)
    // The profile's pages and the public route both refresh.
    const paths = revalidatePath.mock.calls.map((c) => c[0])
    expect(paths).toContain("/studio/profile")
    expect(paths).toContain("/profile/studio")
  })

  it("leaves out a product that stopped being eligible, and says how many", async () => {
    rpc.mockResolvedValue({ data: { outcome: "published", published_count: 1 }, error: null })
    const result = await publishAllProductsAction("studio", {
      productIds: [pid(1), pid(3), pid(4)],
    })
    expect((rpc.mock.calls[0]![1] as { p_product_ids: string[] }).p_product_ids).toEqual([pid(1)])
    expect(result).toMatchObject({ ok: true, noLongerEligible: 2 })
  })

  it("does not call the database for a profile that is not live", async () => {
    ctx = { profile: { id: "profile-1", handle: "studio", status: "draft" } }
    const result = await publishAllProductsAction("studio", { productIds: [pid(1)] })
    expect(result).toMatchObject({ ok: false, kind: "not_live" })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("does not call the database when nothing confirmed can be published", async () => {
    const result = await publishAllProductsAction("studio", { productIds: [pid(2), pid(3)] })
    expect(result).toMatchObject({ ok: false, kind: "nothing_to_publish" })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("refuses a workspace RLS does not resolve for the caller, and malformed input", async () => {
    ctx = null
    expect(await publishAllProductsAction("someone-else", { productIds: [pid(1)] })).toMatchObject({
      ok: false,
      kind: "failed",
    })
    ctx = { profile: { id: "profile-1", handle: "studio", status: "published" } }
    for (const input of [{}, { productIds: [] }, { productIds: ["not-a-uuid"] }, null]) {
      expect(await publishAllProductsAction("studio", input)).toMatchObject({ ok: false })
    }
    expect(rpc).not.toHaveBeenCalled()
  })

  it("is quiet when the database found nothing to change", async () => {
    rpc.mockResolvedValue({ data: { outcome: "unchanged", published_count: 0 }, error: null })
    const result = await publishAllProductsAction("studio", { productIds: [pid(1)] })
    expect(result).toMatchObject({ ok: true, outcome: "unchanged", publishedCount: 0 })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it.each([
    ["PT412", "not_live"],
    ["42501", "failed"],
    ["XX000", "failed"],
  ])("explains database refusal %s without leaking it", async (code, kind) => {
    rpc.mockResolvedValue({
      data: null,
      error: { code, message: "a product is not an eligible product of this workspace" },
    })
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const result = await publishAllProductsAction("studio", { productIds: [pid(1)] })
    spy.mockRestore()
    expect(result).toMatchObject({ ok: false, kind })
    expect(JSON.stringify(result)).not.toMatch(/eligible product of this workspace/)
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// The control
// ---------------------------------------------------------------------------

const { PublishAllProducts } = await import("@/app/[slug]/profile/publish-all-products")

function control(props: Partial<Parameters<typeof PublishAllProducts>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(PublishAllProducts, {
      workspaceSlug: "studio",
      profileLive: true,
      toPublish: [
        { id: pid(1), title: "Product 1", href: "/studio/product-1" },
        { id: pid(5), title: "Product 5", href: "/studio/product-5" },
      ],
      alreadyShownCount: 1,
      needsAttention: [
        {
          id: pid(3),
          title: "Not Live Kit",
          href: "/studio/product-3",
          reason: "Not live in a connected shop yet. Publish a listing first.",
        },
      ],
      archivedCount: 1,
      ...props,
    }),
  )
}

const textOf = (markup: string) =>
  markup
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")

describe("the publish-all control", () => {
  it("is labelled for what it does, and says it does not touch channels", () => {
    const markup = control()
    expect(markup).toMatch(/<button[^>]*>Publish all products on my profile<\/button>/)
    expect(textOf(markup)).toContain("doesn't publish anything to your channels")
  })

  it("confirms the number, the products, and the boundary before changing anything", () => {
    const dialog = /<dialog[\s\S]*<\/dialog>/.exec(control())![0]
    expect(dialog).toMatch(/aria-labelledby="[^"]+"/)
    expect(textOf(dialog)).toContain("Publish 2 products on your profile?")
    expect(textOf(dialog)).toContain("Product 1")
    expect(textOf(dialog)).toContain(
      "Nothing is published to your channels, and no listing changes.",
    )
    expect(dialog).toMatch(/<button[^>]*>Cancel<\/button>/)
    expect(dialog).toMatch(/<button[^>]*>Publish 2 products<\/button>/)
  })

  it("names every product it will leave out, with a way to fix it", () => {
    const text = textOf(control())
    expect(text).toContain("Not included, and why")
    expect(text).toContain("Not Live Kit")
    expect(text).toContain("Publish a listing first.")
    expect(control()).toContain('href="/studio/product-3"')
    expect(text).toContain("1 archived product is never shown")
  })

  it("is disabled when there is nothing to add", () => {
    const markup = control({ toPublish: [] })
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Publish all products on my profile/)
    expect(textOf(markup)).toContain("Every product that can be on your profile already is.")
  })

  it("is not offered for a profile that is not published, which points to the builder instead", () => {
    const markup = control({ profileLive: false })
    expect(markup).not.toContain("Publish all products on my profile")
    expect(markup).toContain('href="/studio/profile/builder/products"')
  })
})
