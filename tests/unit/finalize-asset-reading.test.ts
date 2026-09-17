import { readFile } from "node:fs/promises"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { buildSfnt } from "./font-fixtures"

/*
  The finalize job, run for real, with storage and the service-role client
  replaced. What is under test is the second thing the job now does: a row
  that is already ready is left alone, except that a font with no reading gets
  one, written to `metadata` and nothing else. The parser itself is proven in
  font-workspace.test.ts.
*/
const state = vi.hoisted(() => ({
  asset: null as Record<string, unknown> | null,
  updates: [] as Array<Record<string, unknown>>,
  downloads: 0,
  bytes: new Uint8Array() as Uint8Array<ArrayBufferLike>,
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: state.asset, error: null }) }),
        }),
      }),
      update: (patch: Record<string, unknown>) => {
        state.updates.push(patch)
        return { eq: () => ({ eq: async () => ({ error: null }) }) }
      },
    }),
  }),
}))
vi.mock("@/lib/products/storage", () => ({
  downloadObject: async () => {
    state.downloads += 1
    return Buffer.from(state.bytes)
  },
  buildStoragePath: () => "",
  uploadObject: async () => {},
  removeObjects: async () => {},
  sanitizeFilename: (name: string) => name,
}))

import { finalizeAsset } from "@/lib/products/assets"
import { readArchive, readFontAsset } from "@/lib/fonts/detected"
import { buildZip } from "./zip-fixtures"

const payload = { workspaceId: "workspace-1", assetId: "asset-1" }

function row(overrides: Record<string, unknown>) {
  return {
    id: "asset-1",
    workspace_id: "workspace-1",
    product_id: "product-1",
    asset_type: "deliverable",
    asset_state: "ready",
    storage_path: "workspace-1/product-1/asset-1/BlimpDisplay-Inline.ttf",
    filename: "BlimpDisplay-Inline.ttf",
    mime_type: "font/ttf",
    byte_size: 1000,
    checksum: "sum",
    sort_order: 0,
    derived_from: null,
    spec_hash: null,
    failure_reason: null,
    metadata: {},
    created_at: "2026-09-16T00:00:00Z",
    ...overrides,
  }
}

const inline = buildSfnt({ family: "Blimp Display", style: "Inline", weight: 400 })

beforeEach(() => {
  state.asset = null
  state.updates = []
  state.downloads = 0
  state.bytes = inline
})

describe("finalize_asset on a pending picture", () => {
  it("measures it, makes it ready, and asks for alt text when it has none", async () => {
    state.asset = row({
      asset_type: "cover_image",
      asset_state: "pending",
      filename: "cover.png",
      mime_type: null,
      checksum: null,
      metadata: {},
    })
    state.bytes = new Uint8Array(await readFile("tests/fixtures/small-800x600.png"))

    const outcome = await finalizeAsset(payload)

    expect(outcome).toEqual({ describe: true })
    expect(state.updates[0]).toMatchObject({
      asset_state: "ready",
      mime_type: "image/png",
      metadata: { width: 800, height: 600 },
    })
  })

  it("does not ask for alt text the creator already wrote, or for a buyer's file", async () => {
    state.asset = row({
      asset_type: "cover_image",
      asset_state: "pending",
      mime_type: null,
      metadata: { altText: "Mine." },
    })
    state.bytes = new Uint8Array(await readFile("tests/fixtures/small-800x600.png"))
    expect(await finalizeAsset(payload)).toEqual({ describe: false })

    state.asset = row({ asset_state: "pending", mime_type: null })
    state.bytes = inline
    expect(await finalizeAsset(payload)).toEqual({ describe: false })
  })
})

describe("finalize_asset on a package", () => {
  const zip = () =>
    new Uint8Array(
      buildZip([
        { path: "Blimp/BlimpDisplay-Inline.ttf", data: inline },
        { path: "Blimp/README.txt", data: new TextEncoder().encode("hello") },
      ]),
    )

  it("looks inside a pending ZIP in the same update that makes it ready", async () => {
    state.asset = row({
      asset_type: "archive",
      asset_state: "pending",
      filename: "blimp.zip",
      mime_type: null,
      metadata: {},
    })
    state.bytes = zip()

    const outcome = await finalizeAsset(payload)

    expect(outcome).toEqual({ describe: false })
    expect(state.updates).toHaveLength(1)
    expect(state.updates[0]).toMatchObject({ asset_state: "ready", mime_type: "application/zip" })
    const archive = readArchive(state.updates[0]!.metadata)
    expect(archive.kind).toBe("archive")
    if (archive.kind === "archive") {
      expect(archive.contents.fontCount).toBe(1)
      expect(archive.contents.entries[0]!.font?.familyName).toBe("Blimp Display")
    }
  })

  it("looks inside a ready package nobody looked inside, writing only its metadata", async () => {
    state.asset = row({
      asset_type: "archive",
      filename: "blimp.zip",
      mime_type: "application/zip",
      metadata: {},
    })
    state.bytes = zip()

    await finalizeAsset(payload)

    expect(state.downloads).toBe(1)
    expect(Object.keys(state.updates[0]!)).toEqual(["metadata"])
    expect(readArchive(state.updates[0]!.metadata).kind).toBe("archive")
  })

  it("leaves a package that was already looked inside alone", async () => {
    state.asset = row({
      asset_type: "archive",
      filename: "blimp.zip",
      mime_type: "application/zip",
      metadata: { archiveProblem: "malformed" },
    })
    await finalizeAsset(payload)
    expect(state.downloads).toBe(0)
  })
})

describe("finalize_asset on a row that is already ready", () => {
  it("reads a font that has no reading, and writes only its metadata", async () => {
    state.asset = row({ metadata: {} })

    await finalizeAsset(payload)

    expect(state.downloads).toBe(1)
    expect(state.updates).toHaveLength(1)
    expect(Object.keys(state.updates[0]!)).toEqual(["metadata"])
    const reading = readFontAsset(state.updates[0]!.metadata)
    expect(reading.kind).toBe("font")
    if (reading.kind === "font") {
      expect(reading.font.familyName).toBe("Blimp Display")
      expect(reading.font.styleName).toBe("Inline")
    }
  })

  it("keeps whatever else the metadata held", async () => {
    state.asset = row({ metadata: { altText: "kept" } })

    await finalizeAsset(payload)

    expect(state.updates[0]!.metadata).toMatchObject({ altText: "kept" })
  })

  it("does not touch a font that was read", async () => {
    state.asset = row({
      metadata: {
        font: {
          format: "ttf",
          isVariable: false,
          axes: [],
          scripts: [],
          languages: [],
          blocks: [],
          features: [],
        },
      },
    })

    await finalizeAsset(payload)

    expect(state.downloads).toBe(0)
    expect(state.updates).toEqual([])
  })

  it("does not touch a font the parser refused", async () => {
    state.asset = row({ metadata: { fontProblem: "malformed" } })

    await finalizeAsset(payload)

    expect(state.downloads).toBe(0)
    expect(state.updates).toEqual([])
  })

  it("does not touch a file that is not a font", async () => {
    state.asset = row({ mime_type: "image/png", filename: "specimen.png", metadata: {} })

    await finalizeAsset(payload)

    expect(state.downloads).toBe(0)
    expect(state.updates).toEqual([])
  })

  it("does not revisit a failed row", async () => {
    state.asset = row({ asset_state: "failed", metadata: {} })

    await finalizeAsset(payload)

    expect(state.downloads).toBe(0)
    expect(state.updates).toEqual([])
  })

  it("still settles a pending upload in one update, reading included", async () => {
    state.asset = row({ asset_state: "pending", mime_type: null, checksum: null, byte_size: null })

    await finalizeAsset(payload)

    expect(state.updates).toHaveLength(1)
    expect(state.updates[0]).toMatchObject({ asset_state: "ready", mime_type: "font/ttf" })
    expect(readFontAsset(state.updates[0]!.metadata).kind).toBe("font")
  })
})
