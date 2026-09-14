import {
  detectBlocks,
  detectLanguages,
  detectScripts,
  mergeRanges,
  totalCodepoints,
} from "./coverage"
import type { DetectedFont, FontProblem } from "./detected"
import { readSfntTables, readerFor, type Decompressors, type Reader } from "./sfnt"

/**
 * From a font's tables to the facts Fanwise records about it.
 *
 * Each reader below is independent and forgiving: a damaged `GSUB` loses the
 * feature list, not the family name. Only the tables every font must have can
 * fail the whole reading, and `readSfntTables` has already checked for those.
 */

export type FontInspection = { ok: true; font: DetectedFont } | { ok: false; problem: FontProblem }

export function inspectFont(bytes: Uint8Array, decompress: Decompressors): FontInspection {
  const read = readSfntTables(bytes, decompress)
  if (!read.ok) return read

  const { container, tables } = read.value
  const table = (tag: string): Reader | null => {
    const data = tables.get(tag)
    return data ? readerFor(data) : null
  }

  const names = attempt(() => readNames(table("name")!), new Map<number, string>())
  const os2 = attempt(() => readOs2(table("OS/2")), null)
  const head = attempt(() => readHead(table("head")), null)
  const glyphCount = attempt(() => table("maxp")!.u16(4), undefined)
  const fvar = attempt(() => readFvar(table("fvar"), names), { axes: [], instanceCount: 0 })
  const ranges = attempt(() => readCmap(table("cmap")!), [] as Array<[number, number]>)
  const features = attempt(
    () =>
      [...new Set([...readFeatureTags(table("GSUB")), ...readFeatureTags(table("GPOS"))])].sort(),
    [] as string[],
  )

  const italic =
    os2?.fsSelection !== undefined
      ? Boolean(os2.fsSelection & 0x01) || Boolean(os2.fsSelection & 0x200)
      : head
        ? Boolean(head.macStyle & 0x02)
        : undefined

  const versionName = names.get(5)
  const font: DetectedFont = {
    format: container,
    outlines:
      tables.has("CFF ") || tables.has("CFF2")
        ? "cff"
        : tables.has("glyf")
          ? "truetype"
          : undefined,
    // Typographic family and subfamily (16, 17) win over the legacy four-style
    // names (1, 2), which squeeze "Blimp Display Inline" into a family called
    // "Blimp Display Inline" and a style called "Regular".
    familyName: names.get(16) ?? names.get(1),
    styleName: names.get(17) ?? names.get(2),
    fullName: names.get(4),
    postscriptName: names.get(6),
    version: versionName ? normalizeVersion(versionName) : head ? head.revision : undefined,
    designer: names.get(9),
    manufacturer: names.get(8),
    weight: os2 && os2.weight >= 1 && os2.weight <= 1000 ? os2.weight : undefined,
    width: os2 && os2.width >= 1 && os2.width <= 9 ? os2.width : undefined,
    italic,
    glyphCount,
    codepointCount: totalCodepoints(ranges),
    isVariable: fvar.axes.length > 0,
    axes: fvar.axes,
    instanceCount: fvar.axes.length > 0 ? fvar.instanceCount : undefined,
    scripts: detectScripts(ranges),
    languages: detectLanguages(ranges),
    blocks: detectBlocks(ranges),
    features,
    embedding: os2 ? embeddingFrom(os2.fsType) : undefined,
  }

  return { ok: true, font: stripUndefined(font) }
}

function attempt<T>(read: () => T, fallback: T): T {
  try {
    return read()
  } catch {
    return fallback
  }
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}

/** "Version 1.000;PS 001.000;hotconv 1.0.88" is a version of "1.000". */
export function normalizeVersion(raw: string): string {
  const match = /(\d+(?:\.\d+)+|\d+)/.exec(raw)
  return (match ? match[1]! : raw.trim()).slice(0, 40)
}

/* --------------------------------------------------------------------- name */

function decodeUtf16be(bytes: Uint8Array): string {
  let out = ""
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    out += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!)
  }
  return out
}

/** Drops C0 controls and DEL. These strings are rendered on a page. */
function stripControls(value: string): string {
  let out = ""
  for (const char of value) {
    const code = char.charCodeAt(0)
    if (code >= 0x20 && code !== 0x7f) out += char
  }
  return out
}

function isPrintableTag(tag: string): boolean {
  for (let i = 0; i < tag.length; i += 1) {
    const code = tag.charCodeAt(i)
    if (code < 0x20 || code > 0x7e) return false
  }
  return tag.length === 4
}

function decodeLatin1(bytes: Uint8Array): string {
  let out = ""
  for (const byte of bytes) out += String.fromCharCode(byte)
  return out
}

/**
 * One string per name id, preferring Windows US English, then any Windows
 * Unicode record, then Unicode platform, then Macintosh Roman. Control
 * characters are stripped and the result trimmed, because these strings are
 * rendered on a page.
 */
function readNames(name: Reader): Map<number, string> {
  const count = name.u16(2)
  const stringOffset = name.u16(4)
  const best = new Map<number, { rank: number; value: string }>()

  for (let i = 0; i < count; i += 1) {
    const record = 6 + i * 12
    const platform = name.u16(record)
    const encoding = name.u16(record + 2)
    const language = name.u16(record + 4)
    const nameId = name.u16(record + 6)
    const length = name.u16(record + 8)
    const offset = name.u16(record + 10)
    if (!name.fits(stringOffset + offset, length)) continue

    let rank: number
    let value: string
    const bytes = name.slice(stringOffset + offset, length)
    if (platform === 3 && (encoding === 1 || encoding === 10)) {
      rank = language === 0x409 ? 0 : 1
      value = decodeUtf16be(bytes)
    } else if (platform === 0) {
      rank = 2
      value = decodeUtf16be(bytes)
    } else if (platform === 1 && encoding === 0) {
      rank = language === 0 ? 3 : 4
      value = decodeLatin1(bytes)
    } else {
      continue
    }

    value = stripControls(value).trim()
    if (value.length === 0) continue

    const existing = best.get(nameId)
    if (!existing || rank < existing.rank) best.set(nameId, { rank, value: value.slice(0, 200) })
  }

  return new Map([...best].map(([id, entry]) => [id, entry.value]))
}

/* -------------------------------------------------------------- OS/2, head */

function readOs2(os2: Reader | null) {
  if (!os2) return null
  return {
    weight: os2.u16(4),
    width: os2.u16(6),
    fsType: os2.u16(8),
    fsSelection: os2.fits(62, 2) ? os2.u16(62) : undefined,
  }
}

function readHead(head: Reader | null) {
  if (!head) return null
  return {
    revision: head.fixed(4).toFixed(3),
    macStyle: head.u16(44),
  }
}

/**
 * OS/2 fsType, the file's own embedding permission.
 *
 * Bits 0-3 are a level, and a font may set more than one by mistake; the most
 * permissive set bit wins, as the specification says applications should read
 * it.
 */
function embeddingFrom(fsType: number): DetectedFont["embedding"] {
  const level = fsType & 0x000f
  if (level === 0) return "installable"
  if (level & 0x0008) return "editable"
  if (level & 0x0004) return "preview_print"
  return "restricted"
}

/* --------------------------------------------------------------------- fvar */

function readFvar(fvar: Reader | null, names: Map<number, string>) {
  if (!fvar) return { axes: [], instanceCount: 0 }
  const axesOffset = fvar.u16(4)
  const axisCount = fvar.u16(8)
  const axisSize = fvar.u16(10)
  const instanceCount = fvar.u16(12)
  if (axisSize < 20 || axisCount > 64) return { axes: [], instanceCount: 0 }

  const axes: DetectedFont["axes"] = []
  for (let i = 0; i < axisCount; i += 1) {
    const at = axesOffset + i * axisSize
    const tag = fvar.tag(at).trim()
    const nameId = fvar.u16(at + 18)
    axes.push({
      tag,
      name: names.get(nameId) ?? AXIS_NAMES[tag],
      min: round(fvar.fixed(at + 4)),
      default: round(fvar.fixed(at + 8)),
      max: round(fvar.fixed(at + 12)),
    })
  }
  return { axes, instanceCount }
}

const AXIS_NAMES: Record<string, string> = {
  wght: "Weight",
  wdth: "Width",
  ital: "Italic",
  slnt: "Slant",
  opsz: "Optical size",
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/* ------------------------------------------------------------ GSUB and GPOS */

function readFeatureTags(layout: Reader | null): string[] {
  if (!layout) return []
  const featureListOffset = layout.u16(6)
  if (featureListOffset === 0) return []
  const count = layout.u16(featureListOffset)
  const tags: string[] = []
  for (let i = 0; i < Math.min(count, 2048); i += 1) {
    const tag = layout.tag(featureListOffset + 2 + i * 6)
    if (isPrintableTag(tag)) tags.push(tag.trim())
  }
  return tags
}

/* --------------------------------------------------------------------- cmap */

/**
 * The code points a font maps to a real glyph, as merged ranges.
 *
 * Format 12 is preferred where present because it is the only one that reaches
 * beyond the Basic Multilingual Plane; format 4 covers everything else a
 * working font carries. A format 4 segment can map some of its code points to
 * glyph zero, so those are resolved one by one rather than trusted as a range.
 */
function readCmap(cmap: Reader): Array<[number, number]> {
  const numTables = cmap.u16(2)
  let format12: number | null = null
  let format4: number | null = null

  for (let i = 0; i < numTables; i += 1) {
    const record = 4 + i * 8
    const platform = cmap.u16(record)
    const encoding = cmap.u16(record + 2)
    const offset = cmap.u32(record + 4)
    if (!cmap.fits(offset, 2)) continue
    const format = cmap.u16(offset)
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10))
    if (!unicode) continue
    if (format === 12 && format12 === null) format12 = offset
    if (format === 4 && format4 === null) format4 = offset
  }

  if (format12 !== null) return readFormat12(cmap, format12)
  if (format4 !== null) return readFormat4(cmap, format4)
  return []
}

function readFormat12(cmap: Reader, offset: number): Array<[number, number]> {
  const groups = cmap.u32(offset + 12)
  const ranges: Array<[number, number]> = []
  for (let i = 0; i < Math.min(groups, 100_000); i += 1) {
    const at = offset + 16 + i * 12
    const start = cmap.u32(at)
    const end = Math.min(cmap.u32(at + 4), 0x10ffff)
    const startGlyph = cmap.u32(at + 8)
    // A group starting at glyph zero maps its first code point to .notdef.
    ranges.push([startGlyph === 0 ? start + 1 : start, end])
  }
  return mergeRanges(ranges)
}

function readFormat4(cmap: Reader, offset: number): Array<[number, number]> {
  const segCount = cmap.u16(offset + 6) / 2
  const endCodes = offset + 14
  const startCodes = endCodes + segCount * 2 + 2
  const idDeltas = startCodes + segCount * 2
  const idRangeOffsets = idDeltas + segCount * 2

  const ranges: Array<[number, number]> = []
  for (let s = 0; s < segCount; s += 1) {
    const end = cmap.u16(endCodes + s * 2)
    const start = cmap.u16(startCodes + s * 2)
    const delta = cmap.i16(idDeltas + s * 2)
    const rangeOffsetAt = idRangeOffsets + s * 2
    const rangeOffset = cmap.u16(rangeOffsetAt)
    if (start > end) continue

    let runStart: number | null = null
    for (let code = start; code <= end && code !== 0xffff; code += 1) {
      let glyph: number
      if (rangeOffset === 0) {
        glyph = (code + delta) & 0xffff
      } else {
        const glyphAt = rangeOffsetAt + rangeOffset + (code - start) * 2
        const raw = cmap.fits(glyphAt, 2) ? cmap.u16(glyphAt) : 0
        glyph = raw === 0 ? 0 : (raw + delta) & 0xffff
      }
      if (glyph !== 0) {
        if (runStart === null) runStart = code
      } else if (runStart !== null) {
        ranges.push([runStart, code - 1])
        runStart = null
      }
    }
    if (runStart !== null) ranges.push([runStart, Math.min(end, 0xfffe)])
  }
  return mergeRanges(ranges)
}
