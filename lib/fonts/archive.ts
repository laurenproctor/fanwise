import { formatFromFilename, type ArchiveContents, type ArchiveEntry } from "./detected"
import { inspectFont } from "./inspect"
import { isJunkPath } from "./junk"
import type { Decompressors } from "./sfnt"
import { sniffMimeType } from "@/lib/products/sniff"
import { ZipReadError, listZipEntries, readZipEntry, type ZipEntry } from "@/lib/products/zip"
import { isFontMimeType } from "./font-mime"

/**
 * Looks inside a ZIP package and reads every font it holds.
 *
 * The package is what buyers download, as uploaded. This never unpacks it
 * anywhere; it lists what is in it and runs each font through the inspector
 * every loose file goes through, so a creator who uploads one ZIP sees the
 * same family, styles and coverage they would from the files themselves, and
 * can check the package is what they meant to ship.
 *
 * Bounded three ways, because the bytes are a stranger's: at most so many
 * entries listed, at most so many fonts decompressed, and no single font past
 * the ceiling the loose-file readers already use. A package past a bound is
 * still delivered; only the reading is partial, and the contents say so.
 */

export const ARCHIVE_LIMITS = {
  /** Entries kept in the list. Beyond this the contents are marked truncated. */
  maxEntries: 500,
  /** Fonts actually decompressed and read. Beyond this an entry says not_read. */
  maxFontsRead: 100,
  /** One entry's bytes after decompression. */
  maxEntryBytes: 64 * 1024 * 1024,
  /** All entries' bytes after decompression, across the whole reading. */
  maxTotalBytes: 256 * 1024 * 1024,
} as const

const DOCUMENT_EXTENSIONS = new Set(["pdf", "txt", "md", "rtf", "html", "htm", "doc", "docx"])
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"])

export interface ArchiveDecompressors extends Decompressors {
  inflateRaw: (data: Buffer, maxOutputLength: number) => Buffer
}

export type ArchiveInspection =
  { ok: true; contents: ArchiveContents } | { ok: false; problem: "malformed" | "unsupported" }

export function inspectArchive(data: Buffer, decompress: ArchiveDecompressors): ArchiveInspection {
  const listing = listZipEntries(data, { maxEntries: ARCHIVE_LIMITS.maxEntries })
  if (!listing.ok) return { ok: false, problem: listing.problem }

  const files = listing.entries.filter((entry) => !entry.isDirectory && entry.path.length > 0)
  const kept = files.filter((entry) => !isJunkPath(entry.path))
  const ignoredCount = files.length - kept.length

  let fontsRead = 0
  let totalBytes = 0
  const entries: ArchiveEntry[] = kept.map((entry) => {
    const kind = kindOf(entry.path)
    const base: ArchiveEntry = { path: entry.path, byteSize: entry.uncompressedSize, kind }
    if (kind !== "font") return base

    if (fontsRead >= ARCHIVE_LIMITS.maxFontsRead) return { ...base, problem: "not_read" }
    if (totalBytes + entry.uncompressedSize > ARCHIVE_LIMITS.maxTotalBytes) {
      return { ...base, problem: "too_large" }
    }
    fontsRead += 1
    totalBytes += entry.uncompressedSize
    return { ...base, ...readFontEntry(data, entry, decompress) }
  })

  return {
    ok: true,
    contents: {
      entries,
      entryCount: files.length,
      fontCount: entries.filter((entry) => entry.kind === "font").length,
      ignoredCount,
      truncated: listing.truncated,
    },
  }
}

function readFontEntry(
  data: Buffer,
  entry: ZipEntry,
  decompress: ArchiveDecompressors,
): Pick<ArchiveEntry, "font" | "problem"> {
  let bytes: Buffer
  try {
    bytes = readZipEntry(data, entry, decompress.inflateRaw, ARCHIVE_LIMITS.maxEntryBytes)
  } catch (error) {
    return { problem: error instanceof ZipReadError ? error.problem : "malformed" }
  }
  // Sniffed, like a loose upload: a .otf that is really something else is
  // said to be, and a collection is named rather than read as a font.
  if (!isFontMimeType(sniffMimeType(bytes))) {
    const head = bytes.subarray(0, 4).toString("latin1")
    return { problem: head === "ttcf" ? "collection" : "unrecognised" }
  }
  const inspection = inspectFont(bytes, decompress)
  return inspection.ok ? { font: inspection.font } : { problem: inspection.problem }
}

function kindOf(path: string): ArchiveEntry["kind"] {
  const name = path.split("/").pop() ?? path
  if (formatFromFilename(name)) return "font"
  const extension = name.toLowerCase().split(".").pop() ?? ""
  if (extension === "ttc" || extension === "otc") return "font"
  if (DOCUMENT_EXTENSIONS.has(extension)) return "document"
  if (IMAGE_EXTENSIONS.has(extension)) return "image"
  return "other"
}
