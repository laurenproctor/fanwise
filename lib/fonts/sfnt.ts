/**
 * Reading the facts a font file states about itself.
 *
 * A short parser rather than a dependency, for the same reason `sniff.ts` is a
 * table: the questions are few and fixed. Which family and style is this, how
 * heavy and how wide, how many glyphs, which characters, which axes, which
 * OpenType features. Every one of those is a fixed-offset read from a handful
 * of tables, and a general font library would bring outline parsing, shaping
 * and hinting to answer them.
 *
 * Four containers are understood:
 *
 *   OTF / TTF   the tables sit in the file as they are
 *   WOFF        each table is zlib-compressed on its own
 *   WOFF2       every table is in one brotli stream; `glyf`, `loca` and `hmtx`
 *               may be transformed, and none of the tables read here are
 *
 * Decompression is injected rather than imported, so this file stays pure and
 * runs in a unit test, a job and (if ever wanted) a browser alike. A collection
 * (`ttcf`) is refused with a reason rather than half-read: which of its faces
 * a buyer means is a question, not a detail.
 *
 * Every read is bounds-checked. The bytes came from a stranger's upload, so a
 * malformed file must produce `{ ok: false }` and never an exception that
 * takes the job with it.
 */

export type FontContainer = "otf" | "ttf" | "woff" | "woff2"

export interface Decompressors {
  /** zlib (RFC 1950), as WOFF uses. */
  inflate(data: Uint8Array): Uint8Array
  /** Brotli, as WOFF2 uses. */
  brotli(data: Uint8Array): Uint8Array
}

export type SfntProblem = "unrecognised" | "collection" | "malformed" | "missing_tables"

export interface SfntTables {
  container: FontContainer
  /** Raw table bytes keyed by four-character tag, trailing spaces kept. */
  tables: Map<string, Uint8Array>
}

export type SfntReadResult = { ok: true; value: SfntTables } | { ok: false; problem: SfntProblem }

class Reader {
  constructor(
    readonly bytes: Uint8Array,
    private readonly view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
  ) {}

  get length(): number {
    return this.bytes.byteLength
  }

  fits(offset: number, size: number): boolean {
    return offset >= 0 && size >= 0 && offset + size <= this.bytes.byteLength
  }

  u8(offset: number): number {
    if (!this.fits(offset, 1)) throw new RangeError("read past end")
    return this.view.getUint8(offset)
  }
  u16(offset: number): number {
    if (!this.fits(offset, 2)) throw new RangeError("read past end")
    return this.view.getUint16(offset)
  }
  i16(offset: number): number {
    if (!this.fits(offset, 2)) throw new RangeError("read past end")
    return this.view.getInt16(offset)
  }
  u32(offset: number): number {
    if (!this.fits(offset, 4)) throw new RangeError("read past end")
    return this.view.getUint32(offset)
  }
  /** 16.16 fixed point. */
  fixed(offset: number): number {
    if (!this.fits(offset, 4)) throw new RangeError("read past end")
    return this.view.getInt32(offset) / 65536
  }
  tag(offset: number): string {
    if (!this.fits(offset, 4)) throw new RangeError("read past end")
    return String.fromCharCode(
      this.bytes[offset]!,
      this.bytes[offset + 1]!,
      this.bytes[offset + 2]!,
      this.bytes[offset + 3]!,
    )
  }
  slice(offset: number, size: number): Uint8Array {
    if (!this.fits(offset, size)) throw new RangeError("read past end")
    return this.bytes.subarray(offset, offset + size)
  }
}

export function readerFor(bytes: Uint8Array): Reader {
  return new Reader(bytes)
}

export type { Reader }

const SFNT_TRUETYPE = 0x00010000
const TAG_OTTO = 0x4f54544f
const TAG_TRUE = 0x74727565
const TAG_TTCF = 0x74746366
const TAG_WOFF = 0x774f4646
const TAG_WOFF2 = 0x774f4632

/** A table count no real font approaches, so a garbage header fails fast. */
const MAX_TABLES = 512

/** Refuse to inflate a table beyond this. A real `name` or `cmap` is far smaller. */
const MAX_TABLE_BYTES = 64 * 1024 * 1024

function containerForFlavor(flavor: number): FontContainer {
  return flavor === TAG_OTTO ? "otf" : "ttf"
}

function readSfnt(reader: Reader): SfntTables {
  const flavor = reader.u32(0)
  const numTables = reader.u16(4)
  if (numTables === 0 || numTables > MAX_TABLES) throw new RangeError("table count")

  const tables = new Map<string, Uint8Array>()
  for (let i = 0; i < numTables; i += 1) {
    const record = 12 + i * 16
    const tag = reader.tag(record)
    const offset = reader.u32(record + 8)
    const length = reader.u32(record + 12)
    tables.set(tag, reader.slice(offset, length))
  }
  return { container: containerForFlavor(flavor), tables }
}

function readWoff(reader: Reader, decompress: Decompressors): SfntTables {
  const flavor = reader.u32(4)
  if (flavor === TAG_TTCF) throw new CollectionError()
  const numTables = reader.u16(12)
  if (numTables === 0 || numTables > MAX_TABLES) throw new RangeError("table count")

  const tables = new Map<string, Uint8Array>()
  for (let i = 0; i < numTables; i += 1) {
    const entry = 44 + i * 20
    const tag = reader.tag(entry)
    const offset = reader.u32(entry + 4)
    const compLength = reader.u32(entry + 8)
    const origLength = reader.u32(entry + 12)
    if (origLength > MAX_TABLE_BYTES) throw new RangeError("table too large")
    const stored = reader.slice(offset, compLength)
    const data = compLength < origLength ? decompress.inflate(stored) : stored
    if (data.byteLength !== origLength) throw new RangeError("table length")
    tables.set(tag, data)
  }
  // WOFF carries the flavor of the font inside it, so an OTF-in-WOFF is still a
  // CFF font. The container reported is the wrapper, which is what a buyer
  // receives and what a format list should say.
  return { container: "woff", tables }
}

/** The 63 tags WOFF2 can name by index. Order is the specification's. */
const WOFF2_KNOWN_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm",
  "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern",
  "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC",
  "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar",
  "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty",
  "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat",
  "Gloc", "Feat", "Sill",
] // prettier-ignore

function readBase128(reader: Reader, offset: number): { value: number; next: number } {
  let value = 0
  for (let i = 0; i < 5; i += 1) {
    const byte = reader.u8(offset + i)
    // A leading zero byte is forbidden: it would let one number have many encodings.
    if (i === 0 && byte === 0x80) throw new RangeError("base128 leading zero")
    if (value & 0xfe000000) throw new RangeError("base128 overflow")
    value = (value << 7) | (byte & 0x7f)
    if ((byte & 0x80) === 0) return { value: value >>> 0, next: offset + i + 1 }
  }
  throw new RangeError("base128 too long")
}

function readWoff2(reader: Reader, decompress: Decompressors): SfntTables {
  const flavor = reader.u32(4)
  if (flavor === TAG_TTCF) throw new CollectionError()
  const numTables = reader.u16(12)
  if (numTables === 0 || numTables > MAX_TABLES) throw new RangeError("table count")
  const totalCompressedSize = reader.u32(20)

  let cursor = 48
  const entries: Array<{ tag: string; length: number }> = []
  for (let i = 0; i < numTables; i += 1) {
    const flags = reader.u8(cursor)
    cursor += 1
    const index = flags & 0x3f
    const transform = (flags >> 6) & 0x03
    let tag: string
    if (index === 63) {
      tag = reader.tag(cursor)
      cursor += 4
    } else {
      const known = WOFF2_KNOWN_TAGS[index]
      if (!known) throw new RangeError("table index")
      tag = known
    }
    const orig = readBase128(reader, cursor)
    cursor = orig.next
    // For glyf and loca, transform 0 is the transformed form; for every other
    // table, 0 is the identity. A transformed table carries a second length.
    const isGlyfOrLoca = tag === "glyf" || tag === "loca"
    const transformed = isGlyfOrLoca ? transform === 0 : transform !== 0
    let length = orig.value
    if (transformed) {
      const t = readBase128(reader, cursor)
      cursor = t.next
      length = t.value
    }
    entries.push({ tag, length })
  }

  const stream = decompress.brotli(reader.slice(cursor, totalCompressedSize))
  const tables = new Map<string, Uint8Array>()
  let offset = 0
  for (const entry of entries) {
    if (offset + entry.length > stream.byteLength) throw new RangeError("stream length")
    tables.set(entry.tag, stream.subarray(offset, offset + entry.length))
    offset += entry.length
  }
  return { container: "woff2", tables }
}

class CollectionError extends Error {}

/**
 * Finds the tables in a font file, whatever it is wrapped in.
 *
 * `missing_tables` is reported for a file that parses but lacks the three
 * tables every usable font has. That is what a renamed image or a truncated
 * upload tends to look like once its first four bytes happen to agree.
 */
export function readSfntTables(bytes: Uint8Array, decompress: Decompressors): SfntReadResult {
  const reader = new Reader(bytes)
  if (reader.length < 12) return { ok: false, problem: "unrecognised" }

  let result: SfntTables
  try {
    const signature = reader.u32(0)
    if (signature === SFNT_TRUETYPE || signature === TAG_OTTO || signature === TAG_TRUE) {
      result = readSfnt(reader)
    } else if (signature === TAG_WOFF) {
      result = readWoff(reader, decompress)
    } else if (signature === TAG_WOFF2) {
      result = readWoff2(reader, decompress)
    } else if (signature === TAG_TTCF) {
      return { ok: false, problem: "collection" }
    } else {
      return { ok: false, problem: "unrecognised" }
    }
  } catch (cause) {
    if (cause instanceof CollectionError) return { ok: false, problem: "collection" }
    return { ok: false, problem: "malformed" }
  }

  for (const required of ["name", "cmap", "maxp"]) {
    if (!result.tables.has(required)) return { ok: false, problem: "missing_tables" }
  }
  return { ok: true, value: result }
}
