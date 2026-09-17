import { brotliDecompressSync, inflateRawSync, inflateSync } from "node:zlib"
import { describe, expect, it } from "vitest"
import { inspectArchive, type ArchiveDecompressors } from "@/lib/fonts/archive"
import { isJunkPath } from "@/lib/fonts/junk"
import { ZipReadError, cleanPath, listZipEntries, readZipEntry } from "@/lib/products/zip"
import { buildSfnt, buildWoff2 } from "./font-fixtures"
import { buildZip } from "./zip-fixtures"

/**
 * A ZIP package, looked inside.
 *
 * The reader is proven on archives built here, byte by byte, so the offsets
 * are the specification's and not another library's. The inspector is proven
 * on the same fonts the loose-file reader is proven on, inside a package.
 */

const decompress: ArchiveDecompressors = {
  inflate: (data) => inflateSync(data),
  brotli: (data) => brotliDecompressSync(data),
  inflateRaw: (data, maxOutputLength) => inflateRawSync(data, { maxOutputLength }),
}

const text = (value: string) => new TextEncoder().encode(value)
const PK_LOCAL = Buffer.from([0x50, 0x4b, 0x03, 0x04])

describe("listing a zip", () => {
  it("lists every entry with its sizes, method and cleaned path", () => {
    const zip = buildZip([
      { path: "Blimp/OTF/Blimp-Regular.otf", data: text("otf bytes") },
      { path: "Blimp\\README.txt", data: text("read me"), method: "store" },
      { path: "Blimp/", data: new Uint8Array() },
    ])
    const listing = listZipEntries(zip)
    expect(listing.ok).toBe(true)
    if (!listing.ok) return
    expect(listing.entries.map((entry) => entry.path)).toEqual([
      "Blimp/OTF/Blimp-Regular.otf",
      "Blimp/README.txt",
      "Blimp",
    ])
    expect(listing.entries[0]).toMatchObject({
      uncompressedSize: 9,
      method: 8,
      encrypted: false,
      isDirectory: false,
    })
    expect(listing.entries[1]!.method).toBe(0)
    expect(listing.entries[2]!.isDirectory).toBe(true)
    expect(listing.truncated).toBe(false)
  })

  it("finds the end record behind an archive comment", () => {
    const zip = buildZip([{ path: "a.txt", data: text("a") }], { comment: "made by a foundry" })
    expect(listZipEntries(zip).ok).toBe(true)
  })

  it("stops listing at the cap and says so", () => {
    const zip = buildZip(
      Array.from({ length: 6 }, (_, i) => ({ path: `f${i}.txt`, data: text("x") })),
    )
    const listing = listZipEntries(zip, { maxEntries: 4 })
    expect(listing.ok && listing.entries).toHaveLength(4)
    expect(listing.ok && listing.truncated).toBe(true)
  })

  it("refuses ZIP64 as unsupported rather than half-reading it", () => {
    const zip = buildZip([{ path: "a.txt", data: text("a") }], { zip64: true })
    expect(listZipEntries(zip)).toEqual({ ok: false, problem: "unsupported" })
  })

  it("calls bytes that are not a zip malformed, and a broken entry unreadable", () => {
    expect(listZipEntries(Buffer.from("PK is not enough"))).toEqual({
      ok: false,
      problem: "malformed",
    })
    expect(listZipEntries(Buffer.alloc(0))).toEqual({ ok: false, problem: "malformed" })
    const zip = buildZip([{ path: "a.txt", data: text("a") }])
    zip.writeUInt32LE(0xdeadbeef, 0) // break the first local header signature only
    const listing = listZipEntries(zip)
    expect(listing.ok).toBe(true)
    if (!listing.ok) return
    expect(() => readZipEntry(zip, listing.entries[0]!, decompress.inflateRaw, 1024)).toThrow(
      ZipReadError,
    )
  })

  it("keeps a climbing path as text and never resolves it", () => {
    expect(cleanPath("../../etc/passwd")).toBe("../../etc/passwd")
    expect(cleanPath("./a/./b//c/")).toBe("a/b/c")
  })
})

describe("reading an entry", () => {
  it("inflates a deflated entry and copies a stored one", () => {
    const zip = buildZip([
      { path: "d.txt", data: text("deflated content") },
      { path: "s.txt", data: text("stored content"), method: "store" },
    ])
    const listing = listZipEntries(zip)
    if (!listing.ok) throw new Error("listing failed")
    expect(readZipEntry(zip, listing.entries[0]!, decompress.inflateRaw, 1024).toString()).toBe(
      "deflated content",
    )
    expect(readZipEntry(zip, listing.entries[1]!, decompress.inflateRaw, 1024).toString()).toBe(
      "stored content",
    )
  })

  it("refuses an encrypted entry and one past the byte ceiling", () => {
    const zip = buildZip([
      { path: "secret.otf", data: text("x"), encrypted: true },
      { path: "big.otf", data: new Uint8Array(4096) },
    ])
    const listing = listZipEntries(zip)
    if (!listing.ok) throw new Error("listing failed")
    expect(() => readZipEntry(zip, listing.entries[0]!, decompress.inflateRaw, 1024)).toThrow(
      expect.objectContaining({ problem: "encrypted" }),
    )
    expect(() => readZipEntry(zip, listing.entries[1]!, decompress.inflateRaw, 1024)).toThrow(
      expect.objectContaining({ problem: "too_large" }),
    )
  })
})

describe("junk", () => {
  it("names the operating system's leftovers and nothing else", () => {
    expect(isJunkPath("Blimp/.DS_Store")).toBe(true)
    expect(isJunkPath("__MACOSX/Blimp/._Blimp-Regular.otf")).toBe(true)
    expect(isJunkPath("Blimp/._Blimp-Regular.otf")).toBe(true)
    expect(isJunkPath("Blimp/Thumbs.db")).toBe(true)
    expect(isJunkPath("Blimp/Blimp-Regular.otf")).toBe(false)
    expect(isJunkPath("Blimp/README.txt")).toBe(false)
  })
})

describe("looking inside a font package", () => {
  const regular = buildSfnt({ family: "Blimp Display", style: "Regular", weight: 400 })
  const bold = buildWoff2({ family: "Blimp Display", style: "Bold", weight: 700 })

  it("reads every font inside and lists what else is there", () => {
    const zip = buildZip([
      { path: "Blimp Display/", data: new Uint8Array() },
      { path: "Blimp Display/OTF/BlimpDisplay-Regular.otf", data: regular },
      { path: "Blimp Display/Web/BlimpDisplay-Bold.woff2", data: bold },
      { path: "Blimp Display/License.pdf", data: text("%PDF-1.4 license") },
      { path: "Blimp Display/specimen.png", data: text("png") },
      { path: "Blimp Display/.DS_Store", data: text("junk") },
      { path: "__MACOSX/Blimp Display/._BlimpDisplay-Regular.otf", data: text("fork") },
    ])
    const inspection = inspectArchive(zip, decompress)
    expect(inspection.ok).toBe(true)
    if (!inspection.ok) return
    const { contents } = inspection
    expect(contents.entryCount).toBe(6)
    expect(contents.ignoredCount).toBe(2)
    expect(contents.fontCount).toBe(2)
    expect(contents.truncated).toBe(false)
    expect(contents.entries.map((entry) => [entry.path, entry.kind])).toEqual([
      ["Blimp Display/OTF/BlimpDisplay-Regular.otf", "font"],
      ["Blimp Display/Web/BlimpDisplay-Bold.woff2", "font"],
      ["Blimp Display/License.pdf", "document"],
      ["Blimp Display/specimen.png", "image"],
    ])
    expect(contents.entries[0]!.font).toMatchObject({
      format: "ttf",
      familyName: "Blimp Display",
      styleName: "Regular",
      weight: 400,
    })
    expect(contents.entries[1]!.font).toMatchObject({ format: "woff2", styleName: "Bold" })
  })

  it("names the fonts it could not read, and why, without failing the package", () => {
    const zip = buildZip([
      { path: "fake.otf", data: text("not a font at all"), method: "store" },
      { path: "locked.ttf", data: regular, encrypted: true },
      { path: "family.ttc", data: Buffer.concat([Buffer.from("ttcf"), Buffer.alloc(64)]) },
      { path: "good.otf", data: regular },
    ])
    const inspection = inspectArchive(zip, decompress)
    if (!inspection.ok) throw new Error("inspection failed")
    expect(inspection.contents.entries.map((entry) => entry.problem ?? "read")).toEqual([
      "unrecognised",
      "encrypted",
      "collection",
      "read",
    ])
    expect(inspection.contents.fontCount).toBe(4)
  })

  it("reports a package it cannot open, so the row can say why", () => {
    const notReally = Buffer.concat([PK_LOCAL, Buffer.from(" but not really")])
    expect(inspectArchive(notReally, decompress)).toEqual({ ok: false, problem: "malformed" })
  })
})
