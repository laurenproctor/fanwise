import type { ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { arrange, type ProductCandidate } from "@/lib/public/product-arrangement"
import type { ProfileDraftFields } from "@/lib/public/profile-draft"
import {
  evaluateReadiness,
  issueHref,
  sameSnapshot,
  snapshotOf,
} from "@/lib/public/publish-readiness"
import type { PublicProductCard, PublicProfileView } from "@/lib/public/types"

/**
 * Step 3 and the public route, below the browser.
 *
 * The database half — atomic slug claims, idempotency, the stale-draft
 * refusal, hidden pages leaving the public web — is proven against Postgres in
 * tests/db/profile-publication.test.ts. This file holds the application half:
 * what counts as ready, what the publish action sends and how it explains a
 * refusal, and what the public page and its metadata are allowed to contain.
 */

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

const FIELDS: ProfileDraftFields = {
  handle: "Lauren Proctor",
  displayName: "Lauren Proctor",
  shortBio: "Design tools, templates, and resources for thoughtful brands.",
  website: "laurenproctor.com",
  instagram: "@laurenproctor",
  behance: "",
}

const pid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
function candidate(n: number, overrides: Partial<ProductCandidate> = {}): ProductCandidate {
  return {
    id: pid(n),
    title: `Product ${n}`,
    typeLabel: "Template",
    imageUrl: null,
    eligibility: { eligible: true },
    existingOrder: null,
    ...overrides,
  }
}

function readiness(overrides: Partial<Parameters<typeof evaluateReadiness>[0]> = {}) {
  const draftProducts = overrides.draftProducts ?? [
    { productId: pid(2), visible: true },
    { productId: pid(1), visible: true },
    { productId: pid(3), visible: false },
  ]
  return evaluateReadiness({
    fields: FIELDS,
    avatar: { path: null, resolvable: false },
    handleStatus: "available",
    draftProducts,
    rows: arrange(draftProducts, [candidate(1), candidate(2), candidate(3)]),
    ...overrides,
  })
}

describe("publish readiness", () => {
  it("is ready, and plans canonical values and the shown products in order", () => {
    const result = readiness()
    expect(result.ready).toBe(true)
    expect(result.plan).toEqual({
      values: {
        handle: "lauren-proctor",
        display_name: "Lauren Proctor",
        short_bio: "Design tools, templates, and resources for thoughtful brands.",
        website_url: "https://laurenproctor.com/",
        instagram_url: "https://www.instagram.com/laurenproctor/",
        behance_url: "",
      },
      productIds: [pid(2), pid(1)],
    })
  })

  it("names the step and field of every blocking detail", () => {
    const result = evaluateReadiness({
      fields: { ...FIELDS, displayName: "", website: "http://insecure.com", handle: "settings" },
      avatar: { path: null, resolvable: false },
      handleStatus: "available",
      draftProducts: [],
      rows: [],
    })
    expect(result.ready).toBe(false)
    expect(result.issues.map((i) => [i.step, i.field]).sort()).toEqual(
      [
        [1, "displayName"],
        [1, "handle"],
        [1, "website"],
      ].sort(),
    )
  })

  it.each([
    ["unavailable", /taken/],
    ["reserved", /reserved/],
    ["unknown", /couldn't confirm/],
  ] as const)("blocks on an address that is %s", (handleStatus, message) => {
    const result = readiness({ handleStatus })
    expect(result.issues).toEqual([
      { step: 1, field: "handle", message: expect.stringMatching(message) },
    ])
  })

  it("blocks on an image whose object can no longer be found, and not on no image", () => {
    expect(readiness({ avatar: { path: "p/draft-x.png", resolvable: false } }).issues).toEqual([
      { step: 1, field: "image", message: expect.stringMatching(/image/) },
    ])
    expect(readiness({ avatar: { path: null, resolvable: false } }).ready).toBe(true)
  })

  it("blocks on a selected product that is no longer eligible, naming it", () => {
    const draftProducts = [
      { productId: pid(1), visible: true },
      { productId: pid(2), visible: true },
    ]
    const result = evaluateReadiness({
      fields: FIELDS,
      avatar: { path: null, resolvable: false },
      handleStatus: "available",
      draftProducts,
      rows: arrange(draftProducts, [
        candidate(1, {
          title: "Archived Kit",
          eligibility: { eligible: false, reason: "archived" },
        }),
        candidate(2),
      ]),
    })
    expect(result.issues).toEqual([
      { step: 2, field: "products", message: expect.stringContaining("Archived Kit") },
    ])
  })

  it("does not block on a hidden ineligible product, which publishing leaves out anyway", () => {
    const draftProducts = [
      { productId: pid(1), visible: false },
      { productId: pid(2), visible: true },
    ]
    const result = evaluateReadiness({
      fields: FIELDS,
      avatar: { path: null, resolvable: false },
      handleStatus: "available",
      draftProducts,
      rows: arrange(draftProducts, [
        candidate(1, { eligibility: { eligible: false, reason: "not_live" } }),
        candidate(2),
      ]),
    })
    expect(result.ready).toBe(true)
    expect(result.plan?.productIds).toEqual([pid(2)])
  })

  it("asks for a product choice when products exist but none were ever arranged", () => {
    const result = evaluateReadiness({
      fields: FIELDS,
      avatar: { path: null, resolvable: false },
      handleStatus: "available",
      draftProducts: [],
      rows: arrange([], [candidate(1)]),
    })
    expect(result.issues).toEqual([{ step: 2, field: "products", message: expect.any(String) }])
  })

  it("allows publishing with no products selected", () => {
    const draftProducts = [{ productId: pid(1), visible: false }]
    const result = evaluateReadiness({
      fields: FIELDS,
      avatar: { path: null, resolvable: false },
      handleStatus: "available",
      draftProducts,
      rows: arrange(draftProducts, [candidate(1)]),
    })
    expect(result.ready).toBe(true)
    expect(result.plan?.productIds).toEqual([])
  })

  it("links each issue to the step, and step 1 issues to the field", () => {
    const routes = { details: "/ws/settings/public-profile/builder", products: "/ws/p" }
    expect(issueHref({ step: 1, field: "website", message: "" }, routes)).toBe(
      "/ws/settings/public-profile/builder?field=website",
    )
    expect(issueHref({ step: 2, field: "products", message: "" }, routes)).toBe("/ws/p")
  })

  it("builds the same snapshot the database records, so an unchanged draft is recognised", () => {
    const plan = readiness().plan!
    const recorded = {
      product_ids: [pid(2), pid(1)],
      avatar_path: null,
      behance_url: null,
      website_url: "https://laurenproctor.com/",
      instagram_url: "https://www.instagram.com/laurenproctor/",
      short_bio: "Design tools, templates, and resources for thoughtful brands.",
      display_name: "Lauren Proctor",
      handle: "lauren-proctor",
    }
    expect(sameSnapshot(recorded, snapshotOf(plan, null))).toBe(true)
    expect(
      sameSnapshot(recorded, snapshotOf({ ...plan, productIds: [pid(1), pid(2)] }, null)),
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The publish action
// ---------------------------------------------------------------------------

const rpc = vi.fn()
const update = vi.fn()
const revalidatePath = vi.fn()
const removeAvatars = vi.fn(async () => {})
let ctx: { profile: { id: string; handle: string } } | null
let state: Awaited<ReturnType<typeof import("@/lib/public/publish-state").loadPublishState>>

vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ update: (payload: unknown) => ({ eq: async () => update(payload) }) }),
  }),
}))
vi.mock("@/lib/public/draft-store", () => ({ loadBuilderContext: async () => ctx }))
vi.mock("@/lib/public/publish-state", () => ({ loadPublishState: async () => state }))
vi.mock("@/lib/public/avatars", () => ({
  removeAvatars: (...a: unknown[]) => removeAvatars(...(a as [])),
}))

const { publishProfileAction, unpublishProfileAction } =
  await import("@/lib/public/publish-actions")

const UPDATED_AT = "2026-09-12T18:00:00.123456+00:00"

function readyState(overrides: { avatarPath?: string | null } = {}) {
  const r = readiness()
  return {
    draft: {
      profileId: "profile-1",
      fields: FIELDS,
      avatarPath: overrides.avatarPath ?? "profile-1/draft-new.png",
      products: [],
      revision: 7,
      updatedAt: UPDATED_AT,
    },
    stored: true,
    rows: [],
    readiness: r,
    presentation: {} as never,
    live: {
      status: "draft",
      handle: "old-handle",
      lastPublishedAt: null,
      hasUnpublishedChanges: true,
    },
  } as unknown as typeof state
}

beforeEach(() => {
  rpc.mockReset()
  update.mockReset()
  revalidatePath.mockReset()
  removeAvatars.mockClear()
  ctx = { profile: { id: "profile-1", handle: "old-handle" } }
  state = readyState()
})

describe("publishing through the action", () => {
  it("sends the re-derived plan and the reviewed draft version, and nothing else", async () => {
    rpc.mockResolvedValue({
      data: {
        outcome: "published",
        handle: "lauren-proctor",
        previous_handle: "old-handle",
        previous_avatar_path: "profile-1/live-old.png",
        publication_id: "pub-1",
      },
      error: null,
    })

    const result = await publishProfileAction("laurens-studio", {
      expectedDraftUpdatedAt: UPDATED_AT,
    })
    expect(result).toEqual({
      ok: true,
      outcome: "published",
      handle: "lauren-proctor",
      path: "/@lauren-proctor",
    })

    expect(rpc).toHaveBeenCalledTimes(1)
    const [name, args] = rpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(name).toBe("publish_public_profile")
    expect(Object.keys(args).sort()).toEqual(
      ["p_expected_draft_updated_at", "p_product_ids", "p_public_profile_id", "p_values"].sort(),
    )
    expect(args.p_public_profile_id).toBe("profile-1")
    expect(args.p_expected_draft_updated_at).toBe(UPDATED_AT)
    expect(args.p_product_ids).toEqual([pid(2), pid(1)])
    expect(Object.keys(args.p_values as object).sort()).toEqual(
      ["behance_url", "display_name", "handle", "instagram_url", "short_bio", "website_url"].sort(),
    )
    // Nothing private, nothing the browser named.
    expect(JSON.stringify(args)).not.toMatch(/email|workspace|billing|laurens-studio/i)

    // Old live image cleaned up; both handles' cached routes invalidated.
    expect(removeAvatars).toHaveBeenCalledWith(["profile-1/live-old.png"])
    const paths = revalidatePath.mock.calls.map((c) => c[0])
    expect(paths).toContain("/profile/old-handle")
    expect(paths).toContain("/profile/lauren-proctor")
  })

  it("is quiet on an unchanged republish: no cache churn, no image removed", async () => {
    rpc.mockResolvedValue({
      data: {
        outcome: "unchanged",
        handle: "lauren-proctor",
        previous_handle: "lauren-proctor",
        previous_avatar_path: "profile-1/draft-new.png",
      },
      error: null,
    })
    const result = await publishProfileAction("laurens-studio", {
      expectedDraftUpdatedAt: UPDATED_AT,
    })
    expect(result).toMatchObject({ ok: true, outcome: "unchanged" })
    expect(removeAvatars).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("refuses without calling the database when the draft is not ready", async () => {
    state = {
      ...readyState(),
      readiness: readiness({ handleStatus: "unavailable" }),
    } as typeof state
    const result = await publishProfileAction("laurens-studio", {
      expectedDraftUpdatedAt: UPDATED_AT,
    })
    expect(result).toMatchObject({ ok: false, kind: "not_ready", issues: [{ field: "handle" }] })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("refuses a draft that changed after the page rendered", async () => {
    const result = await publishProfileAction("laurens-studio", {
      expectedDraftUpdatedAt: "2026-09-12T17:00:00+00:00",
    })
    expect(result).toMatchObject({ ok: false, kind: "draft_changed" })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("refuses an actor RLS does not resolve to the workspace", async () => {
    ctx = null
    const result = await publishProfileAction("someone-elses-studio", {
      expectedDraftUpdatedAt: UPDATED_AT,
    })
    expect(result).toMatchObject({ ok: false, kind: "failed" })
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    ["PT409", { kind: "draft_changed" }],
    ["23505", { kind: "not_ready", issues: [{ step: 1, field: "handle" }] }],
    ["23514", { kind: "not_ready", issues: [{ step: 2, field: "products" }] }],
    ["42501", { kind: "failed" }],
  ])("explains database refusal %s without leaking it", async (code, expected) => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code,
        message: 'duplicate key value violates unique constraint "public_profiles_handle_key"',
      },
    })
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const result = await publishProfileAction("laurens-studio", {
      expectedDraftUpdatedAt: UPDATED_AT,
    })
    spy.mockRestore()
    expect(result).toMatchObject({ ok: false, ...expected })
    expect(JSON.stringify(result)).not.toMatch(/constraint|duplicate key|public_profiles/)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("unpublishes by status alone, leaving the content and the draft", async () => {
    update.mockResolvedValue({ error: null })
    await unpublishProfileAction("laurens-studio")
    expect(update).toHaveBeenCalledWith({ status: "draft", published_at: null })
  })
})

// ---------------------------------------------------------------------------
// The public route and its metadata
// ---------------------------------------------------------------------------

const resolveProfile = vi.fn()
const loadProfileCatalog = vi.fn()
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND")
})
const permanentRedirect = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`)
})

vi.mock("@/lib/public/queries", () => ({
  resolveProfile: (...a: unknown[]) => resolveProfile(...a),
  loadProfileCatalog: (...a: unknown[]) => loadProfileCatalog(...a),
}))
vi.mock("next/navigation", () => ({
  notFound: () => notFound(),
  permanentRedirect: (to: string) => permanentRedirect(to),
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  usePathname: () => "/",
}))
vi.mock("@/lib/channels/oauth", () => ({ appOrigin: () => "https://fanwise.example" }))

const page = await import("@/app/profile/[handle]/page")
const { profileMetadata } = await import("@/lib/public/profile-metadata")

const VIEW: PublicProfileView = {
  id: "0f9f2d4e-1c3b-4a5e-9f7d-2b8c6a1e4d30",
  handle: "lauren-proctor",
  displayName: "Lauren Proctor",
  shortBio: "Design tools, templates, and resources for thoughtful brands.",
  location: "Private Street, Brooklyn",
  hasAvatar: true,
  websiteUrl: "https://laurenproctor.com/",
  instagramUrl: "https://www.instagram.com/laurenproctor/",
  behanceUrl: null,
  contactUrl: "mailto:private-inbox@laurenproctor.com",
  seoTitle: "Stale SEO title from the old form",
  seoDescription: "Stale SEO description",
  updatedAt: "2026-09-12T18:00:00Z",
}

function card(slug: string, title: string, coverAssetId: string | null): PublicProductCard {
  return {
    slug,
    title,
    productType: "template",
    typeLabel: "Template",
    summary: null,
    coverAssetId,
    coverAlt: title,
    featured: false,
    startingPrice: null,
    channelCount: 1,
  }
}

async function renderPage(handle = "lauren-proctor"): Promise<string> {
  const element = (await page.default({ params: Promise.resolve({ handle }) })) as ReactElement
  return renderToStaticMarkup(element)
}

describe("the public profile route", () => {
  beforeEach(() => {
    resolveProfile.mockReset()
    loadProfileCatalog.mockReset()
    notFound.mockClear()
    permanentRedirect.mockClear()
  })

  it("renders per request, so no cached copy outlives an unpublish or crosses profiles", () => {
    expect(page.dynamic).toBe("force-dynamic")
  })

  it("answers not-found for an unpublished or unknown profile, and never loads its products", async () => {
    resolveProfile.mockResolvedValue({ kind: "missing" })
    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND")
    expect(loadProfileCatalog).not.toHaveBeenCalled()
  })

  it("redirects a retired handle permanently to the current one", async () => {
    resolveProfile.mockResolvedValue({ kind: "redirect", to: "lauren-moved" })
    await expect(renderPage("lauren-old")).rejects.toThrow("NEXT_REDIRECT:/@lauren-moved")
  })

  it("renders the published profile through the shared component, products in published order", async () => {
    resolveProfile.mockResolvedValue({ kind: "found", value: VIEW })
    loadProfileCatalog.mockResolvedValue([
      card("brand-strategy", "Brand Strategy Workbook", "asset-2"),
      card("editorial-type", "Editorial Type System", null),
    ])
    const markup = await renderPage()

    expect(markup).toContain('data-layout="responsive"')
    expect(markup).toMatch(/<h1[^>]*>Lauren Proctor<\/h1>/)
    expect(markup.indexOf("Brand Strategy Workbook")).toBeLessThan(
      markup.indexOf("Editorial Type System"),
    )
    expect(markup).toContain('href="/@lauren-proctor/brand-strategy"')
    expect(markup).toContain('src="/api/public/asset/asset-2"')
    expect(markup).toContain("data-missing-image")
    expect(markup).toContain("/api/public/avatar/0f9f2d4e-1c3b-4a5e-9f7d-2b8c6a1e4d30?v=")
    expect(markup).toContain('data-link="website"')
    expect(markup).toContain('data-link="instagram"')
    expect(markup).not.toContain('data-link="behance"')
  })

  it("puts no private or unedited field into the page", async () => {
    resolveProfile.mockResolvedValue({ kind: "found", value: VIEW })
    loadProfileCatalog.mockResolvedValue([])
    const markup = await renderPage()
    for (const leak of [
      "private-inbox",
      "mailto:",
      "Private Street",
      "Stale SEO",
      VIEW.id + '"', // the id appears only inside the avatar route
      "Sign out",
      "Billing",
    ]) {
      expect(markup, leak).not.toContain(leak)
    }
    expect(markup).not.toMatch(/data-link="email"|type="email"/)
  })
})

describe("published metadata", () => {
  it("is built from the studio name, introduction, image and canonical address only", () => {
    const metadata = profileMetadata(VIEW, "https://fanwise.example")
    expect(metadata.title).toBe("Lauren Proctor · Fanwise")
    expect(metadata.description).toBe(VIEW.shortBio)
    expect(metadata.alternates?.canonical).toBe("https://fanwise.example/@lauren-proctor")
    expect(JSON.stringify(metadata.openGraph)).toContain(
      "https://fanwise.example/api/public/avatar/0f9f2d4e-1c3b-4a5e-9f7d-2b8c6a1e4d30",
    )
    expect(JSON.stringify(metadata)).not.toMatch(/Stale SEO|private-inbox|mailto|Private Street/)
  })

  it("carries no image when there is none, and a default description without a bio", () => {
    const metadata = profileMetadata(
      { ...VIEW, hasAvatar: false, shortBio: null },
      "https://fanwise.example",
    )
    expect(metadata.description).toBe("Digital products by Lauren Proctor, on Fanwise.")
    expect(JSON.stringify(metadata)).not.toContain("/api/public/avatar/")
  })

  it("says nothing about a profile that is not published, and asks not to be indexed", async () => {
    resolveProfile.mockResolvedValue({ kind: "missing" })
    const metadata = await page.generateMetadata({
      params: Promise.resolve({ handle: "draft-one" }),
    })
    expect(metadata.robots).toMatchObject({ index: false })
    expect(JSON.stringify(metadata)).not.toContain("draft-one")
  })
})
