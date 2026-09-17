import { inflateRawSync } from "node:zlib"
import { describe, expect, it } from "vitest"
import { listZipEntries, readZipEntry, readZipEntryRaw } from "@/lib/products/zip"
import { crc32, writeZip, ZipWriteError } from "@/lib/products/zip-write"

/**
 * The zip writer, proved against the zip reader that already exists: what
 * one writes the other lists and inflates back to the same bytes, and an
 * entry copied raw from one archive into another arrives intact.
 */

const inflate = (data: Buffer, max: number) => inflateRawSync(data, { maxOutputLength: max })

describe("writeZip", () => {
  it("round-trips entries through the reader, deflating what shrinks and storing what does not", () => {
    const text = Buffer.from("hello hello hello hello hello hello hello hello\n".repeat(20))
    const noise = Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 97 + 13) % 256))
    const zip = writeZip([
      { path: "README.txt", data: text },
      { path: "fonts/Aster-Regular.otf", data: noise },
    ])

    const listing = listZipEntries(zip)
    expect(listing.ok).toBe(true)
    if (!listing.ok) return
    expect(listing.entries.map((e) => e.path)).toEqual(["README.txt", "fonts/Aster-Regular.otf"])
    const [readme, font] = listing.entries
    expect(readme!.method).toBe(8)
    expect(readme!.uncompressedSize).toBe(text.length)
    expect(readme!.crc32).toBe(crc32(text))
    expect(readZipEntry(zip, readme!, inflate, 1 << 20).equals(text)).toBe(true)
    // Deflating the noise would not shrink it, so it is stored as it is.
    expect(font!.method).toBe(0)
    expect(readZipEntry(zip, font!, inflate, 1 << 20).equals(noise)).toBe(true)
  })

  it("is deterministic: the same entries produce the same bytes", () => {
    const entries = [{ path: "a.txt", data: Buffer.from("same words, same bytes") }]
    expect(writeZip(entries).equals(writeZip(entries))).toBe(true)
  })

  it("copies an entry from one archive into another without inflating it", () => {
    const data = Buffer.from("copied through, compressed as it was ".repeat(30))
    const first = writeZip([{ path: "inner/file.txt", data }])
    const listing = listZipEntries(first)
    if (!listing.ok) throw new Error("unreadable")
    const raw = readZipEntryRaw(first, listing.entries[0]!)
    expect(raw.method).toBe(8)

    const second = writeZip([
      { path: "README.txt", data: Buffer.from("readme") },
      { path: "package/inner/file.txt", raw },
    ])
    const again = listZipEntries(second)
    if (!again.ok) throw new Error("unreadable")
    const copied = again.entries.find((e) => e.path === "package/inner/file.txt")!
    expect(copied.crc32).toBe(crc32(data))
    expect(readZipEntry(second, copied, inflate, 1 << 20).equals(data)).toBe(true)
  })

  it("refuses a duplicate path and an empty name", () => {
    expect(() =>
      writeZip([
        { path: "a", data: Buffer.from("1") },
        { path: "a", data: Buffer.from("2") },
      ]),
    ).toThrow(ZipWriteError)
    expect(() => writeZip([{ path: "", data: Buffer.from("1") }])).toThrow(ZipWriteError)
  })

  it("computes the standard CRC-32", () => {
    // The check value every CRC-32 implementation is tested against.
    expect(crc32(Buffer.from("123456789")).toString(16)).toBe("cbf43926")
    expect(crc32(Buffer.alloc(0))).toBe(0)
  })
})
