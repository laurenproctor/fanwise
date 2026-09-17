import { brotliDecompressSync, inflateSync } from "node:zlib"
import { describe, expect, it } from "vitest"
import { inspectFont } from "@/lib/fonts/inspect"
import { detectLanguages, detectScripts, groupFeatures, mergeRanges } from "@/lib/fonts/coverage"
import type { DetectedFont } from "@/lib/fonts/detected"
import {
  adoptionPatch,
  cropLoss,
  detectFamily,
  fontFileViews,
  liveDraftValue,
  unlistedStyles,
  type ChannelDraftView,
  type FontProductValues,
  unreadFontFiles,
} from "@/lib/fonts/workspace"
import { evaluateFontReadiness, type FontReadinessInput } from "@/lib/fonts/readiness"
import {
  combinePatches,
  isEmptyPatch,
  mergeFontMetadata,
  productPatchSchema,
} from "@/lib/fonts/save"
import { fontMetadataSchema, parseMetadata, type FontMetadata } from "@/lib/products/metadata"
import type { ProductAsset } from "@/lib/products/types"
import { buildSfnt, buildWoff, buildWoff2, type FontSpec } from "./font-fixtures"

/**
 * The font publishing workspace, below the screen.
 *
 * Everything the workspace decides is decided by a pure function over rows: what
 * a file says, what a family is, what the product should adopt, what blocks
 * publishing. These tests hold those decisions still, using the design brief's
 * own example family — Blimp Display, 624 glyphs, Latin, Cyrillic and Kana.
 */

const decompress = {
  inflate: (data: Uint8Array) => inflateSync(data),
  brotli: (data: Uint8Array) => brotliDecompressSync(data),
}

const BLIMP_RANGES: Array<[number, number]> = [
  [0x20, 0x7e],
  [0x410, 0x44f],
  [0x3041, 0x3096],
]

function blimp(style: string, extra: Partial<FontSpec> = {}): FontSpec {
  return {
    family: "Blimp Display",
    style,
    designer: "Lauren Proctor",
    glyphCount: 624,
    ranges: BLIMP_RANGES,
    features: ["kern", "liga", "ss01", "tnum"],
    ...extra,
  }
}

function read(bytes: Uint8Array): DetectedFont {
  const result = inspectFont(bytes, decompress)
  if (!result.ok) throw new Error(`expected a reading, got ${result.problem}`)
  return result.font
}

/* ------------------------------------------------------------------ parser */

describe("reading a font file", () => {
  it("reads family, style, weight, glyphs and coverage from a TTF", () => {
    const font = read(buildSfnt(blimp("Inline", { weight: 400, version: "1.000" })))
    expect(font).toMatchObject({
      format: "ttf",
      outlines: "truetype",
      familyName: "Blimp Display",
      styleName: "Inline",
      fullName: "Blimp Display Inline",
      postscriptName: "BlimpDisplay-Inline",
      designer: "Lauren Proctor",
      version: "1.000",
      weight: 400,
      width: 5,
      italic: false,
      glyphCount: 624,
      isVariable: false,
      scripts: ["Latin", "Cyrillic", "Kana"],
      embedding: "installable",
    })
    expect(font.features).toEqual(["kern", "liga", "ss01", "tnum"])
  })

  it("reads the same facts through WOFF and WOFF2", () => {
    const spec = blimp("Shadow", { weight: 700, italic: true })
    const ttf = read(buildSfnt(spec))
    const woff = read(buildWoff(spec))
    const woff2 = read(buildWoff2(spec))

    expect(woff.format).toBe("woff")
    expect(woff2.format).toBe("woff2")
    for (const font of [woff, woff2]) {
      expect({ ...font, format: "ttf" }).toEqual(ttf)
    }
    expect(ttf.italic).toBe(true)
  })

  it("names CFF outlines and a format 12 character map", () => {
    const font = read(buildSfnt(blimp("Regular", { cff: true, cmapFormat: 12 })))
    expect(font.outlines).toBe("cff")
    expect(font.scripts).toEqual(["Latin", "Cyrillic", "Kana"])
  })

  it("reads variation axes and says the font is variable", () => {
    const font = read(
      buildSfnt(blimp("Variable", { axes: [{ tag: "wght", min: 100, default: 400, max: 900 }] })),
    )
    expect(font.isVariable).toBe(true)
    expect(font.axes).toEqual([{ tag: "wght", name: "Weight", min: 100, default: 400, max: 900 }])
  })

  it("records a restrictive embedding permission", () => {
    expect(read(buildSfnt(blimp("Regular", { fsType: 0x0002 }))).embedding).toBe("restricted")
  })

  it("refuses what it cannot read, with a reason, and never throws", () => {
    const valid = buildSfnt(blimp("Regular"))
    expect(inspectFont(valid.subarray(0, 40), decompress)).toEqual({
      ok: false,
      problem: "malformed",
    })
    expect(
      inspectFont(
        Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20]),
        decompress,
      ),
    ).toEqual({
      ok: false,
      problem: "unrecognised",
    })
    const collection = new Uint8Array(32)
    collection.set([0x74, 0x74, 0x63, 0x66])
    expect(inspectFont(collection, decompress)).toEqual({ ok: false, problem: "collection" })

    // A corrupt compressed table is a malformed file, not an exception.
    const woff = buildWoff(blimp("Regular"))
    woff.fill(0xff, 200, 260)
    expect(inspectFont(woff, decompress).ok).toBe(false)
  })
})

/* ---------------------------------------------------------------- coverage */

describe("coverage in words", () => {
  it("claims a script only past its threshold", () => {
    expect(
      detectScripts(
        mergeRanges([
          [0x41, 0x5a],
          [0x61, 0x7a],
          [0x3a9, 0x3a9],
        ]),
      ),
    ).toEqual(["Latin"])
    expect(detectScripts(mergeRanges(BLIMP_RANGES))).toEqual(["Latin", "Cyrillic", "Kana"])
  })

  it("claims a language only when its letters are present in both cases", () => {
    const withGerman = mergeRanges([
      [0x20, 0x7e],
      [0xc4, 0xc4],
      [0xd6, 0xd6],
      [0xdc, 0xdc],
      [0xdf, 0xdf],
      [0xe4, 0xe4],
      [0xf6, 0xf6],
      [0xfc, 0xfc],
    ])
    expect(detectLanguages(withGerman)).toContain("German")
    const lowercaseOnly = mergeRanges([
      [0x20, 0x7e],
      [0xdf, 0xdf],
      [0xe4, 0xe4],
      [0xf6, 0xf6],
      [0xfc, 0xfc],
    ])
    expect(detectLanguages(lowercaseOnly)).not.toContain("German")
    expect(detectLanguages(lowercaseOnly)).toContain("English")
  })

  it("groups feature tags the way a buyer thinks about them", () => {
    const groups = groupFeatures(["kern", "liga", "ss01", "ss12", "tnum", "onum", "zzzz"])
    expect(groups.ligatures).toEqual(["liga"])
    expect(groups.alternates).toEqual(["ss01", "ss12"])
    expect(groups.numerals).toEqual(["tnum", "onum"])
    expect(groups.spacing).toEqual(["kern"])
  })
})

/* ------------------------------------------------------------------ family */

let assetCounter = 0

function asset(overrides: Partial<ProductAsset>): ProductAsset {
  assetCounter += 1
  return {
    id: `asset-${assetCounter}`,
    workspace_id: "ws",
    product_id: "product",
    asset_type: "deliverable",
    asset_state: "ready",
    storage_path: `ws/product/asset-${assetCounter}`,
    filename: `file-${assetCounter}.otf`,
    mime_type: "font/otf",
    byte_size: 1000,
    checksum: `sum-${assetCounter}`,
    sort_order: 0,
    derived_from: null,
    spec_hash: null,
    failure_reason: null,
    metadata: {},
    created_at: `2026-09-13T00:00:${String(assetCounter % 60).padStart(2, "0")}Z`,
    ...overrides,
  }
}

function fontAsset(spec: FontSpec, overrides: Partial<ProductAsset> = {}, build = buildSfnt) {
  return asset({ metadata: { font: read(build(spec)) }, ...overrides })
}

const BLIMP_FAMILY = [
  fontAsset(blimp("Regular"), { filename: "BlimpDisplay-Regular.otf" }),
  fontAsset(
    blimp("Regular"),
    { filename: "BlimpDisplay-Regular.woff2", mime_type: "font/woff2" },
    buildWoff2,
  ),
  fontAsset(blimp("Inline"), { filename: "BlimpDisplay-Inline.otf" }),
  fontAsset(
    blimp("Shadow", {
      ranges: [
        [0x20, 0x7e],
        [0x410, 0x44f],
      ],
      glyphCount: 540,
    }),
    {
      filename: "BlimpDisplay-Shadow.otf",
    },
  ),
]

describe("the family, as the files describe it", () => {
  it("groups files into styles by PostScript name, with every format each has", () => {
    const family = detectFamily(fontFileViews(BLIMP_FAMILY))
    expect(family.styles.map((s) => s.name)).toEqual([
      "Blimp Display Inline",
      "Blimp Display Regular",
      "Blimp Display Shadow",
    ])
    expect(family.styles.find((s) => s.name.endsWith("Regular"))!.formats).toEqual(["ttf", "woff2"])
    expect(family.familyNames).toEqual(["Blimp Display"])
    expect(family.designer).toBe("Lauren Proctor")
  })

  it("claims coverage only where every style has it", () => {
    const family = detectFamily(fontFileViews(BLIMP_FAMILY))
    // The Shadow style has no Kana, so the family does not.
    expect(family.scripts).toEqual(["Latin", "Cyrillic"])
    expect(family.glyphCount).toBe(540)
  })

  it("ignores a duplicate upload and names the file it duplicates", () => {
    const original = fontAsset(blimp("Regular"), { filename: "a.otf", checksum: "same" })
    const copy = fontAsset(blimp("Regular"), { filename: "b.otf", checksum: "same" })
    const files = fontFileViews([original, copy])
    expect(files[1]!.duplicateOf).toBe("a.otf")
    expect(detectFamily(files).readCount).toBe(1)
  })

  it("reports a ready file named like a font whose bytes are not one", () => {
    const files = fontFileViews([
      asset({ filename: "fake.otf", mime_type: "application/octet-stream" }),
    ])
    expect(files[0]!.reading).toEqual({ kind: "problem", problem: "unrecognised" })
  })

  it("lists the ready fonts the job never read, and nothing else", () => {
    const unread = asset({ filename: "BlimpDisplay-Solid.otf", metadata: {} })
    const files = fontFileViews([
      unread,
      fontAsset(blimp("Regular")),
      asset({ filename: "fake.otf", mime_type: "application/octet-stream" }),
      asset({ filename: "later.otf", asset_state: "pending", mime_type: null, metadata: {} }),
      asset({ filename: "package.zip", asset_type: "archive", mime_type: "application/zip" }),
    ])
    expect(files[0]!.reading).toEqual({ kind: "none" })
    // A ready package nobody has looked inside is asked to be read, like a
    // font settled before fonts were read.
    expect(unreadFontFiles(files).map((file) => file.filename)).toEqual([
      files[0]!.filename,
      "package.zip",
    ])
  })

  it("reads a package's contents, and a package that could not be opened", () => {
    const opened = asset({
      filename: "blimp.zip",
      asset_type: "archive",
      mime_type: "application/zip",
      metadata: {
        archive: {
          entries: [
            {
              path: "Blimp/Blimp-Regular.otf",
              byteSize: 10,
              kind: "font",
              font: read(buildSfnt(blimp("Regular"))),
            },
            { path: "Blimp/README.txt", byteSize: 3, kind: "document" },
          ],
          entryCount: 2,
          fontCount: 1,
          ignoredCount: 0,
          truncated: false,
        },
      },
    })
    const broken = asset({
      filename: "broken.zip",
      asset_type: "archive",
      mime_type: "application/zip",
      metadata: { archiveProblem: "malformed" },
    })
    const files = fontFileViews([opened, broken])
    expect(files[0]!.archive.kind).toBe("archive")
    expect(files[1]!.archive).toEqual({ kind: "problem", problem: "malformed" })
    expect(unreadFontFiles(files)).toEqual([])
  })
})

describe("a family uploaded as one package", () => {
  const entry = (path: string, font: DetectedFont) => ({ path, byteSize: 10, kind: "font", font })
  const packaged = asset({
    filename: "blimp-display.zip",
    asset_type: "archive",
    mime_type: "application/zip",
    metadata: {
      archive: {
        entries: [
          entry("OTF/BlimpDisplay-Regular.otf", read(buildSfnt(blimp("Regular", { weight: 400 })))),
          entry("OTF/BlimpDisplay-Bold.otf", read(buildSfnt(blimp("Bold", { weight: 700 })))),
          entry(
            "Web/BlimpDisplay-Regular.woff2",
            read(buildWoff2(blimp("Regular", { weight: 400 }))),
          ),
          { path: "Web/odd.otf", byteSize: 10, kind: "font", problem: "malformed" },
          { path: "License.pdf", byteSize: 10, kind: "document" },
        ],
        entryCount: 5,
        fontCount: 4,
        ignoredCount: 1,
        truncated: false,
      },
    },
  })

  it("is detected exactly as it would be from its files", () => {
    const family = detectFamily(fontFileViews([packaged]))
    expect(family.familyNames).toEqual(["Blimp Display"])
    expect(family.styles.map((style) => style.name)).toEqual([
      "Blimp Display Regular",
      "Blimp Display Bold",
    ])
    // buildSfnt writes TrueType outlines, so the fixture's .otf reads as ttf.
    expect(family.styles[0]!.formats).toEqual(["ttf", "woff2"])
    expect(family.formats).toEqual(["ttf", "woff2"])
    expect(family.readCount).toBe(3)
  })

  it("satisfies the font-files blocker and flags the font inside it could not read", () => {
    const files = fontFileViews([packaged])
    const readiness = evaluateFontReadiness(readinessInput({ files, family: detectFamily(files) }))
    const byKey = new Map(readiness.rules.map((rule) => [rule.key, rule]))
    expect(byKey.get("files.present")?.satisfied).toBe(true)
    expect(byKey.get("files.packagedFonts")?.satisfied).toBe(false)
    expect(byKey.get("files.packagedFonts")?.label).toBe(
      "Check the font file inside blimp-display.zip",
    )
  })
})

/* ---------------------------------------------------------------- adoption */

const EMPTY_VALUES: FontProductValues = {
  name: "Blimp Display",
  canonicalTitle: "",
  slug: "blimp-display",
  shortDescription: "",
  canonicalDescription: "",
  brandName: "",
  version: "",
  basePrice: null,
  currency: "USD",
  licenseSummary: "",
}

describe("what the product adopts from its files", () => {
  const family = detectFamily(fontFileViews(BLIMP_FAMILY))

  it("fills every unanswered fact, once", () => {
    const patch = adoptionPatch({ metadata: { kind: "font" }, values: EMPTY_VALUES, family })!
    expect(patch.brandName).toBe("Lauren Proctor")
    expect(patch.version).toBe("1.000")
    expect(patch.font).toMatchObject({
      glyphCount: 540,
      scripts: ["Latin", "Cyrillic"],
      isVariable: false,
      styleCount: 3,
      formats: ["ttf", "woff2"],
    })
    expect(patch.font!.styles!.map((s) => s.name)).toHaveLength(3)
  })

  it("never replaces a value the creator set", () => {
    const metadata: FontMetadata = {
      kind: "font",
      glyphCount: 624,
      scripts: ["Latin", "Cyrillic", "Kana"],
      languageSupport: [],
      features: [],
      isVariable: false,
      styles: [{ key: "BlimpDisplay-Regular", name: "Regular (corrected)" }],
      formats: ["ttf", "woff2"],
    }
    const patch = adoptionPatch({
      metadata,
      values: { ...EMPTY_VALUES, brandName: "Proctor Type", version: "2.0" },
      family,
    })
    expect(patch).toBeNull()
  })

  it("offers a newly uploaded style instead of adding it", () => {
    const metadata: FontMetadata = {
      kind: "font",
      styles: [{ key: "BlimpDisplay-Regular", name: "Blimp Display Regular" }],
    }
    const patch = adoptionPatch({ metadata, values: EMPTY_VALUES, family })
    expect(patch?.font?.styles).toBeUndefined()
    expect(unlistedStyles(metadata, family).map((s) => s.key)).toEqual([
      "BlimpDisplay-Inline",
      "BlimpDisplay-Shadow",
    ])
  })

  it("keeps formats in step with the files, since nobody claims them", () => {
    const patch = adoptionPatch({
      metadata: { kind: "font", formats: ["otf"], styles: [] },
      values: { ...EMPTY_VALUES, brandName: "x", version: "1" },
      family,
    })
    expect(patch?.font?.formats).toEqual(["ttf", "woff2"])
  })
})

/* --------------------------------------------------------------- readiness */

function readinessInput(overrides: Partial<FontReadinessInput> = {}): FontReadinessInput {
  const files = fontFileViews(BLIMP_FAMILY.slice(0, 3))
  const family = detectFamily(files)
  return {
    values: {
      ...EMPTY_VALUES,
      brandName: "Lauren Proctor",
      version: "1.0",
      basePrice: 19,
      canonicalDescription: "A round, inflated display face.",
      licenseSummary: "Desktop and web use by the buyer.",
    },
    metadata: {
      kind: "font",
      classification: "display",
      glyphCount: 624,
      scripts: ["Latin", "Cyrillic", "Kana"],
      styles: family.styles.map((s) => ({ key: s.key, name: s.name })),
      licenses: [{ kind: "desktop" }],
    },
    files,
    family,
    images: [
      {
        id: "img",
        filename: "hero.png",
        assetType: "cover_image",
        state: "ready",
        checksum: "c",
        width: 2400,
        height: 1800,
        altText: "Blimp",
        altTextSource: null,
      },
    ],
    channels: [],
    hasLicenseFile: false,
    ...overrides,
  }
}

function channel(overrides: Partial<ChannelDraftView> = {}): ChannelDraftView {
  return {
    connectionId: "conn",
    channelName: "Storefront",
    integrationType: "api",
    listingId: "listing",
    title: "Blimp Display",
    description: null,
    tags: [],
    category: null,
    price: 19,
    currency: "USD",
    results: [],
    liveness: "unpublished",
    externalUrl: null,
    editHref: "/x",
    origins: { title: "inherited", description: "inherited", price: "inherited" },
    ...overrides,
  }
}

describe("font listing readiness", () => {
  it("lets a complete font publish", () => {
    const readiness = evaluateFontReadiness(readinessInput())
    expect(readiness.blockingAll).toEqual([])
    expect(readiness.canPublish).toBe(true)
    expect(readiness.sections.files).toBe("complete")
    expect(readiness.sections.licensing).toBe("complete")
  })

  it("blocks all publishing on a missing price, and says where to fix it", () => {
    const readiness = evaluateFontReadiness(
      readinessInput({ values: { ...readinessInput().values, basePrice: null } }),
    )
    expect(readiness.canPublish).toBe(false)
    expect(readiness.blockingAll.map((r) => r.key)).toEqual(["licensing.price"])
    expect(readiness.blockingAll[0]).toMatchObject({
      section: "licensing",
      fieldId: "font-base-price",
      scope: { kind: "all" },
    })
    expect(readiness.sections.licensing).toBe("incomplete")
  })

  it("never blocks on an optional recommendation or an attention item", () => {
    const readiness = evaluateFontReadiness(
      readinessInput({
        values: { ...readinessInput().values, canonicalDescription: "", brandName: "" },
        images: [],
      }),
    )
    expect(readiness.canPublish).toBe(true)
    expect(readiness.issues.map((r) => r.key)).toEqual(
      expect.arrayContaining(["basics.description", "family.designer", "images.cover"]),
    )
    // Optional rules never count toward the percentage.
    const optionalOnly = readiness.rules.filter((r) => r.severity === "optional")
    expect(optionalOnly.length).toBeGreaterThan(0)
    expect(readiness.percent).toBeLessThan(100)
  })

  it("asks for web license terms, the design brief's first example issue", () => {
    const base = readinessInput()
    const readiness = evaluateFontReadiness(
      readinessInput({
        metadata: { ...base.metadata, licenses: [{ kind: "desktop" }, { kind: "web" }] },
      }),
    )
    const rule = readiness.issues.find((r) => r.key === "licensing.webTerms")
    expect(rule).toMatchObject({ label: "Add web license terms", severity: "attention" })
    expect(readiness.sections.licensing).toBe("attention")

    const withLimit = evaluateFontReadiness(
      readinessInput({
        metadata: { ...base.metadata, licenses: [{ kind: "web", monthlyPageviews: 10_000 }] },
      }),
    )
    expect(withLimit.issues.find((r) => r.key === "licensing.webTerms")).toBeUndefined()
  })

  it("asks to review marketplace pricing when a customized price differs", () => {
    const readiness = evaluateFontReadiness(
      readinessInput({
        channels: [
          channel({
            price: 24,
            origins: { title: "inherited", description: "inherited", price: "customized" },
          }),
        ],
      }),
    )
    const rule = readiness.issues.find((r) => r.key.startsWith("licensing.channelPrice"))
    expect(rule).toMatchObject({
      label: "Review marketplace pricing",
      scope: { kind: "channel", channelName: "Storefront" },
    })
    expect(readiness.canPublish).toBe(true)
  })

  it("never flags an inherited price, which follows the product", () => {
    // A stale resolved price from the last server read is not a disagreement:
    // the draft sends whatever the product says when it is published.
    const readiness = evaluateFontReadiness(readinessInput({ channels: [channel({ price: 24 })] }))
    expect(readiness.rules.find((r) => r.key.startsWith("licensing.channelPrice"))).toBeUndefined()
  })

  it("lets a channel's own blocker block that channel only", () => {
    const readiness = evaluateFontReadiness(
      readinessInput({
        channels: [
          channel({
            results: [
              {
                key: "tags",
                label: "Tags",
                severity: "error",
                satisfied: false,
                message: "Add tags.",
              },
            ],
          }),
        ],
      }),
    )
    const rule = readiness.issues.find((r) => r.key.endsWith(".tags"))!
    expect(rule.severity).toBe("blocker")
    expect(rule.scope).toEqual({ kind: "channel", channelName: "Storefront" })
    expect(readiness.canPublish).toBe(true)
    expect(readiness.sections.drafts).toBe("error")
  })

  it("treats an unreadable font file as a blocking error", () => {
    const broken = fontFileViews([
      asset({ filename: "broken.otf", metadata: { fontProblem: "malformed" } }),
    ])
    const readiness = evaluateFontReadiness(
      readinessInput({ files: [...readinessInput().files, ...broken] }),
    )
    expect(readiness.blockingAll.map((r) => r.key)).toContain("files.unreadable")
    expect(readiness.sections.files).toBe("error")
  })
})

/* -------------------------------------------------------------------- save */

describe("saving a patch", () => {
  it("accepts canonical fields and font keys, and nothing else", () => {
    expect(
      productPatchSchema.safeParse({ shortDescription: "Playful type", font: { tags: ["retro"] } })
        .success,
    ).toBe(true)
    expect(productPatchSchema.safeParse({ status: "published" }).success).toBe(false)
    expect(productPatchSchema.safeParse({ font: { kind: "template" } }).success).toBe(false)
    expect(productPatchSchema.safeParse({ slug: "new" }).success).toBe(false)
    expect(productPatchSchema.safeParse({ basePrice: -1 }).success).toBe(false)
  })

  it("turns an emptied text field into a cleared column", () => {
    expect(productPatchSchema.parse({ canonicalTitle: "   " }).canonicalTitle).toBeNull()
  })

  it("merges metadata key by key, clears on null, and refuses an invalid result", () => {
    const stored = { kind: "font", glyphCount: 624, scripts: ["Latin"] }
    const merged = mergeFontMetadata(stored, { scripts: ["Latin", "Kana"], glyphCount: null })
    expect(merged).toEqual({ ok: true, metadata: { kind: "font", scripts: ["Latin", "Kana"] } })

    const refused = mergeFontMetadata(stored, { glyphCount: -5 })
    expect(refused).toMatchObject({ ok: false, field: "font.glyphCount" })
  })

  it("combines queued saves with the newer edit winning, font keys included", () => {
    const combined = combinePatches(
      { name: "Blimp", font: { tags: ["a"], glyphCount: 1 } },
      { name: "Blimp Display", font: { tags: ["b"] } },
    )
    expect(combined).toEqual({ name: "Blimp Display", font: { tags: ["b"], glyphCount: 1 } })
    expect(isEmptyPatch({ font: {} })).toBe(true)
  })

  it("keeps an existing font product's metadata readable", () => {
    const legacy = { kind: "font", styleCount: 9, formats: ["otf", "woff2"], glyphCount: 612 }
    expect(fontMetadataSchema.safeParse(legacy).success).toBe(true)
    expect(parseMetadata(legacy)).toEqual(legacy)
  })
})

describe("image crops", () => {
  it("measures what a grid shape discards", () => {
    expect(cropLoss(1200, 1200, 1)).toBe(0)
    expect(cropLoss(2400, 1200, 1)).toBeCloseTo(0.5)
    expect(cropLoss(1600, 1200, 4 / 3)).toBeCloseTo(0)
  })
})

describe("the product page for anything that is not a font", () => {
  it("renders the workspace and its wide canvas only inside the font branch", async () => {
    const { readFileSync } = await import("node:fs")
    const { join } = await import("node:path")
    const page = readFileSync(
      join(__dirname, "..", "..", "app", "[slug]", "[productSlug]", "page.tsx"),
      "utf8",
    )
    const branchStart = page.indexOf('if (product.product_type === "font") {')
    const branchEnd = page.indexOf("const assets = await listProductAssets(product.id)")
    expect(branchStart).toBeGreaterThan(-1)
    expect(branchEnd).toBeGreaterThan(branchStart)

    for (const marker of ["data-workspace-canvas", "<FontWorkspace"]) {
      const at = page.indexOf(marker)
      expect(at, marker).toBeGreaterThan(branchStart)
      expect(at, marker).toBeLessThan(branchEnd)
      expect(page.indexOf(marker, at + 1), `${marker} appears once`).toBe(-1)
    }
    // The original editor is still what every other product type gets.
    expect(page.indexOf("<ProductForm")).toBeGreaterThan(branchEnd)
  })
})

/* ----------------------------------------------------------- channel drafts */

describe("a channel draft's live values", () => {
  const values = {
    name: "Blimp Display",
    canonicalTitle: "",
    canonicalDescription: "Playful **bubble** type",
    basePrice: 19,
  }

  it("shows what the product says now for an inherited field", () => {
    const draft = channel({ title: "Old title", price: 12 })
    expect(liveDraftValue(draft, "title", values)).toBe("Blimp Display")
    expect(liveDraftValue(draft, "price", { ...values, basePrice: 29 })).toBe(29)
    expect(liveDraftValue(draft, "description", values)).toBe("Playful **bubble** type")
  })

  it("keeps a customized field as the channel saved it, whatever the product says", () => {
    const draft = channel({
      title: "Blimp Display — bubble font",
      price: 24,
      origins: { title: "customized", description: "inherited", price: "customized" },
    })
    expect(liveDraftValue(draft, "title", { ...values, canonicalTitle: "Changed" })).toBe(
      "Blimp Display — bubble font",
    )
    expect(liveDraftValue(draft, "price", { ...values, basePrice: 99 })).toBe(24)
  })

  it("says nothing for a field the channel has no place for", () => {
    const draft = channel({
      origins: { title: "inherited", description: "inherited", price: "absent" },
    })
    expect(liveDraftValue(draft, "price", values)).toBeNull()
  })
})
