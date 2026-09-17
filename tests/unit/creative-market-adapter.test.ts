import { describe, expect, it } from "vitest"
import {
  creativeMarketAdapter,
  SCREENSHOT_SPEC,
  SCREENSHOT_SPEC_SMALL,
} from "@/lib/channels/adapters/creative-market"
import {
  creativeMarketAccountHint,
  creativeMarketSubmission,
} from "@/lib/channels/adapters/creative-market/account"
import {
  CATEGORIES,
  baseTier,
  defaultCategory,
  fontTiers,
  standardTiers,
} from "@/lib/channels/adapters/creative-market/fields"
import {
  FONT_LICENSE_SCOPE_KEY,
  SECTIONS,
  SUBCATEGORY_KEY,
} from "@/lib/channels/adapters/creative-market/handoff"
import { creativeMarketPackage, readmeText } from "@/lib/channels/adapters/creative-market/package"
import { handoffSteps, type HandoffStep } from "@/lib/channels/handoff"
import { buildDraft, evaluate, resolveDraft } from "@/lib/channels/listings"
import type {
  AdapterSubject,
  ChannelListingDraft,
  HandoffPackage,
  HandoffRendition,
} from "@/lib/channels/types"
import type { Product, ProductAsset } from "@/lib/products/types"

/**
 * The Creative Market adapter, docs/channels/creative-market.md.
 *
 * Nothing here touches a network, because the channel has none to touch. What
 * is proved: the category and license tables; the two addresses parsed inside
 * the adapter; the §9 requirements in their order, including the
 * category-drives-license rule and the disclosure the product must answer;
 * the package spec and its README; the renditions the handoff asks for; and
 * the handoff itself, ordered to Creative Market's editor.
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
      "## A neo-grotesque for interfaces\n\nDrawn with a tall x-height and tight spacing that holds up at small sizes.\n\n1. Fourteen weights\n2. A [license](https://example.com/eula)",
    short_description: "A neo-grotesque for interfaces, in fourteen weights.",
    brand_name: "Aster Type",
    base_price: 24,
    currency: "USD",
    version: "1.0",
    support_url: "https://example.com/support",
    documentation_url: null,
    license_summary: "Desktop and web use for one studio.",
    made_with_generative_ai: false,
    metadata: {
      kind: "font",
      licenses: [
        { kind: "desktop", price: 24 },
        { kind: "epub", price: 30 },
        { kind: "app", price: 90 },
      ],
    },
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
    checksum: `sum-${counter}`,
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
      asset_type: "deliverable",
      filename: "Aster-Regular.otf",
      mime_type: "font/otf",
      byte_size: 68_000,
    }),
    asset({ asset_type: "license", filename: "license.pdf", mime_type: "application/pdf" }),
    asset({ filename: "specimen.jpg" }),
    asset({ filename: "waterfall.png", mime_type: "image/png" }),
  ]
}

function subject(overrides: { product?: Product; assets?: ProductAsset[] } = {}): AdapterSubject {
  return { product: overrides.product ?? product(), assets: overrides.assets ?? fullAssets() }
}

function draft(
  s: AdapterSubject,
  overrides: Partial<ChannelListingDraft> = {},
): ChannelListingDraft {
  const built = resolveDraft(buildDraft(creativeMarketAdapter, s), s.product, creativeMarketAdapter)
  return {
    ...built,
    tags: ["grotesque", "sans serif", "variable font", "editorial", "display"],
    ...overrides,
    metadata: { ...built.metadata, ...(overrides.metadata ?? {}) },
  }
}

function blocking(s: AdapterSubject, d: ChannelListingDraft): string[] {
  return evaluate(creativeMarketAdapter, d, s).readiness.blocking.map((r) => r.key)
}

function advisory(s: AdapterSubject, d: ChannelListingDraft): string[] {
  return evaluate(creativeMarketAdapter, d, s)
    .readiness.advisory.filter((r) => !r.satisfied)
    .map((r) => r.key)
}

describe("capabilities and shape", () => {
  it("is assisted, implements nothing that writes, and holds no credential", () => {
    expect(creativeMarketAdapter.integrationType).toBe("assisted")
    expect(creativeMarketAdapter.publish).toBeUndefined()
    expect(creativeMarketAdapter.update).toBeUndefined()
    expect(creativeMarketAdapter.unpublish).toBeUndefined()
    expect(creativeMarketAdapter.oauth).toBeUndefined()
    expect(creativeMarketAdapter.capabilities).toEqual({
      automaticPublish: false,
      automaticUpdate: false,
      metrics: false,
      transactions: false,
      digitalFileUpload: false,
      imageUpload: false,
      drafts: true,
    })
    expect(creativeMarketAdapter.manualSteps).toEqual([])
    expect(creativeMarketAdapter.accountHint).toBeDefined()
    expect(creativeMarketAdapter.submission).toBeDefined()
    expect(creativeMarketAdapter.handoffPackage).toBeDefined()
    expect(creativeMarketAdapter.fields).not.toContain("shortDescription")
  })

  it("names its rendition as a shape, 3:2 under 5 MB, never as a channel", () => {
    for (const spec of [SCREENSHOT_SPEC, SCREENSHOT_SPEC_SMALL]) {
      expect(spec.key).not.toMatch(/creative/i)
      expect(spec.width / spec.height).toBeCloseTo(3 / 2, 2)
      expect(spec.format).toBe("jpeg")
      expect(spec.maxByteSize).toBe(5 * 1024 * 1024)
    }
    expect(SCREENSHOT_SPEC).toMatchObject({ width: 1820, height: 1214 })
    expect(SCREENSHOT_SPEC_SMALL).toMatchObject({ width: 910, height: 607 })
  })

  it("declares its requirements in the spec's order", () => {
    const keys = creativeMarketAdapter.requirements.map((r) => r.key)
    expect(keys.slice(0, 15)).toEqual([
      "category_selected",
      "category_matches_files",
      "package_format",
      "package_size",
      "title_present",
      "title_no_shop_name",
      "description_min_words",
      "description_markdown_safe",
      "images_min",
      "image_dimensions",
      "image_format",
      "image_size_max",
      "price_floor",
      "ai_disclosure_set",
      "tags_min",
    ])
  })
})

describe("the category and license tables", () => {
  it("suggests a category for every product type but other, from its own nine", () => {
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
    ] as const) {
      expect(CATEGORIES).toContain(defaultCategory(type))
    }
    expect(defaultCategory("other")).toBeNull()
    expect(defaultCategory("font")).toBe("Fonts")
    expect(defaultCategory("theme")).toBe("Templates & Themes")
  })

  it("prices fonts by license type and scope, and everything else by tier with published floors", () => {
    expect(fontTiers("family").map((t) => [t.key, t.floor])).toEqual([
      ["desktop", 15],
      ["epub", 23],
      ["app", 72],
    ])
    expect(fontTiers("individual").map((t) => t.floor)).toEqual([12, 18, 72])
    expect(fontTiers("family").every((t) => !t.verified)).toBe(true)
    expect(standardTiers("Templates & Themes", "template").map((t) => t.floor)).toEqual([9, 14, 36])
    expect(standardTiers("Templates & Themes", "theme").map((t) => t.floor)).toEqual([19, 29, 76])
    expect(standardTiers("Photos", "photo").map((t) => t.floor)).toEqual([3, 4, 5])
    // No published floor is null, and null is never checked.
    expect(standardTiers("Icons", "icon").map((t) => t.floor)).toEqual([null, null, null])
    expect(baseTier("Fonts", "font", "individual")).toMatchObject({ key: "desktop", floor: 12 })
    expect(baseTier("Graphics", "graphic", "family")).toMatchObject({ key: "personal", floor: 6 })
  })

  it("builds a listing that suggests the category and inherits the words", () => {
    const s = subject()
    const built = buildDraft(creativeMarketAdapter, s)
    expect(built.title).toBeNull()
    expect(built.description).toBeNull()
    expect(built.price).toBeNull()
    expect(built.category).toBe("Fonts")
    expect(built.metadata).toEqual({ [SUBCATEGORY_KEY]: null, [FONT_LICENSE_SCOPE_KEY]: "family" })
  })
})

describe("the addresses the adapter parses", () => {
  it("takes a shop name or its address, and stores the name", () => {
    for (const raw of [
      "astertype",
      "@astertype",
      "creativemarket.com/astertype",
      "https://www.creativemarket.com/astertype/",
    ]) {
      expect(creativeMarketAccountHint.parse(raw)).toEqual({
        ok: true,
        value: "astertype",
        name: "creativemarket.com/astertype",
      })
    }
  })

  it("refuses what is not a shop", () => {
    for (const raw of [
      "",
      "https://example.com/astertype",
      "creativemarket.com/astertype/1234-x",
      "two words",
    ]) {
      expect(creativeMarketAccountHint.parse(raw).ok).toBe(false)
    }
  })

  it("reads the product id out of a listing URL and canonicalizes it", () => {
    expect(
      creativeMarketSubmission.parseUrl(
        "www.creativemarket.com/astertype/1234567-Aster-Grotesk?u=x",
      ),
    ).toEqual({
      ok: true,
      externalListingId: "1234567",
      externalUrl: "https://creativemarket.com/astertype/1234567-Aster-Grotesk",
    })
    expect(
      creativeMarketSubmission.parseUrl("https://creativemarket.com/astertype/1234567"),
    ).toMatchObject({
      ok: true,
      externalUrl: "https://creativemarket.com/astertype/1234567",
    })
  })

  it("refuses a shop, another site, or no id", () => {
    for (const raw of [
      "creativemarket.com/astertype",
      "https://example.com/a/1-x",
      "creativemarket.com/a/abc-x",
      "",
    ]) {
      expect(creativeMarketSubmission.parseUrl(raw).ok).toBe(false)
    }
  })
})

describe("requirements", () => {
  it("is ready with a complete font, an answered disclosure, a file, a license and three images", () => {
    const s = subject()
    const evaluation = evaluate(creativeMarketAdapter, draft(s), s)
    expect(evaluation.readiness.blocking).toEqual([])
    expect(evaluation.readiness.ready).toBe(true)
  })

  it("asks for a category from its own list", () => {
    const s = subject()
    expect(blocking(s, draft(s, { category: null }))).toContain("category_selected")
    expect(blocking(s, draft(s, { category: "Typefaces" }))).toContain("category_selected")
  })

  it("refuses Fonts without an installable font, and names a letter set for what it is", () => {
    const letterSet = subject({
      assets: fullAssets().map((a) =>
        a.asset_type === "deliverable"
          ? { ...a, filename: "letters.eps", mime_type: "application/postscript" }
          : a,
      ),
    })
    const results = evaluate(creativeMarketAdapter, draft(letterSet), letterSet).results
    const rule = results.find((r) => r.key === "category_matches_files")!
    expect(rule.satisfied).toBe(false)
    expect(rule.message).toMatch(/EPS or AI letter set/)

    // A zipped package counts by what the finalize job read inside it.
    const packaged = subject({
      assets: fullAssets().map((a) =>
        a.asset_type === "deliverable"
          ? {
              ...a,
              filename: "aster.zip",
              mime_type: "application/zip",
              metadata: {
                archive: {
                  entries: [
                    {
                      path: "Aster.otf",
                      byteSize: 1,
                      kind: "font",
                      font: {
                        format: "otf",
                        isVariable: false,
                        axes: [],
                        scripts: [],
                        languages: [],
                        blocks: [],
                        features: [],
                      },
                    },
                  ],
                  entryCount: 1,
                  fontCount: 1,
                  ignoredCount: 0,
                  truncated: false,
                },
              },
            }
          : a,
      ),
    })
    expect(blocking(packaged, draft(packaged))).not.toContain("category_matches_files")

    // Graphics does not care.
    expect(blocking(letterSet, draft(letterSet, { category: "Graphics" }))).not.toContain(
      "category_matches_files",
    )
  })

  it("wants a file to package, under the limits", () => {
    const none = subject({ assets: fullAssets().filter((a) => a.asset_type !== "deliverable") })
    expect(blocking(none, draft(none))).toContain("package_format")
    const big = subject({
      assets: fullAssets().map((a) =>
        a.asset_type === "deliverable" ? { ...a, byte_size: 600 * 1024 * 1024 } : a,
      ),
    })
    const rule = evaluate(creativeMarketAdapter, draft(big), big).results.find(
      (r) => r.key === "package_size",
    )!
    expect(rule.satisfied).toBe(false)
    expect(rule.message).toMatch(/Fanwise builds packages up to 512 MB/)
  })

  it("holds the title to sixty characters with no shop name in it", () => {
    const s = subject()
    expect(blocking(s, draft(s, { title: "x".repeat(61) }))).toContain("title_present")
    expect(blocking(s, draft(s, { title: "Aster Grotesk by Aster Type" }))).toContain(
      "title_no_shop_name",
    )
    expect(blocking(s, draft(s, { title: "Aster Grotesk Sans" }))).not.toContain(
      "title_no_shop_name",
    )
  })

  it("counts description words after the transform, and finds nothing unsafe in what it produces", () => {
    const s = subject()
    expect(
      blocking(s, draft(s, { description: "## Only *seven* words in this heading here" })),
    ).toContain("description_min_words")
    expect(blocking(s, draft(s, { description: null }))).toContain("description_min_words")
    expect(blocking(s, draft(s))).not.toContain("description_markdown_safe")
  })

  it("wants three images of a type it takes, at least 910 × 607", () => {
    const two = subject({ assets: fullAssets().filter((a) => a.filename !== "waterfall.png") })
    expect(blocking(two, draft(two))).toContain("images_min")

    const small = subject({
      assets: fullAssets().map((a) =>
        a.filename === "specimen.jpg" ? { ...a, metadata: { width: 800, height: 600 } } : a,
      ),
    })
    expect(blocking(small, draft(small))).toContain("image_dimensions")

    const webp = subject({
      assets: fullAssets().map((a) =>
        a.filename === "specimen.jpg"
          ? { ...a, filename: "specimen.webp", mime_type: "image/webp" }
          : a,
      ),
    })
    expect(blocking(webp, draft(webp))).toContain("image_format")

    const gif = subject({
      assets: fullAssets().map((a) =>
        a.filename === "specimen.jpg"
          ? { ...a, filename: "loop.gif", mime_type: "image/gif", byte_size: 11 * 1024 * 1024 }
          : a,
      ),
    })
    expect(blocking(gif, draft(gif))).toContain("image_size_max")
    const bigGif = subject({
      assets: fullAssets().map((a) =>
        a.filename === "specimen.jpg"
          ? { ...a, filename: "loop.gif", mime_type: "image/gif", byte_size: 6 * 1024 * 1024 }
          : a,
      ),
    })
    expect(blocking(bigGif, draft(bigGif))).not.toContain("image_size_max")
    expect(advisory(bigGif, draft(bigGif))).toContain("image_size")
  })

  it("checks the price against the floor of the category and license, and never raises it", () => {
    const s = subject()
    expect(blocking(s, draft(s, { price: null }))).toContain("price_floor")
    const low = evaluate(creativeMarketAdapter, draft(s, { price: 10 }), s).results.find(
      (r) => r.key === "price_floor",
    )!
    expect(low.satisfied).toBe(false)
    expect(low.message).toMatch(/at least 15\.00/)
    // A single weight has a lower floor.
    expect(
      blocking(s, draft(s, { price: 12, metadata: { [FONT_LICENSE_SCOPE_KEY]: "individual" } })),
    ).not.toContain("price_floor")
    // No published floor, no check.
    const icons = subject({
      product: product({ product_type: "icon", base_price: 1, metadata: { kind: "raster" } }),
    })
    expect(blocking(icons, draft(icons, { category: "Icons", price: 1 }))).not.toContain(
      "price_floor",
    )
    const photos = subject({
      product: product({ product_type: "photo", metadata: { kind: "raster" } }),
    })
    expect(blocking(photos, draft(photos, { category: "Photos", price: 2 }))).toContain(
      "price_floor",
    )
  })

  it("blocks until the product answers the generative AI question, and never composes the answer", () => {
    const unanswered = subject({ product: product({ made_with_generative_ai: null }) })
    const rule = evaluate(creativeMarketAdapter, draft(unanswered), unanswered).results.find(
      (r) => r.key === "ai_disclosure_set",
    )!
    expect(rule.satisfied).toBe(false)
    expect(rule.message).toMatch(/on the product/)
    const yes = subject({ product: product({ made_with_generative_ai: true }) })
    expect(blocking(yes, draft(yes))).not.toContain("ai_disclosure_set")
  })

  it("wants one tag, advises five to ten, and flags near-duplicates", () => {
    const s = subject()
    expect(blocking(s, draft(s, { tags: [] }))).toContain("tags_min")
    expect(advisory(s, draft(s, { tags: ["one"] }))).toContain("tag_count")
    expect(advisory(s, draft(s, { tags: ["font", "Fonts", "sans", "serif", "type"] }))).toContain(
      "tag_quality",
    )
    expect(advisory(s, draft(s))).not.toContain("tag_quality")
  })

  it("warns a font without a license file, and notes mixed content", () => {
    const noLicense = subject({ assets: fullAssets().filter((a) => a.asset_type !== "license") })
    expect(advisory(noLicense, draft(noLicense))).toContain("font_license_file")
    expect(advisory(subject(), draft(subject()))).not.toContain("font_license_file")

    const mixed = subject({
      assets: [
        ...fullAssets(),
        asset({
          asset_type: "deliverable",
          filename: "poster.psd",
          mime_type: "image/vnd.adobe.photoshop",
        }),
      ],
    })
    const info = evaluate(creativeMarketAdapter, draft(mixed), mixed).results.find(
      (r) => r.key === "mixed_content_license",
    )!
    expect(info.message).toMatch(/Commercial License on the graphics/)
  })
})

describe("the package", () => {
  it("names every buyer file and attachment, in order, with a README from the record", () => {
    const s = subject()
    const spec = creativeMarketPackage(s)!
    expect(spec.filename).toBe("aster-grotesk-creative-market.zip")
    expect(spec.key).not.toMatch(/creative/i)
    expect(spec.entries.map((e) => e.path)).toEqual(["Aster-Regular.otf", "license.pdf"])
    expect(spec.entries.every((e) => e.checksum.startsWith("sum-"))).toBe(true)
    expect(spec.readme?.path).toBe("README.txt")
    expect(spec.readme?.text).toContain("Aster Grotesk Variable Sans Family")
    expect(spec.readme?.text).toContain("By Aster Type")
    expect(spec.readme?.text).toContain("Version 1.0")
    expect(spec.readme?.text).toContain("  Aster-Regular.otf")
    expect(spec.readme?.text).toContain("Desktop and web use for one studio.")
    expect(spec.readme?.text).toContain("Support: https://example.com/support")
    expect(spec.readme?.text).not.toMatch(/fanwise/i)
  })

  it("is null with nothing to package, and leaves derived rows and pending files out", () => {
    expect(creativeMarketPackage(subject({ assets: [asset()] }))).toBeNull()
    const s = subject({
      assets: [
        ...fullAssets(),
        asset({ asset_type: "deliverable", filename: "pending.otf", asset_state: "pending" }),
        asset({
          asset_type: "other",
          filename: "old.zip",
          derived_from: "asset-1",
          spec_hash: "h",
        }),
      ],
    })
    expect(creativeMarketPackage(s)!.entries.map((e) => e.path)).toEqual([
      "Aster-Regular.otf",
      "license.pdf",
    ])
  })

  it("writes a README a buyer can read with no record behind it", () => {
    const bare = subject({
      product: product({
        brand_name: null,
        version: null,
        license_summary: null,
        support_url: null,
        short_description: null,
      }),
    })
    const text = readmeText(bare, [])
    expect(text.split("\n")[0]).toBe("Aster Grotesk Variable Sans Family")
    expect(text).toContain("Files")
    expect(text).not.toContain("License")
  })
})

describe("renditions", () => {
  it("asks for every JPEG or PNG image once, in channel order, and passes a GIF through", () => {
    const s = subject({
      assets: [
        ...fullAssets(),
        asset({ filename: "loop.gif", mime_type: "image/gif" }),
        asset({ filename: "tiny.jpg", metadata: { width: 1000, height: 700 } }),
      ],
    })
    const wanted = creativeMarketAdapter.handoffImages!(s)
    expect(wanted.map((w) => [w.role, w.position, w.source.filename, w.spec.key])).toEqual([
      ["screenshot", 0, "cover.jpg", "cover-1820x1214"],
      ["screenshot", 1, "specimen.jpg", "cover-1820x1214"],
      ["screenshot", 2, "waterfall.png", "cover-1820x1214"],
      ["screenshot", 4, "tiny.jpg", "cover-910x607"],
    ])
  })
})

describe("the handoff", () => {
  function renditions(s: AdapterSubject, built = true): HandoffRendition[] {
    return creativeMarketAdapter.handoffImages!(s).map((w) => ({
      role: w.role,
      position: w.position,
      source: w.source,
      asset: built
        ? asset({
            filename: `${w.source.filename.replace(/\.[^.]+$/, "")}-${w.spec.key}.jpg`,
            derived_from: w.source.id,
            spec_hash: "h",
          })
        : null,
    }))
  }

  function pkg(s: AdapterSubject, built = true): HandoffPackage {
    const spec = creativeMarketPackage(s)!
    return {
      spec,
      asset: built
        ? asset({
            asset_type: "other",
            filename: spec.filename,
            mime_type: "application/zip",
            byte_size: 68 * 1024 * 1024,
            derived_from: spec.entries[0]!.assetId,
            spec_hash: "p",
            metadata: {
              entryCount: 3,
              entries: ["Aster-Regular.otf", "license.pdf", "README.txt"],
            },
          })
        : null,
    }
  }

  function steps(s: AdapterSubject, d: ChannelListingDraft, built = true): HandoffStep[] {
    const images = creativeMarketAdapter.handoffImages!(s).map((w) => ({
      assetId: w.source.id,
      filename: w.source.filename,
      ready: true,
    }))
    return handoffSteps(creativeMarketAdapter, {
      draft: d,
      subject: s,
      images,
      renditions: renditions(s, built),
      package: pkg(s, built),
    })
  }

  it("runs in the editor's order: category, files, name, description, screenshots, prices, tags, disclosure, live", () => {
    const s = subject()
    const sections = [
      ...new Set(
        steps(s, draft(s, { metadata: { [SUBCATEGORY_KEY]: "Sans Serif" } })).map(
          (st) => st.section,
        ),
      ),
    ]
    expect(sections).toEqual([
      SECTIONS.category,
      SECTIONS.files,
      SECTIONS.name,
      SECTIONS.description,
      SECTIONS.screenshots,
      SECTIONS.prices,
      SECTIONS.tags,
      SECTIONS.disclosure,
      SECTIONS.live,
    ])
  })

  it("hands over the package under its name with what it holds, and the screenshots numbered", () => {
    const s = subject()
    const byKey = new Map(steps(s, draft(s)).map((st) => [st.key, st]))
    expect(byKey.get("category")).toMatchObject({ kind: "copy", value: "Fonts" })
    expect(byKey.get("package")).toMatchObject({
      kind: "files",
      files: [
        {
          filename: "aster-grotesk-creative-market.zip",
          downloadAs: "aster-grotesk-creative-market.zip",
        },
      ],
    })
    expect((byKey.get("package") as { note: string }).note).toMatch(
      /68 MB\. Contains 3 files: Aster-Regular\.otf, license\.pdf, README\.txt/,
    )
    expect(byKey.get("screenshots")).toMatchObject({
      kind: "files",
      files: [
        { filename: "01-cover-cover-1820x1214.jpg" },
        { filename: "02-specimen-cover-1820x1214.jpg" },
        { filename: "03-waterfall-cover-1820x1214.jpg" },
      ],
      note: "Upload in filename order. The first becomes the thumbnail.",
    })
  })

  it("copies the description as formatted text with the words as fallback, and says how many", () => {
    const s = subject()
    const description = steps(s, draft(s)).find((st) => st.key === "description")!
    expect(description.kind).toBe("copy")
    if (description.kind !== "copy") return
    expect(description.html).toContain("<p><strong>A neo-grotesque for interfaces</strong></p>")
    expect(description.html).toContain("<ul><li>Fourteen weights</li><li>A license</li></ul>")
    expect(description.html).not.toContain("https://")
    expect(description.value).not.toContain("**")
    expect(description.value).toContain("A neo-grotesque for interfaces")
    expect(description.note).toMatch(/^\d+ words\. Copies as formatted text/)
  })

  it("prices a font by license type from the record, with the observed figure beside each", () => {
    const s = subject()
    const prices = steps(s, draft(s)).filter((st) => st.section === SECTIONS.prices)
    expect(prices.map((st) => [st.key, st.kind, (st as { value?: string }).value])).toEqual([
      ["price_desktop", "copy", "24.00"],
      ["price_epub", "copy", "30.00"],
      ["price_app", "copy", "90.00"],
    ])
    expect((prices[0] as { label: string }).label).toBe("Desktop & Webfont (family), USD")
    expect((prices[0] as { note: string }).note).toMatch(/showed 15\.00 USD; unconfirmed/)
  })

  it("prices a standard product by tier, copying the listing's price and noting the other floors", () => {
    const s = subject({
      product: product({ product_type: "template", metadata: { kind: "template" } }),
    })
    const prices = steps(s, draft(s, { category: "Templates & Themes", price: 12 })).filter(
      (st) => st.section === SECTIONS.prices,
    )
    expect(prices.map((st) => [st.key, st.kind])).toEqual([
      ["price_personal", "copy"],
      ["price_commercial", "note"],
      ["price_extended", "note"],
    ])
    expect((prices[0] as { note: string }).note).toBe("Creative Market's floor is 9.00 USD.")
    expect((prices[1] as { text: string }).text).toMatch(/floor is 14\.00 USD/)
  })

  it("shows the disclosure from the product and says where to change it", () => {
    const s = subject()
    const disclosure = steps(s, draft(s)).find((st) => st.key === "disclosure")!
    expect(disclosure).toMatchObject({ kind: "note", label: "Answer: No" })
    const unanswered = subject({ product: product({ made_with_generative_ai: null }) })
    expect(steps(unanswered, draft(unanswered)).find((st) => st.key === "disclosure")?.kind).toBe(
      "missing",
    )
  })

  it("says the package and screenshots are not ready until they are built", () => {
    const s = subject()
    const byKey = new Map(steps(s, draft(s), false).map((st) => [st.key, st]))
    expect(byKey.get("package")?.kind).toBe("missing")
    expect(byKey.get("screenshots")?.kind).toBe("missing")
  })

  it("offers the search engine fields only when they are set, and never says publish", () => {
    const s = subject()
    expect(steps(s, draft(s)).some((st) => st.section === SECTIONS.search)).toBe(false)
    const withSeo = steps(
      s,
      draft(s, { seoTitle: "Aster Grotesk font", seoDescription: "A sans." }),
    )
    expect(withSeo.filter((st) => st.section === SECTIONS.search).map((st) => st.key)).toEqual([
      "seo_title",
      "seo_description",
    ])
    const text = JSON.stringify(withSeo)
    expect(text).not.toMatch(/publish/i)
    expect(text).toContain("Fanwise sends nothing to Creative Market.")
  })
})
