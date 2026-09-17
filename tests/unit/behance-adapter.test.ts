import { describe, expect, it } from "vitest"
import {
  behanceAdapter,
  COVER_SPEC,
  COVER_SPEC_SMALL,
  projectImageSpec,
} from "@/lib/channels/adapters/behance"
import { behanceAccountHint, behanceSubmission } from "@/lib/channels/adapters/behance/account"
import { feeBreakdown, feeSentence } from "@/lib/channels/adapters/behance/fees"
import {
  ASSET_CATEGORY_LABELS,
  CREATIVE_FIELD_LABELS,
  defaultAssetCategory,
  defaultCreativeFields,
  recommendedLicense,
} from "@/lib/channels/adapters/behance/fields"
import {
  CREATIVE_FIELDS_KEY,
  EXISTING_PROJECT_URL_KEY,
  HANDOFF_MODE_KEY,
  LICENSE_TYPE_KEY,
  SECTIONS,
} from "@/lib/channels/adapters/behance/handoff"
import { handoffSteps, type HandoffStep } from "@/lib/channels/handoff"
import { buildDraft, evaluate, resolveDraft } from "@/lib/channels/listings"
import type { AdapterSubject, ChannelListingDraft, HandoffRendition } from "@/lib/channels/types"
import type { Product, ProductAsset } from "@/lib/products/types"

/**
 * The Behance adapter, docs/channels/behance.md.
 *
 * Nothing here touches a network, because the channel has none to touch. What
 * is proved: the two mapping tables and the license recommendation; the two
 * addresses parsed inside the adapter; the fee arithmetic the handoff shows;
 * the requirements in both handoff modes; the renditions the handoff asks for;
 * and the handoff itself, ordered to Behance's editor, with existing-project
 * mode leaving out the sections Fanwise did not compose.
 */

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    workspace_id: "22222222-2222-4222-8222-222222222222",
    name: "Aster Grotesk",
    slug: "aster-grotesk",
    product_type: "font",
    status: "draft",
    canonical_title: "Aster Grotesk Variable Sans Family",
    canonical_description:
      "A neo-grotesque family drawn for interfaces, with a tall x-height and tight spacing that holds up at small sizes.\n\nFourteen weights.",
    short_description: "A neo-grotesque for interfaces, in fourteen weights.",
    brand_name: "Aster Type",
    base_price: 24,
    currency: "USD",
    version: "1.0",
    support_url: null,
    documentation_url: null,
    license_summary: null,
    metadata: { kind: "font" },
    created_at: "2026-09-17T00:00:00Z",
    updated_at: "2026-09-17T00:00:00Z",
    archived_at: null,
    ...overrides,
  } as Product
}

let counter = 0
function asset(overrides: Partial<ProductAsset> = {}): ProductAsset {
  counter += 1
  return {
    id: `asset-${counter}`,
    workspace_id: "22222222-2222-4222-8222-222222222222",
    product_id: "11111111-1111-4111-8111-111111111111",
    asset_type: "preview_image",
    asset_state: "ready",
    storage_path: "ws/prod/asset.jpg",
    filename: `image-${counter}.jpg`,
    mime_type: "image/jpeg",
    byte_size: 1024,
    checksum: "abc",
    sort_order: counter,
    derived_from: null,
    spec_hash: null,
    failure_reason: null,
    metadata: { width: 3000, height: 2000 },
    created_at: "2026-09-17T00:00:00Z",
    ...overrides,
  } as ProductAsset
}

function fullAssets(): ProductAsset[] {
  return [
    asset({ asset_type: "cover_image", filename: "cover.jpg", sort_order: 0 }),
    asset({
      asset_type: "archive",
      filename: "aster.zip",
      mime_type: "application/zip",
      byte_size: 68_000_000,
    }),
    asset({ filename: "specimen.jpg" }),
    asset({ filename: "waterfall.jpg" }),
    asset({ filename: "in-use.png", mime_type: "image/png" }),
  ]
}

function subject(overrides: { product?: Product; assets?: ProductAsset[] } = {}): AdapterSubject {
  return { product: overrides.product ?? product(), assets: overrides.assets ?? fullAssets() }
}

/** A listing as the adapter builds it, resolved, with the edits a creator makes. */
function draft(
  s: AdapterSubject,
  overrides: Partial<ChannelListingDraft> = {},
): ChannelListingDraft {
  const built = resolveDraft(buildDraft(behanceAdapter, s), s.product, behanceAdapter)
  return {
    ...built,
    tags: ["grotesque", "sans serif", "variable font", "editorial", "display", "type family"],
    ...overrides,
    metadata: { ...built.metadata, ...(overrides.metadata ?? {}) },
  }
}

function blocking(s: AdapterSubject, d: ChannelListingDraft): string[] {
  return evaluate(behanceAdapter, d, s).readiness.blocking.map((r) => r.key)
}

describe("capabilities and shape", () => {
  it("is assisted, implements nothing that writes, and holds no credential", () => {
    expect(behanceAdapter.integrationType).toBe("assisted")
    expect(behanceAdapter.publish).toBeUndefined()
    expect(behanceAdapter.update).toBeUndefined()
    expect(behanceAdapter.unpublish).toBeUndefined()
    expect(behanceAdapter.oauth).toBeUndefined()
    expect(behanceAdapter.capabilities).toEqual({
      automaticPublish: false,
      automaticUpdate: false,
      metrics: false,
      transactions: false,
      digitalFileUpload: false,
      imageUpload: false,
      drafts: true,
    })
    expect(behanceAdapter.manualSteps).toEqual([])
    expect(behanceAdapter.accountHint).toBeDefined()
    expect(behanceAdapter.submission).toBeDefined()
  })

  it("names its renditions as shapes, not as a channel", () => {
    for (const spec of [
      COVER_SPEC,
      COVER_SPEC_SMALL,
      projectImageSpec("image/jpeg"),
      projectImageSpec("image/png"),
    ]) {
      expect(spec.key).not.toMatch(/behance/i)
    }
    expect(COVER_SPEC.width / COVER_SPEC.height).toBeCloseTo(808 / 632, 3)
    expect(projectImageSpec("image/png").format).toBe("png")
    expect(projectImageSpec("image/jpeg").fit).toBe("inside")
  })
})

describe("the mapping tables", () => {
  it("suggests Creative Fields and a category for every product type, from its own lists", () => {
    for (const type of [
      "font",
      "template",
      "graphic",
      "photo",
      "illustration",
      "icon",
      "mockup",
      "brush",
      "three_d",
      "theme",
      "other",
    ] as const) {
      const fields = defaultCreativeFields(type)
      expect(fields.length).toBeGreaterThan(0)
      for (const field of fields) expect(CREATIVE_FIELD_LABELS).toContain(field)
      const category = defaultAssetCategory(type)
      if (category !== null) expect(ASSET_CATEGORY_LABELS).toContain(category)
    }
    expect(defaultCreativeFields("font")).toEqual(["Typography", "Type Design"])
    expect(defaultAssetCategory("font")).toBe("Fonts")
    // Not one of the five the navigation shows: the creator chooses on the form.
    expect(defaultAssetCategory("photo")).toBeNull()
  })

  it("never recommends more license than the product grants", () => {
    expect(recommendedLicense(null)).toBe("standard_commercial")
    expect(recommendedLicense("Desktop and web use, commercial projects allowed.")).toBe(
      "standard_commercial",
    )
    expect(recommendedLicense("For personal, non-commercial use only.")).toBe("personal")
  })

  it("builds a listing that carries the suggestions as choices, and inherits the words", () => {
    const s = subject()
    const built = buildDraft(behanceAdapter, s)
    expect(built.title).toBeNull()
    expect(built.description).toBeNull()
    expect(built.price).toBeNull()
    expect(built.category).toBe("Fonts")
    expect(built.metadata).toEqual({
      [HANDOFF_MODE_KEY]: "new",
      [CREATIVE_FIELDS_KEY]: ["Typography", "Type Design"],
      [LICENSE_TYPE_KEY]: "standard_commercial",
    })
  })
})

describe("the addresses the adapter parses", () => {
  it("takes a username, a handle or a profile URL, and stores the username", () => {
    for (const raw of [
      "astertype",
      "@astertype",
      "behance.net/astertype",
      "https://www.behance.net/astertype/projects",
    ]) {
      expect(behanceAccountHint.parse(raw)).toEqual({
        ok: true,
        value: "astertype",
        name: "behance.net/astertype",
      })
    }
  })

  it("refuses what is not a profile", () => {
    for (const raw of [
      "",
      "https://example.com/astertype",
      "behance.net/gallery/123/x",
      "two words",
    ]) {
      expect(behanceAccountHint.parse(raw).ok).toBe(false)
    }
  })

  it("reads the project id out of a gallery URL and canonicalizes it", () => {
    const parsed = behanceSubmission.parseUrl(
      "behance.net/gallery/123456789/Aster-Grotesk?tracking=1",
    )
    expect(parsed).toEqual({
      ok: true,
      externalListingId: "123456789",
      externalUrl: "https://www.behance.net/gallery/123456789/Aster-Grotesk",
    })
    expect(behanceSubmission.parseUrl("https://www.behance.net/gallery/123456789")).toMatchObject({
      ok: true,
      externalUrl: "https://www.behance.net/gallery/123456789",
    })
  })

  it("refuses a profile, another site, or no id", () => {
    for (const raw of [
      "behance.net/astertype",
      "https://example.com/gallery/1/x",
      "behance.net/gallery/abc/x",
      "",
    ]) {
      expect(behanceSubmission.parseUrl(raw).ok).toBe(false)
    }
  })
})

describe("fees", () => {
  it("takes 30 percent for the platform and 2.9 percent plus 30 cents for the processor", () => {
    expect(feeBreakdown(24)).toEqual({ price: 24, platformFee: 7.2, processorFee: 1, net: 15.8 })
  })

  it("says it in a sentence beside the price, and says nothing is charged on a free asset", () => {
    expect(feeSentence(24, "USD")).toBe(
      "Behance keeps $7.20 and the payment processor about $1.00. You receive about $15.80. Behance Pro waives the $7.20.",
    )
    expect(feeSentence(0, "USD")).toMatch(/^Free/)
  })
})

describe("requirements", () => {
  it("is ready with a complete product, one file, a cover and three images", () => {
    const s = subject()
    const d = draft(s)
    const evaluation = evaluate(behanceAdapter, d, s)
    expect(evaluation.readiness.blocking).toEqual([])
    expect(evaluation.readiness.ready).toBe(true)
    // The fee line is information, shown whether or not anything blocks.
    expect(evaluation.results.find((r) => r.key === "net_proceeds")?.message).toContain("$7.20")
  })

  it("asks for a Creative Field, a category and a license", () => {
    const s = subject()
    const keys = blocking(
      s,
      draft(s, {
        category: null,
        metadata: { [CREATIVE_FIELDS_KEY]: [], [LICENSE_TYPE_KEY]: null },
      }),
    )
    expect(keys).toEqual(
      expect.arrayContaining(["creative_field_mapped", "category_mapped", "license_selected"]),
    )
    expect(blocking(s, draft(s, { metadata: { [CREATIVE_FIELDS_KEY]: ["Cooking"] } }))).toContain(
      "creative_field_mapped",
    )
  })

  it("wants one file, under 500 MB, of a type Behance lists", () => {
    const two = subject({
      assets: [
        ...fullAssets(),
        asset({ asset_type: "deliverable", filename: "extra.pdf", mime_type: "application/pdf" }),
      ],
    })
    expect(blocking(two, draft(two))).toContain("package_single_file")

    const none = subject({ assets: fullAssets().filter((a) => a.asset_type !== "archive") })
    expect(blocking(none, draft(none))).toContain("package_single_file")

    const big = subject({
      assets: fullAssets().map((a) =>
        a.asset_type === "archive" ? { ...a, byte_size: 600 * 1024 * 1024 } : a,
      ),
    })
    expect(blocking(big, draft(big))).toContain("package_size")

    const odd = subject({
      assets: fullAssets().map((a) =>
        a.asset_type === "archive" ? { ...a, filename: "aster.rar" } : a,
      ),
    })
    expect(blocking(odd, draft(odd))).toContain("package_type")
  })

  it("refuses a GIF or a small cover, and asks for three images", () => {
    const gif = subject({
      assets: fullAssets().map((a) =>
        a.asset_type === "cover_image" ? { ...a, mime_type: "image/gif" } : a,
      ),
    })
    expect(blocking(gif, draft(gif))).toContain("cover_image")

    const small = subject({
      assets: fullAssets().map((a) =>
        a.asset_type === "cover_image" ? { ...a, metadata: { width: 700, height: 500 } } : a,
      ),
    })
    expect(blocking(small, draft(small))).toContain("cover_image")

    const few = subject({ assets: fullAssets().slice(0, 3) })
    expect(blocking(few, draft(few))).toContain("images_min")
  })

  it("prices free or from Stripe's minimum", () => {
    const s = subject()
    expect(blocking(s, draft(s, { price: 0 }))).not.toContain("price_present")
    expect(blocking(s, draft(s, { price: 0.25 }))).toContain("price_present")
    expect(blocking(s, draft(s, { price: null }))).toContain("price_present")
  })

  it("caps tags at ten as an error and advises five as a warning", () => {
    const s = subject()
    expect(
      blocking(s, draft(s, { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) })),
    ).toContain("tag_max")
    const few = evaluate(behanceAdapter, draft(s, { tags: ["one"] }), s)
    expect(few.readiness.blocking.map((r) => r.key)).not.toContain("tag_count")
    expect(few.readiness.advisory.map((r) => r.key)).toContain("tag_count")
  })

  it("in existing-project mode, skips the project's rules and asks for the project's address", () => {
    const few = subject({ assets: fullAssets().slice(0, 2) })
    const existing = draft(few, {
      metadata: { [HANDOFF_MODE_KEY]: "existing", [CREATIVE_FIELDS_KEY]: [] },
    })
    const keys = blocking(few, existing)
    expect(keys).not.toContain("creative_field_mapped")
    expect(keys).not.toContain("images_min")
    expect(keys).toContain("existing_project_url")

    const withUrl = draft(few, {
      metadata: {
        [HANDOFF_MODE_KEY]: "existing",
        [CREATIVE_FIELDS_KEY]: [],
        [EXISTING_PROJECT_URL_KEY]: "behance.net/gallery/42/x",
      },
    })
    expect(blocking(few, withUrl)).not.toContain("existing_project_url")
  })
})

describe("the renditions the handoff asks for", () => {
  it("wants one cropped cover, every image at canvas size, and the previews again as examples", () => {
    const s = subject()
    const wanted = behanceAdapter.handoffImages!(s)
    const cover = wanted.filter((r) => r.role === "cover")
    expect(cover).toHaveLength(1)
    expect(cover[0]!.spec).toBe(COVER_SPEC)
    // Cover first, then the previews, in channel order.
    expect(wanted.filter((r) => r.role === "project").map((r) => r.source.filename)).toEqual([
      "cover.jpg",
      "specimen.jpg",
      "waterfall.jpg",
      "in-use.png",
    ])
    expect(wanted.filter((r) => r.role === "example").map((r) => r.source.filename)).toEqual([
      "specimen.jpg",
      "waterfall.jpg",
      "in-use.png",
    ])
    // A PNG stays PNG so a specimen on a transparent ground keeps it.
    expect(wanted.find((r) => r.source.filename === "in-use.png")!.spec.format).toBe("png")
  })

  it("crops a cover that cannot fill the larger frame at the minimum instead", () => {
    const small = subject({
      assets: fullAssets().map((a) =>
        a.asset_type === "cover_image" ? { ...a, metadata: { width: 1000, height: 800 } } : a,
      ),
    })
    expect(behanceAdapter.handoffImages!(small).find((r) => r.role === "cover")!.spec).toBe(
      COVER_SPEC_SMALL,
    )
  })

  it("leaves a GIF out, because the engine never re-encodes one", () => {
    const gif = subject({
      assets: [...fullAssets(), asset({ filename: "loop.gif", mime_type: "image/gif" })],
    })
    expect(behanceAdapter.handoffImages!(gif).some((r) => r.source.filename === "loop.gif")).toBe(
      false,
    )
  })
})

/** Renditions as the page would find them: every one built. */
function built(s: AdapterSubject): HandoffRendition[] {
  return behanceAdapter.handoffImages!(s).map((r, index) => ({
    role: r.role,
    position: r.position,
    source: r.source,
    asset: asset({
      id: `derived-${index}`,
      filename: `${r.source.filename.replace(/\.[^.]+$/, "")}-${r.spec.key}.jpg`,
      derived_from: r.source.id,
    }),
  }))
}

function stepsFor(s: AdapterSubject, d: ChannelListingDraft): HandoffStep[] {
  return handoffSteps(behanceAdapter, { draft: d, subject: s, images: [], renditions: built(s) })
}

describe("the handoff", () => {
  it("runs in Behance's editor order: images, Attach Assets, project settings, credits, public", () => {
    const s = subject()
    const steps = stepsFor(s, draft(s))
    const sections = [...new Set(steps.map((step) => step.section))]
    expect(sections).toEqual([
      SECTIONS.images,
      SECTIONS.asset,
      SECTIONS.settings,
      SECTIONS.credits,
      SECTIONS.publish,
    ])
    expect(steps.map((step) => step.key)).toEqual([
      "project_images",
      "asset_cover",
      "file_name",
      "asset_file",
      "category",
      "license",
      "asset_description",
      "price",
      "example_images",
      "add_asset",
      "project_cover",
      "title",
      "creative_fields",
      "tags",
      "tools",
      "description",
      "submit",
    ])
  })

  it("numbers the canvas images, names the package for the buyer, and shows the fee beside the price", () => {
    const s = subject()
    const steps = stepsFor(s, draft(s))
    const byKey = new Map(steps.map((step) => [step.key, step]))

    const images = byKey.get("project_images")
    expect(images?.kind).toBe("files")
    if (images?.kind === "files") {
      expect(images.files.map((f) => f.downloadAs)).toEqual([
        "01-cover-fit-2800-jpeg.jpg",
        "02-specimen-fit-2800-jpeg.jpg",
        "03-waterfall-fit-2800-jpeg.jpg",
        "04-in-use-fit-2800-png.jpg",
      ])
    }

    expect(byKey.get("file_name")).toMatchObject({
      kind: "copy",
      value: "aster-grotesk-behance.zip",
    })
    const file = byKey.get("asset_file")
    if (file?.kind === "files")
      expect(file.files[0]).toMatchObject({
        filename: "aster-grotesk-behance.zip",
        downloadAs: "aster-grotesk-behance.zip",
      })

    expect(byKey.get("price")).toMatchObject({ kind: "copy", label: "Price, USD", value: "24.00" })
    if (byKey.get("price")?.kind === "copy") {
      expect((byKey.get("price") as { note?: string }).note).toContain("You receive about $15.80")
    }
    expect(byKey.get("category")).toMatchObject({ kind: "copy", value: "Fonts" })
    expect(byKey.get("license")).toMatchObject({
      kind: "note",
      text: "Choose Standard Commercial.",
    })
    expect(byKey.get("creative_fields")).toMatchObject({
      kind: "copy",
      value: "Typography, Type Design",
    })
    // Both descriptions are plain text: no Markdown survives.
    expect(byKey.get("description")).toMatchObject({ kind: "copy", multiline: true })
    expect((byKey.get("asset_description") as { value: string }).value).toBe(
      "A neo-grotesque for interfaces, in fourteen weights.",
    )
  })

  it("in existing-project mode, leaves out the sections Fanwise did not compose and says so", () => {
    const s = subject()
    const steps = stepsFor(s, draft(s, { metadata: { [HANDOFF_MODE_KEY]: "existing" } }))
    const sections = [...new Set(steps.map((step) => step.section))]
    expect(sections).toEqual([SECTIONS.asset, SECTIONS.publish])
    expect(steps[0]).toMatchObject({ kind: "note", key: "existing" })
    expect(steps.some((step) => step.key === "title")).toBe(false)
    expect(steps.some((step) => step.key === "project_images")).toBe(false)
    expect(steps[steps.length - 1]).toMatchObject({ kind: "submit", label: "Update the project" })
  })

  it("says a rendition is missing until the engine has built it, rather than linking to nothing", () => {
    const s = subject()
    const steps = handoffSteps(behanceAdapter, {
      draft: draft(s),
      subject: s,
      images: [],
      renditions: behanceAdapter.handoffImages!(s).map((r) => ({ ...r, asset: null })),
    })
    expect(steps.find((step) => step.key === "project_images")?.kind).toBe("missing")
    expect(steps.find((step) => step.key === "asset_cover")?.kind).toBe("missing")
  })

  it("never claims Fanwise sent anything", () => {
    const s = subject()
    const text = JSON.stringify(stepsFor(s, draft(s)))
    expect(text).toContain("Fanwise sends nothing to Behance")
    expect(text).not.toMatch(/fanwise (has )?published/i)
  })
})
