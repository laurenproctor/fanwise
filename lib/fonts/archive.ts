import { formatFromFilename, type ArchiveContents, type ArchiveEntry } from "./detected"
import { inspectFont } from "./inspect"
import { isJunkPath } from "./junk"
import type { Decompressors } from "./sfnt"
import { sniffMimeType } from "@/lib/products/sniff"
import { ZipReadError, listZipEntries, readZipEntry, type ZipEntry } from "@/lib/products/zip"
import { isFontMimeType } from "./font-mime"
import { ARCHIVE_LIMITS, MAX_PREVIEWABLE_PACKAGE_BYTES } from "./archive-limits"

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

export { ARCHIVE_LIMITS, MAX_PREVIEWABLE_PACKAGE_BYTES }

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

/**
 * One font's bytes out of a package, for the live preview.
 *
 * The package is what buyers download and it stays in storage as uploaded;
 * this reads a single entry into memory and hands it back, the way the
 * inspector above does, so the workspace can set the storefront preview in a
 * face that was uploaded inside a ZIP. The entry is found by the cleaned path
 * the contents list shows, sniffed like a loose upload, and refused unless it
 * really is a font: nothing else is ever served out of a package.
 */
export type ArchiveFontRead =
  | { ok: true; bytes: Buffer; mimeType: string }
  | { ok: false; problem: "not_found" | "not_a_font" | "unreadable" }

export function readArchiveFont(
  data: Buffer,
  entryPath: string,
  decompress: ArchiveDecompressors,
): ArchiveFontRead {
  const listing = listZipEntries(data, { maxEntries: ARCHIVE_LIMITS.maxEntries })
  if (!listing.ok) return { ok: false, problem: "unreadable" }

  const entry = listing.entries.find((candidate) => candidate.path === entryPath)
  if (!entry || entry.isDirectory) return { ok: false, problem: "not_found" }
  if (kindOf(entry.path) !== "font") return { ok: false, problem: "not_a_font" }

  let bytes: Buffer
  try {
    bytes = readZipEntry(data, entry, decompress.inflateRaw, ARCHIVE_LIMITS.maxEntryBytes)
  } catch {
    return { ok: false, problem: "unreadable" }
  }

  const mimeType = sniffMimeType(bytes)
  if (!isFontMimeType(mimeType)) return { ok: false, problem: "not_a_font" }
  return { ok: true, bytes, mimeType }
}
