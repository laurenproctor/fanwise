import { brotliDecompressSync, inflateRawSync, inflateSync } from "node:zlib"
import { describe, expect, it } from "vitest"
import { readArchiveFont, type ArchiveDecompressors } from "@/lib/fonts/archive"
import { isReadPackagedFont } from "@/lib/fonts/detected"
import { inspectFont } from "@/lib/fonts/inspect"
import { routes } from "@/lib/routes"
import { buildSfnt, buildWoff2 } from "./font-fixtures"
import { buildZip } from "./zip-fixtures"

/**
 * One font read out of a package for the live preview.
 *
 * The route serves a packaged font only when the package's stored contents
 * already list that entry as a font the job read, and the bytes it hands back
 * are sniffed again on the way out. Both halves are pure and proven here on
 * archives built in memory.
 */

const decompress: ArchiveDecompressors = {
  inflate: (data) => inflateSync(data),
  brotli: (data) => brotliDecompressSync(data),
  inflateRaw: (data, maxOutputLength) => inflateRawSync(data, { maxOutputLength }),
}

const text = (value: string) => new TextEncoder().encode(value)
const spec = { family: "Blimp Display", style: "Regular", glyphCount: 12 }

describe("reading one font out of a package", () => {
  const otf = buildSfnt(spec)
  const woff2 = buildWoff2(spec)
  const zip = buildZip([
    { path: "Blimp/OTF/Blimp-Regular.otf", data: otf },
    { path: "Blimp/Web/Blimp-Regular.woff2", data: woff2, method: "store" },
    { path: "Blimp/License.pdf", data: text("%PDF-1.4 terms") },
    { path: "Blimp/notes.otf", data: text("not really a font") },
    { path: "Blimp/Web/", data: new Uint8Array(0) },
  ])

  it("hands back the entry's bytes with the sniffed font type", () => {
    const read = readArchiveFont(zip, "Blimp/OTF/Blimp-Regular.otf", decompress)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.mimeType).toBe("font/ttf")
    expect(Buffer.from(otf).equals(read.bytes)).toBe(true)
    // The same inspector the job ran reads the served bytes identically.
    expect(inspectFont(read.bytes, decompress)).toEqual(inspectFont(otf, decompress))

    const stored = readArchiveFont(zip, "Blimp/Web/Blimp-Regular.woff2", decompress)
    expect(stored).toMatchObject({ ok: true, mimeType: "font/woff2" })
  })

  it("serves nothing out of a package that is not a font", () => {
    expect(readArchiveFont(zip, "Blimp/License.pdf", decompress)).toEqual({
      ok: false,
      problem: "not_a_font",
    })
    // Named like a font, sniffed as something else: refused on the bytes.
    expect(readArchiveFont(zip, "Blimp/notes.otf", decompress)).toEqual({
      ok: false,
      problem: "not_a_font",
    })
    expect(readArchiveFont(zip, "Blimp/Web/", decompress)).toEqual({
      ok: false,
      problem: "not_found",
    })
    expect(readArchiveFont(zip, "Blimp/OTF/Missing.otf", decompress)).toEqual({
      ok: false,
      problem: "not_found",
    })
  })

  it("refuses a package it cannot open", () => {
    expect(readArchiveFont(zip.subarray(0, 30), "Blimp/OTF/Blimp-Regular.otf", decompress)).toEqual(
      { ok: false, problem: "unreadable" },
    )
  })
})

describe("what the route will serve", () => {
  const contents = {
    archive: {
      entries: [
        {
          path: "OTF/Blimp-Regular.otf",
          byteSize: 10,
          kind: "font",
          font: readFont(buildSfnt(spec)),
        },
        { path: "OTF/odd.otf", byteSize: 10, kind: "font", problem: "malformed" },
        { path: "License.pdf", byteSize: 10, kind: "document" },
      ],
      entryCount: 3,
      fontCount: 2,
      ignoredCount: 0,
      truncated: false,
    },
  }

  it("is exactly the fonts the job read inside the package", () => {
    expect(isReadPackagedFont(contents, "OTF/Blimp-Regular.otf")).toBe(true)
    expect(isReadPackagedFont(contents, "OTF/odd.otf")).toBe(false)
    expect(isReadPackagedFont(contents, "License.pdf")).toBe(false)
    expect(isReadPackagedFont(contents, "OTF/Missing.otf")).toBe(false)
    expect(isReadPackagedFont({ archiveProblem: "malformed" }, "OTF/Blimp-Regular.otf")).toBe(false)
    expect(isReadPackagedFont({}, "OTF/Blimp-Regular.otf")).toBe(false)
  })

  it("is named by the path the contents list shows, escaped into the query", () => {
    expect(routes.assetPreview("ws", "asset-1")).toBe("/ws/assets/asset-1/preview")
    expect(routes.assetPreview("ws", "asset-1", "OTF/Blimp Regular #2.otf")).toBe(
      "/ws/assets/asset-1/preview?entry=OTF%2FBlimp%20Regular%20%232.otf",
    )
  })
})

function readFont(bytes: Uint8Array) {
  const result = inspectFont(bytes, decompress)
  if (!result.ok) throw new Error(`expected a reading, got ${result.problem}`)
  return result.font
}
