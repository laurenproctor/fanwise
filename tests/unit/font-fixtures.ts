import { brotliCompressSync, deflateSync } from "node:zlib"

/**
 * Tiny, valid-enough font files built in memory.
 *
 * Only the tables the inspector reads are written, with the fields it reads
 * set and everything else zero. That is enough to pin the parser to the
 * specification's offsets without committing a binary font to the repository,
 * and it lets one test describe "Blimp Display Inline, weight 400, 624 glyphs,
 * Latin + Cyrillic + Kana" in a line instead of shipping a file that claims it.
 */

export interface FontSpec {
  family: string
  style: string
  postscriptName?: string
  version?: string
  designer?: string
  weight?: number
  width?: number
  italic?: boolean
  fsType?: number
  glyphCount?: number
  /** Inclusive code point ranges, each mapped to consecutive glyphs. */
  ranges?: Array<[number, number]>
  cmapFormat?: 4 | 12
  axes?: Array<{ tag: string; min: number; default: number; max: number }>
  features?: string[]
  cff?: boolean
}

class Writer {
  private bytes: number[] = []
  u8(v: number) {
    this.bytes.push(v & 0xff)
    return this
  }
  u16(v: number) {
    return this.u8(v >> 8).u8(v)
  }
  i16(v: number) {
    return this.u16(v < 0 ? v + 0x10000 : v)
  }
  u32(v: number) {
    return this.u16(Math.floor(v / 0x10000)).u16(v & 0xffff)
  }
  fixed(v: number) {
    const raw = Math.round(v * 65536)
    return this.u32(raw < 0 ? raw + 0x100000000 : raw)
  }
  tag(t: string) {
    for (let i = 0; i < 4; i += 1) this.u8(t.padEnd(4, " ").charCodeAt(i))
    return this
  }
  raw(data: Uint8Array | number[]) {
    for (const b of data) this.u8(b)
    return this
  }
  zeros(n: number) {
    for (let i = 0; i < n; i += 1) this.u8(0)
    return this
  }
  get length() {
    return this.bytes.length
  }
  done(): Uint8Array {
    return Uint8Array.from(this.bytes)
  }
}

function utf16(text: string): number[] {
  const out: number[] = []
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    out.push(code >> 8, code & 0xff)
  }
  return out
}

function nameTable(names: Array<[number, string]>): Uint8Array {
  const w = new Writer()
  const strings = names.map(([, value]) => utf16(value))
  w.u16(0)
    .u16(names.length)
    .u16(6 + names.length * 12)
  let offset = 0
  names.forEach(([id], i) => {
    w.u16(3).u16(1).u16(0x409).u16(id).u16(strings[i]!.length).u16(offset)
    offset += strings[i]!.length
  })
  for (const s of strings) w.raw(s)
  return w.done()
}

function os2Table(spec: FontSpec): Uint8Array {
  const w = new Writer()
  w.u16(4)
    .i16(500)
    .u16(spec.weight ?? 400)
    .u16(spec.width ?? 5)
    .u16(spec.fsType ?? 0)
  w.zeros(62 - w.length)
  w.u16(spec.italic ? 0x01 : 0x40)
  w.zeros(96 - w.length)
  return w.done()
}

function headTable(spec: FontSpec): Uint8Array {
  const w = new Writer()
  w.fixed(1).fixed(Number(spec.version ?? "1"))
  w.zeros(44 - w.length)
  w.u16(spec.italic ? 0x02 : 0)
  w.zeros(54 - w.length)
  return w.done()
}

function maxpTable(glyphs: number): Uint8Array {
  return new Writer().u32(0x00005000).u16(glyphs).done()
}

function cmapTable(ranges: Array<[number, number]>, format: 4 | 12): Uint8Array {
  const w = new Writer()
  if (format === 12) {
    w.u16(0).u16(1).u16(3).u16(10).u32(12)
    w.u16(12)
      .u16(0)
      .u32(16 + ranges.length * 12)
      .u32(0)
      .u32(ranges.length)
    let glyph = 1
    for (const [start, end] of ranges) {
      w.u32(start).u32(end).u32(glyph)
      glyph += end - start + 1
    }
    return w.done()
  }
  const segments = [...ranges, [0xffff, 0xffff] as [number, number]]
  const n = segments.length
  w.u16(0).u16(1).u16(3).u16(1).u32(12)
  w.u16(4)
    .u16(16 + n * 8)
    .u16(0)
    .u16(n * 2)
    .u16(0)
    .u16(0)
    .u16(0)
  for (const [, end] of segments) w.u16(end)
  w.u16(0)
  for (const [start] of segments) w.u16(start)
  let glyph = 1
  for (const [start, end] of segments) {
    if (start === 0xffff) {
      w.i16(1)
      continue
    }
    const delta = (glyph - start) & 0xffff
    w.u16(delta)
    glyph += end - start + 1
  }
  for (let i = 0; i < n; i += 1) w.u16(0)
  return w.done()
}

function fvarTable(axes: NonNullable<FontSpec["axes"]>): Uint8Array {
  const w = new Writer()
  w.u16(1)
    .u16(0)
    .u16(16)
    .u16(2)
    .u16(axes.length)
    .u16(20)
    .u16(3)
    .u16(4 + axes.length * 4)
  axes.forEach((axis, i) => {
    w.tag(axis.tag)
      .fixed(axis.min)
      .fixed(axis.default)
      .fixed(axis.max)
      .u16(0)
      .u16(256 + i)
  })
  return w.done()
}

function layoutTable(features: string[]): Uint8Array {
  const w = new Writer()
  w.u16(1).u16(0).u16(0).u16(10).u16(0)
  w.u16(features.length)
  for (const tag of features) w.tag(tag).u16(0)
  return w.done()
}

export function fontTables(spec: FontSpec): Array<[string, Uint8Array]> {
  const names: Array<[number, string]> = [
    [1, spec.family],
    [2, "Regular"],
    [4, `${spec.family} ${spec.style}`],
    [5, `Version ${spec.version ?? "1.000"};PS 1.0`],
    [6, spec.postscriptName ?? `${spec.family}-${spec.style}`.replace(/\s+/g, "")],
    [16, spec.family],
    [17, spec.style],
  ]
  if (spec.designer) names.push([9, spec.designer])
  spec.axes?.forEach((axis, i) => names.push([256 + i, axis.tag === "wght" ? "Weight" : axis.tag]))

  const tables: Array<[string, Uint8Array]> = [
    ["OS/2", os2Table(spec)],
    [
      "cmap",
      cmapTable(
        spec.ranges ?? [
          [0x41, 0x5a],
          [0x61, 0x7a],
        ],
        spec.cmapFormat ?? 4,
      ),
    ],
    ["head", headTable(spec)],
    ["maxp", maxpTable(spec.glyphCount ?? 100)],
    ["name", nameTable(names)],
  ]
  if (spec.axes?.length) tables.push(["fvar", fvarTable(spec.axes)])
  if (spec.features?.length) tables.push(["GSUB", layoutTable(spec.features)])
  tables.push([spec.cff ? "CFF " : "glyf", new Uint8Array(4)])
  return tables.sort((a, b) => (a[0] < b[0] ? -1 : 1))
}

export function buildSfnt(spec: FontSpec): Uint8Array {
  const tables = fontTables(spec)
  const w = new Writer()
  w.u32(spec.cff ? 0x4f54544f : 0x00010000)
    .u16(tables.length)
    .u16(0)
    .u16(0)
    .u16(0)
  let offset = 12 + tables.length * 16
  for (const [tag, data] of tables) {
    w.tag(tag).u32(0).u32(offset).u32(data.length)
    offset += data.length
  }
  for (const [, data] of tables) w.raw(data)
  return w.done()
}

export function buildWoff(spec: FontSpec): Uint8Array {
  const tables = fontTables(spec).map(([tag, data]) => {
    const compressed = deflateSync(data)
    return { tag, data, stored: compressed.length < data.length ? compressed : data }
  })
  const w = new Writer()
  const dirEnd = 44 + tables.length * 20
  const total = dirEnd + tables.reduce((sum, t) => sum + t.stored.length, 0)
  w.tag("wOFF").u32(0x00010000).u32(total).u16(tables.length).u16(0).u32(0).u16(1).u16(0)
  w.u32(0).u32(0).u32(0).u32(0).u32(0)
  let offset = dirEnd
  for (const t of tables) {
    w.tag(t.tag).u32(offset).u32(t.stored.length).u32(t.data.length).u32(0)
    offset += t.stored.length
  }
  for (const t of tables) w.raw(t.stored)
  return w.done()
}

const WOFF2_INDEX: Record<string, number> = {
  cmap: 0, head: 1, maxp: 4, name: 5, "OS/2": 6, glyf: 10, "CFF ": 13, GSUB: 28, fvar: 47,
} // prettier-ignore

function base128(value: number): number[] {
  const out = [value & 0x7f]
  let rest = value >>> 7
  while (rest > 0) {
    out.unshift((rest & 0x7f) | 0x80)
    rest >>>= 7
  }
  return out
}

export function buildWoff2(spec: FontSpec): Uint8Array {
  const tables = fontTables(spec)
  const dir = new Writer()
  for (const [tag, data] of tables) {
    // glyf with transform 3 is the null transform, so its length is the original.
    const transform = tag === "glyf" ? 3 : 0
    dir.u8((transform << 6) | WOFF2_INDEX[tag]!).raw(base128(data.length))
  }
  const stream = brotliCompressSync(Buffer.concat(tables.map(([, data]) => Buffer.from(data))))
  const w = new Writer()
  w.tag("wOF2").u32(0x00010000).u32(0).u16(tables.length).u16(0).u32(0).u32(stream.length)
  w.u16(1).u16(0).u32(0).u32(0).u32(0).u32(0).u32(0)
  w.raw(dir.done()).raw(stream)
  return w.done()
}
