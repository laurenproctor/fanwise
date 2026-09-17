import { inflateRawSync } from "node:zlib"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { listZipEntries, readZipEntry } from "@/lib/products/zip"
import { writeZip } from "@/lib/products/zip-write"
import type { ProductAsset } from "@/lib/products/types"

/**
 * The package build, with storage and the database scripted. What is proved:
 * loose files land at their names, a creator's own zip is re-wrapped rather
 * than nested with its junk dropped, the README is written, the row is a
 * derivative of the first file with the spec hash as its key, and the build
 * is cached and workspace-scoped.
 */

interface Row extends Record<string, unknown> {
  id: string
  workspace_id: string
  product_id: string
  asset_state: string
  checksum: string | null
  storage_path: string
  filename: string
  mime_type: string | null
  byte_size: number | null
  derived_from: string | null
  spec_hash: string | null
  metadata: Record<string, unknown>
}

const state: {
  rows: Row[]
  objects: Map<string, Buffer>
  inserted: Record<string, unknown>[]
  uploads: string[]
} = { rows: [], objects: new Map(), inserted: [], uploads: [] }

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const filters: Array<[string, unknown]> = []
      let inList: [string, unknown[]] | null = null
      const matching = () =>
        state.rows.filter(
          (row) =>
            filters.every(([k, v]) => row[k] === v) &&
            (!inList || inList[1].includes(row[inList[0]])),
        )
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (k: string, v: unknown) => {
          filters.push([k, v])
          return builder
        },
        in: (k: string, values: unknown[]) => {
          inList = [k, values]
          return builder
        },
        maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ data: matching(), error: null }),
        insert: (row: Record<string, unknown>) => {
          state.inserted.push(row)
          state.rows.push(row as Row)
          return { select: () => ({ single: async () => ({ data: { id: row.id }, error: null }) }) }
        },
      }
      return builder
    },
  }),
}))

vi.mock("@/lib/products/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/products/storage")>()),
  downloadObject: async (path: string) => {
    const data = state.objects.get(path)
    if (!data) throw new Error(`no object at ${path}`)
    return data
  },
  uploadObject: async (path: string, data: Buffer) => {
    state.uploads.push(path)
    state.objects.set(path, data)
  },
  removeObjects: async () => {},
}))

const { buildPackage, packageSpecHash } = await import("@/lib/products/package")

const WS = "11111111-1111-4111-8111-111111111111"
const PRODUCT = "22222222-2222-4222-8222-222222222222"

function row(overrides: Partial<Row>): Row {
  return {
    id: overrides.id ?? "a",
    workspace_id: WS,
    product_id: PRODUCT,
    asset_type: "deliverable",
    asset_state: "ready",
    checksum: "sum",
    storage_path: `ws/p/${overrides.id ?? "a"}`,
    filename: "file.bin",
    mime_type: "application/octet-stream",
    byte_size: 10,
    derived_from: null,
    spec_hash: null,
    metadata: {},
    ...overrides,
  }
}

const inflate = (data: Buffer, max: number) => inflateRawSync(data, { maxOutputLength: max })

function entriesOf(zip: Buffer): string[] {
  const listing = listZipEntries(zip)
  if (!listing.ok) throw new Error("unreadable")
  return listing.entries.map((e) => e.path)
}

beforeEach(() => {
  state.rows = []
  state.objects = new Map()
  state.inserted = []
  state.uploads = []
})

describe("buildPackage", () => {
  it("zips loose files, re-wraps an archive without its junk, and adds the README", async () => {
    const inner = writeZip([
      { path: "Aster/Aster-Regular.otf", data: Buffer.from("otf bytes") },
      { path: "__MACOSX/._Aster-Regular.otf", data: Buffer.from("junk") },
      { path: "../escape.txt", data: Buffer.from("climb") },
    ])
    state.rows.push(
      row({ id: "font", filename: "Aster-Bold.otf", checksum: "c1" }),
      row({
        id: "pkg",
        filename: "aster.zip",
        mime_type: "application/zip",
        checksum: "c2",
        asset_type: "archive",
      }),
      row({ id: "lic", filename: "license.pdf", checksum: "c3", asset_type: "license" }),
    )
    state.objects.set("ws/p/font", Buffer.from("bold bytes"))
    state.objects.set("ws/p/pkg", inner)
    state.objects.set("ws/p/lic", Buffer.from("pdf bytes"))

    const spec = {
      key: "buyer-files-readme",
      filename: "aster-grotesk-creative-market.zip",
      entries: [
        { assetId: "font", checksum: "c1", path: "Aster-Bold.otf" },
        { assetId: "pkg", checksum: "c2", path: "aster.zip" },
        { assetId: "lic", checksum: "c3", path: "license.pdf" },
      ],
      readme: { path: "README.txt", text: "Aster Grotesk\n" },
    }
    const result = await buildPackage({ workspaceId: WS, productId: PRODUCT, spec })
    expect(result.cached).toBe(false)

    const zip = state.objects.get(state.uploads[0]!)!
    expect(entriesOf(zip)).toEqual([
      "Aster-Bold.otf",
      "aster/Aster/Aster-Regular.otf",
      "license.pdf",
      "README.txt",
    ])
    const listing = listZipEntries(zip)
    if (!listing.ok) throw new Error("unreadable")
    const copied = listing.entries.find((e) => e.path === "aster/Aster/Aster-Regular.otf")!
    expect(readZipEntry(zip, copied, inflate, 1 << 20).toString()).toBe("otf bytes")

    const inserted = state.inserted[0]!
    expect(inserted).toMatchObject({
      workspace_id: WS,
      product_id: PRODUCT,
      asset_type: "other",
      asset_state: "ready",
      filename: "aster-grotesk-creative-market.zip",
      mime_type: "application/zip",
      derived_from: "font",
      spec_hash: packageSpecHash(spec),
    })
    expect((inserted.metadata as { entries: string[] }).entries).toContain("README.txt")
    expect(state.uploads[0]).toContain(`${WS}/${PRODUCT}/`)
  })

  it("returns the existing row rather than building twice", async () => {
    const spec = {
      key: "k",
      filename: "p.zip",
      entries: [{ assetId: "font", checksum: "c1", path: "a.otf" }],
      readme: null,
    }
    state.rows.push(
      row({ id: "font", checksum: "c1" }),
      row({ id: "built", derived_from: "font", spec_hash: packageSpecHash(spec) }),
    )
    const result = await buildPackage({ workspaceId: WS, productId: PRODUCT, spec })
    expect(result).toEqual({ assetId: "built", cached: true })
    expect(state.uploads).toEqual([])
  })

  it("refuses an input from another workspace, a changed file, and a spec with nothing in it", async () => {
    state.rows.push(row({ id: "theirs", workspace_id: "other", checksum: "c1" }))
    await expect(
      buildPackage({
        workspaceId: WS,
        productId: PRODUCT,
        spec: {
          key: "k",
          filename: "p.zip",
          entries: [{ assetId: "theirs", checksum: "c1", path: "a" }],
          readme: null,
        },
      }),
    ).rejects.toThrow(/not this product/)

    state.rows.push(row({ id: "mine", checksum: "now" }))
    await expect(
      buildPackage({
        workspaceId: WS,
        productId: PRODUCT,
        spec: {
          key: "k",
          filename: "p.zip",
          entries: [{ assetId: "mine", checksum: "then", path: "a" }],
          readme: null,
        },
      }),
    ).rejects.toThrow(/changed/)

    await expect(
      buildPackage({
        workspaceId: WS,
        productId: PRODUCT,
        spec: { key: "k", filename: "p.zip", entries: [], readme: null },
      }),
    ).rejects.toThrow(/at least one file/)
  })

  it("hashes the order and the README, so a reordered or reworded package is a new one", () => {
    const a = {
      key: "k",
      filename: "p.zip",
      entries: [
        { assetId: "1", checksum: "x", path: "a" },
        { assetId: "2", checksum: "y", path: "b" },
      ],
      readme: { path: "R", text: "1" },
    }
    const b = { ...a, entries: [a.entries[1]!, a.entries[0]!] }
    const c = { ...a, readme: { path: "R", text: "2" } }
    expect(packageSpecHash(a)).not.toBe(packageSpecHash(b))
    expect(packageSpecHash(a)).not.toBe(packageSpecHash(c))
    expect(packageSpecHash(a)).toBe(packageSpecHash({ ...a }))
  })
})

// Keep the type import used, so the row shape is checked against the real one.
void (null as unknown as ProductAsset)
