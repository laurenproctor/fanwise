/**
 * A ZIP archive's table of contents, read from its central directory, and
 * one entry's bytes on request.
 *
 * Written here rather than taken from a package for the reason the sniffer is:
 * the format is small, what Fanwise needs from it is smaller still, and a
 * dependency that reads untrusted archives is a supply-chain surface (ADR
 * 0009) for two hundred lines of arithmetic. Decompression itself is Node's
 * `zlib`, the same as WOFF and WOFF2.
 *
 * Reads, never writes. Nothing here touches a filesystem: an entry's bytes
 * come back as a Buffer for the caller to inspect and discard. Paths are
 * cleaned for display only, and a path that climbs (`../`) is kept as text
 * and never resolved, because there is nothing to resolve it against.
 *
 * ZIP64 and multi-disk archives are refused as unsupported rather than
 * half-read. A font package is a few dozen files and a few megabytes; the
 * first archive that needs 64-bit offsets is a question, not a case.
 */

export interface ZipEntry {
  /** Forward slashes, no leading slash, no `./` segments. */
  path: string
  isDirectory: boolean
  compressedSize: number
  uncompressedSize: number
  /** 0 is stored, 8 is deflate. Anything else is refused on read. */
  method: number
  encrypted: boolean
  localHeaderOffset: number
  /** The stored CRC-32 of the uncompressed bytes, as the archive claims it. */
  crc32: number
}

export type ZipProblem = "malformed" | "unsupported"

export type ZipListing =
  { ok: true; entries: ZipEntry[]; truncated: boolean } | { ok: false; problem: ZipProblem }

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
const EOCD_MIN = 22
const MAX_COMMENT = 0xffff

/** Bytes a reader may hand back for one entry: the caller sets it lower. */
export const ZIP_ENTRY_CEILING = 128 * 1024 * 1024

export function listZipEntries(data: Buffer, options: { maxEntries?: number } = {}): ZipListing {
  const maxEntries = options.maxEntries ?? 1000
  try {
    const eocd = findEndOfCentralDirectory(data)
    if (eocd === null) return { ok: false, problem: "malformed" }

    const diskCount = data.readUInt16LE(eocd + 4)
    const entryCount = data.readUInt16LE(eocd + 10)
    const directorySize = data.readUInt32LE(eocd + 12)
    const directoryOffset = data.readUInt32LE(eocd + 16)

    if (diskCount > 1) return { ok: false, problem: "unsupported" }
    if (entryCount === 0xffff || directoryOffset === 0xffffffff || directorySize === 0xffffffff) {
      return { ok: false, problem: "unsupported" }
    }
    if (directoryOffset + directorySize > eocd) return { ok: false, problem: "malformed" }

    const entries: ZipEntry[] = []
    let cursor = directoryOffset
    for (let index = 0; index < entryCount; index += 1) {
      if (cursor + 46 > data.length) return { ok: false, problem: "malformed" }
      if (data.readUInt32LE(cursor) !== CENTRAL_SIGNATURE)
        return { ok: false, problem: "malformed" }

      const flags = data.readUInt16LE(cursor + 8)
      const method = data.readUInt16LE(cursor + 10)
      const crc32 = data.readUInt32LE(cursor + 16)
      const compressedSize = data.readUInt32LE(cursor + 20)
      const uncompressedSize = data.readUInt32LE(cursor + 24)
      const nameLength = data.readUInt16LE(cursor + 28)
      const extraLength = data.readUInt16LE(cursor + 30)
      const commentLength = data.readUInt16LE(cursor + 32)
      const localHeaderOffset = data.readUInt32LE(cursor + 42)

      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
        return { ok: false, problem: "unsupported" }
      }
      if (cursor + 46 + nameLength > data.length) return { ok: false, problem: "malformed" }

      const rawName = data.subarray(cursor + 46, cursor + 46 + nameLength)
      // Bit 11 says UTF-8. Anything else is nominally CP437; Latin-1 is the
      // nearest decoding Node has, and a name is only ever shown, never used.
      const name = rawName.toString(flags & 0x0800 ? "utf8" : "latin1")
      const path = cleanPath(name)

      if (entries.length < maxEntries) {
        entries.push({
          path,
          isDirectory: name.endsWith("/") || name.endsWith("\\"),
          compressedSize,
          uncompressedSize,
          method,
          encrypted: (flags & 0x0001) !== 0,
          localHeaderOffset,
          crc32,
        })
      }

      cursor += 46 + nameLength + extraLength + commentLength
    }

    return { ok: true, entries, truncated: entryCount > entries.length }
  } catch {
    return { ok: false, problem: "malformed" }
  }
}

/**
 * The end-of-central-directory record sits at the end, behind an optional
 * comment of up to 65535 bytes. Scanned backwards for its signature.
 */
function findEndOfCentralDirectory(data: Buffer): number | null {
  if (data.length < EOCD_MIN) return null
  const floor = Math.max(0, data.length - EOCD_MIN - MAX_COMMENT)
  for (let offset = data.length - EOCD_MIN; offset >= floor; offset -= 1) {
    if (data.readUInt32LE(offset) === EOCD_SIGNATURE) {
      const commentLength = data.readUInt16LE(offset + 20)
      if (offset + EOCD_MIN + commentLength <= data.length) return offset
    }
  }
  return null
}

export function cleanPath(name: string): string {
  return name
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".")
    .join("/")
}

export type ZipReadProblem = "encrypted" | "unsupported" | "too_large" | "malformed"

export class ZipReadError extends Error {
  constructor(readonly problem: ZipReadProblem) {
    super(`zip entry could not be read: ${problem}`)
    this.name = "ZipReadError"
  }
}

/**
 * One entry's bytes. `inflate` is injected like the font readers' decompressors
 * so the byte ceiling is the caller's, and a test can hand in a plain one.
 */
/**
 * One entry's bytes exactly as stored, still compressed, with what a writer
 * needs to carry them into another archive unchanged. No decompression, so no
 * byte ceiling: the entry is copied, never opened. Used by the package build
 * to re-wrap a creator's own zip without inflating and deflating every file.
 */
export function readZipEntryRaw(
  data: Buffer,
  entry: ZipEntry,
): { compressed: Buffer; method: number; crc32: number; uncompressedSize: number } {
  const header = entry.localHeaderOffset
  if (header + 30 > data.length || data.readUInt32LE(header) !== LOCAL_SIGNATURE) {
    throw new ZipReadError("malformed")
  }
  const nameLength = data.readUInt16LE(header + 26)
  const extraLength = data.readUInt16LE(header + 28)
  const start = header + 30 + nameLength + extraLength
  const end = start + entry.compressedSize
  if (end > data.length) throw new ZipReadError("malformed")
  return {
    compressed: data.subarray(start, end),
    method: entry.method,
    crc32: entry.crc32,
    uncompressedSize: entry.uncompressedSize,
  }
}

export function readZipEntry(
  data: Buffer,
  entry: ZipEntry,
  inflateRaw: (compressed: Buffer, maxOutputLength: number) => Buffer,
  maxBytes: number,
): Buffer {
  if (entry.encrypted) throw new ZipReadError("encrypted")
  if (entry.method !== 0 && entry.method !== 8) throw new ZipReadError("unsupported")
  if (entry.uncompressedSize > maxBytes) throw new ZipReadError("too_large")

  const header = entry.localHeaderOffset
  if (header + 30 > data.length || data.readUInt32LE(header) !== LOCAL_SIGNATURE) {
    throw new ZipReadError("malformed")
  }
  const nameLength = data.readUInt16LE(header + 26)
  const extraLength = data.readUInt16LE(header + 28)
  const start = header + 30 + nameLength + extraLength
  const end = start + entry.compressedSize
  if (end > data.length) throw new ZipReadError("malformed")

  const compressed = data.subarray(start, end)
  if (entry.method === 0) return Buffer.from(compressed)
  try {
    return inflateRaw(compressed, maxBytes)
  } catch (error) {
    // zlib says RangeError when maxOutputLength is exceeded; anything else is
    // a stream that does not inflate.
    throw new ZipReadError(error instanceof RangeError ? "too_large" : "malformed")
  }
}
