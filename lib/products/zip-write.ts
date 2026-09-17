import { deflateRawSync } from "node:zlib"

/**
 * A ZIP archive, written.
 *
 * The counterpart of `./zip.ts`, and written here for the same reason: the
 * format is small, what Fanwise needs is smaller, and a dependency that
 * builds archives from a stranger's bytes is a supply-chain surface (ADR
 * 0009) for a hundred lines of arithmetic. Compression is Node's `zlib`.
 *
 * Deterministic: the same entries in the same order produce the same bytes,
 * because every timestamp is fixed. A package is cached on its inputs, and a
 * rebuild that produced different bytes for the same inputs would be a cache
 * that lies.
 *
 * Two kinds of entry. A plain one carries bytes and is deflated here, or
 * stored when deflating would not help. A raw one carries bytes already
 * compressed by another archive, with the method, CRC and size that archive
 * recorded, and is copied through untouched: re-wrapping a creator's own zip
 * costs no decompression and cannot corrupt what they packed.
 *
 * ZIP64 is refused rather than written: no entry, and no archive, past four
 * gigabytes. The package build bounds its inputs well below that.
 */

export type ZipWriteEntry =
  | { path: string; data: Buffer }
  | {
      path: string
      raw: { compressed: Buffer; method: number; crc32: number; uncompressedSize: number }
    }

export class ZipWriteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ZipWriteError"
  }
}

const LOCAL_SIGNATURE = 0x04034b50
const CENTRAL_SIGNATURE = 0x02014b50
const EOCD_SIGNATURE = 0x06054b50
const VERSION = 20
/** Bit 11: names are UTF-8. */
const FLAGS = 0x0800
const STORED = 0
const DEFLATED = 8
const FOUR_GIB = 0xffffffff
/** 1 January 2026, 00:00, in DOS time and date. Every entry carries it. */
const DOS_TIME = 0
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

interface Prepared {
  name: Buffer
  method: number
  crc: number
  compressed: Buffer
  uncompressedSize: number
  localOffset: number
}

function prepare(entry: ZipWriteEntry): Omit<Prepared, "localOffset"> {
  const name = Buffer.from(entry.path, "utf8")
  if (name.length === 0 || name.length > 0xffff) {
    throw new ZipWriteError(`entry name is empty or too long: ${entry.path.slice(0, 80)}`)
  }
  if ("raw" in entry) {
    return {
      name,
      method: entry.raw.method,
      crc: entry.raw.crc32 >>> 0,
      compressed: entry.raw.compressed,
      uncompressedSize: entry.raw.uncompressedSize,
    }
  }
  const deflated = deflateRawSync(entry.data, { level: 6 })
  const useDeflate = deflated.length < entry.data.length
  return {
    name,
    method: useDeflate ? DEFLATED : STORED,
    crc: crc32(entry.data),
    compressed: useDeflate ? deflated : entry.data,
    uncompressedSize: entry.data.length,
  }
}

export function writeZip(entries: readonly ZipWriteEntry[]): Buffer {
  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.path)) throw new ZipWriteError(`duplicate entry: ${entry.path}`)
    seen.add(entry.path)
  }
  if (entries.length > 0xffff) throw new ZipWriteError("too many entries for a plain zip")

  const parts: Buffer[] = []
  const prepared: Prepared[] = []
  let offset = 0

  for (const entry of entries) {
    const p = prepare(entry)
    if (p.compressed.length > FOUR_GIB || p.uncompressedSize > FOUR_GIB) {
      throw new ZipWriteError(`entry too large for a plain zip: ${entry.path}`)
    }
    const header = Buffer.alloc(30)
    header.writeUInt32LE(LOCAL_SIGNATURE, 0)
    header.writeUInt16LE(VERSION, 4)
    header.writeUInt16LE(FLAGS, 6)
    header.writeUInt16LE(p.method, 8)
    header.writeUInt16LE(DOS_TIME, 10)
    header.writeUInt16LE(DOS_DATE, 12)
    header.writeUInt32LE(p.crc, 14)
    header.writeUInt32LE(p.compressed.length, 18)
    header.writeUInt32LE(p.uncompressedSize, 22)
    header.writeUInt16LE(p.name.length, 26)
    header.writeUInt16LE(0, 28)

    prepared.push({ ...p, localOffset: offset })
    parts.push(header, p.name, p.compressed)
    offset += header.length + p.name.length + p.compressed.length
    if (offset > FOUR_GIB) throw new ZipWriteError("archive too large for a plain zip")
  }

  const directoryOffset = offset
  for (const p of prepared) {
    const header = Buffer.alloc(46)
    header.writeUInt32LE(CENTRAL_SIGNATURE, 0)
    header.writeUInt16LE(VERSION, 4)
    header.writeUInt16LE(VERSION, 6)
    header.writeUInt16LE(FLAGS, 8)
    header.writeUInt16LE(p.method, 10)
    header.writeUInt16LE(DOS_TIME, 12)
    header.writeUInt16LE(DOS_DATE, 14)
    header.writeUInt32LE(p.crc, 16)
    header.writeUInt32LE(p.compressed.length, 20)
    header.writeUInt32LE(p.uncompressedSize, 24)
    header.writeUInt16LE(p.name.length, 28)
    header.writeUInt16LE(0, 30)
    header.writeUInt16LE(0, 32)
    header.writeUInt16LE(0, 34)
    header.writeUInt16LE(0, 36)
    header.writeUInt32LE(0, 38)
    header.writeUInt32LE(p.localOffset, 42)
    parts.push(header, p.name)
    offset += header.length + p.name.length
  }
  const directorySize = offset - directoryOffset

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(EOCD_SIGNATURE, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(prepared.length, 8)
  eocd.writeUInt16LE(prepared.length, 10)
  eocd.writeUInt32LE(directorySize, 12)
  eocd.writeUInt32LE(directoryOffset, 16)
  eocd.writeUInt16LE(0, 20)
  parts.push(eocd)

  if (offset + eocd.length > FOUR_GIB) throw new ZipWriteError("archive too large for a plain zip")
  return Buffer.concat(parts)
}
