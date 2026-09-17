import { readAltTextSource, type AltTextSource } from "@/lib/products/image-metadata"
import { KNOWN_SCRIPTS } from "./coverage"
import {
  FONT_FORMATS,
  formatFromFilename,
  readAltText,
  readArchive,
  readFontAsset,
  readImageDimensions,
  type ArchiveEntryProblem,
  type ArchiveReading,
  type DetectedFont,
  type FontAssetReading,
  type FontAxis,
  type FontFormat,
} from "./detected"
import type { FontMetadata, FontStyle } from "@/lib/products/metadata"
import type { AssetState, AssetType, ProductAsset } from "@/lib/products/types"

/**
 * The font publishing workspace's model: what it shows, derived from rows.
 *
 * Pure, so the page, the readiness rules and the tests all read the same
 * derivation. Three kinds of value pass through here and are never blurred:
 *
 *   canonical   the product row and its validated metadata, entered once
 *   detected    what the uploaded files say, stored per asset by the job
 *   channel     each listing's own copy, owned by its channel
 *
 * Detected values seed canonical ones only where the canonical value is
 * absent (`adoptionPatch`). A value a creator has set is never replaced by a
 * reading, including a later reading of a new file.
 */

export const FONT_SECTIONS = [
  "basics",
  "files",
  "family",
  "coverage",
  "images",
  "licensing",
  "drafts",
] as const

export type FontSection = (typeof FONT_SECTIONS)[number]

export const FONT_SECTION_LABELS: Record<FontSection, string> = {
  basics: "Listing basics",
  files: "Font files",
  family: "Family & styles",
  coverage: "Character coverage",
  images: "Specimen images",
  licensing: "Licensing & pricing",
  drafts: "Marketplace drafts",
}

export function parseSection(value: unknown): FontSection | null {
  return typeof value === "string" && (FONT_SECTIONS as readonly string[]).includes(value)
    ? (value as FontSection)
    : null
}

/** The canonical product columns the workspace edits, in form shape. */
export interface FontProductValues {
  name: string
  canonicalTitle: string
  slug: string
  shortDescription: string
  canonicalDescription: string
  brandName: string
  version: string
  basePrice: number | null
  currency: string
  licenseSummary: string
}

/* -------------------------------------------------------------------- files */

/** Asset types the font files section manages. Images live in their own section. */
export const FONT_FILE_ASSET_TYPES = ["deliverable", "archive", "documentation", "license"] as const
export type FontFileAssetType = (typeof FONT_FILE_ASSET_TYPES)[number]

export interface FontFileView {
  id: string
  filename: string
  assetType: AssetType
  state: AssetState
  byteSize: number | null
  failureReason: string | null
  /** From the reading where there is one, else from the name. */
  format: FontFormat | null
  kind: "font" | "archive" | "document"
  reading: FontAssetReading
  /** What a package holds, for an archive. `none` for every other kind. */
  archive: ArchiveReading
  /** The filename of an earlier file with identical bytes, if any. */
  duplicateOf: string | null
}

const DOCUMENT_TYPES: ReadonlySet<string> = new Set(["documentation", "license"])

export function fontFileViews(assets: readonly ProductAsset[]): FontFileView[] {
  const sources = assets
    .filter((asset) => asset.derived_from === null)
    .filter((asset) => (FONT_FILE_ASSET_TYPES as readonly string[]).includes(asset.asset_type))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))

  const firstByChecksum = new Map<string, string>()
  return sources.map((asset) => {
    const reading = readFontAsset(asset.metadata)
    const nameFormat = formatFromFilename(asset.filename)
    const kind: FontFileView["kind"] = DOCUMENT_TYPES.has(asset.asset_type)
      ? "document"
      : asset.asset_type === "archive"
        ? "archive"
        : "font"

    let duplicateOf: string | null = null
    if (asset.checksum) {
      const earlier = firstByChecksum.get(asset.checksum)
      if (earlier) duplicateOf = earlier
      else firstByChecksum.set(asset.checksum, asset.filename)
    }

    return {
      id: asset.id,
      filename: asset.filename,
      assetType: asset.asset_type,
      state: asset.asset_state,
      byteSize: asset.byte_size,
      failureReason: asset.failure_reason,
      format: reading.kind === "font" ? reading.font.format : nameFormat,
      kind,
      archive: kind === "archive" ? readArchive(asset.metadata) : { kind: "none" },
      reading:
        // A ready file whose bytes are not a font's never reached the parser:
        // the job only reads what sniffs as a font. Say so, rather than showing
        // it as a font with nothing detected. What is left with no reading is a
        // font the job never read (`unreadFontFiles`).
        kind === "font" &&
        asset.asset_state === "ready" &&
        reading.kind === "none" &&
        !(asset.mime_type ?? "").startsWith("font/")
          ? { kind: "problem", problem: "unrecognised" }
          : reading,
      duplicateOf,
    }
  })
}

/**
 * Ready font files with no reading.
 *
 * The reading lands in the same update that makes a row ready, so these were
 * settled by a worker built before fonts were read. The files section asks
 * for each one to be read (`readFontFileAction`) rather than showing "Not read
 * yet" for good.
 */
export function unreadFontFiles(files: readonly FontFileView[]): FontFileView[] {
  return files.filter(
    (file) =>
      file.state === "ready" &&
      ((file.kind === "font" && file.reading.kind === "none") ||
        (file.kind === "archive" && file.archive.kind === "none")),
  )
}

/**
 * The fonts read inside a ready package. Empty for anything that is not a
 * package, is still processing, or could not be opened.
 */
export function archiveFonts(file: FontFileView): DetectedFont[] {
  if (file.kind !== "archive" || file.state !== "ready" || file.archive.kind !== "archive")
    return []
  return file.archive.contents.entries.flatMap((entry) => (entry.font ? [entry.font] : []))
}

/** Font entries inside a package that could not be read, with why. */
export function archiveFontProblems(
  file: FontFileView,
): Array<{ path: string; problem: ArchiveEntryProblem }> {
  if (file.kind !== "archive" || file.state !== "ready" || file.archive.kind !== "archive")
    return []
  return file.archive.contents.entries.flatMap((entry) =>
    entry.kind === "font" && entry.problem ? [{ path: entry.path, problem: entry.problem }] : [],
  )
}

/* ------------------------------------------------------------------- family */

export interface DetectedStyle {
  key: string
  name: string
  weight?: number
  width?: number
  italic?: boolean
  isVariable: boolean
  formats: FontFormat[]
  assetIds: string[]
}

export interface DetectedFamily {
  /** Every family name the files carry. More than one is worth a question. */
  familyNames: string[]
  designer?: string
  manufacturer?: string
  version?: string
  glyphCount?: number
  isVariable: boolean
  axes: FontAxis[]
  scripts: string[]
  languages: string[]
  features: string[]
  formats: FontFormat[]
  styles: DetectedStyle[]
  embeddingRestricted: boolean
  /** Ready font files that produced a reading. Zero means nothing was detected. */
  readCount: number
}

/** Prefer a desktop format as a style's representative reading: webfonts are often subset. */
const READING_PREFERENCE: readonly FontFormat[] = ["otf", "ttf", "woff2", "woff"]

function intersect(lists: readonly string[][]): string[] {
  if (lists.length === 0) return []
  return lists.reduce((acc, list) => acc.filter((item) => list.includes(item)))
}

/**
 * The family as the files describe it.
 *
 * Coverage is claimed for the family only where **every** style has it. A
 * family whose Regular has Cyrillic and whose Shadow does not does not
 * support Cyrillic as a family, and a buyer of the family would find out the
 * hard way. Glyph count is the smallest style's for the same reason.
 */
export function detectFamily(files: readonly FontFileView[]): DetectedFamily {
  // Loose files and the fonts inside packages, on equal terms: a family
  // uploaded as one ZIP is detected exactly as it would be from its files.
  const readings = files.flatMap((file) => {
    if (file.state !== "ready" || file.duplicateOf !== null) return []
    if (file.reading.kind === "font") return [{ file, font: file.reading.font }]
    return archiveFonts(file).map((font) => ({ file, font }))
  })

  const byStyle = new Map<string, Array<(typeof readings)[number]>>()
  for (const reading of readings) {
    const key =
      reading.font.postscriptName ||
      [reading.font.familyName, reading.font.styleName].filter(Boolean).join(" ") ||
      reading.file.filename
    const list = byStyle.get(key) ?? []
    list.push(reading)
    byStyle.set(key, list)
  }

  const styles: DetectedStyle[] = []
  const representatives: Array<(typeof readings)[number]["font"]> = []
  for (const [key, group] of byStyle) {
    const sorted = [...group].sort(
      (a, b) =>
        READING_PREFERENCE.indexOf(a.font.format) - READING_PREFERENCE.indexOf(b.font.format),
    )
    const best = sorted[0]!.font
    representatives.push(best)
    styles.push({
      key,
      name: best.fullName || [best.familyName, best.styleName].filter(Boolean).join(" ") || key,
      weight: best.weight,
      width: best.width,
      italic: best.italic,
      isVariable: best.isVariable,
      formats: FONT_FORMATS.filter((format) => group.some((g) => g.font.format === format)),
      assetIds: group.map((g) => g.file.id),
    })
  }
  styles.sort((a, b) => (a.weight ?? 400) - (b.weight ?? 400) || a.name.localeCompare(b.name))

  const first = <K extends "designer" | "manufacturer" | "version">(key: K) =>
    representatives.find((font) => font[key])?.[key]

  const axesByTag = new Map<string, FontAxis>()
  for (const font of representatives) {
    for (const axis of font.axes) {
      const existing = axesByTag.get(axis.tag)
      axesByTag.set(
        axis.tag,
        existing
          ? {
              ...existing,
              min: Math.min(existing.min, axis.min),
              max: Math.max(existing.max, axis.max),
            }
          : axis,
      )
    }
  }

  const glyphCounts = representatives.flatMap((font) =>
    font.glyphCount !== undefined ? [font.glyphCount] : [],
  )

  return {
    familyNames: [...new Set(representatives.flatMap((f) => (f.familyName ? [f.familyName] : [])))],
    designer: first("designer"),
    manufacturer: first("manufacturer"),
    version: first("version"),
    glyphCount: glyphCounts.length > 0 ? Math.min(...glyphCounts) : undefined,
    isVariable: representatives.some((font) => font.isVariable),
    axes: [...axesByTag.values()],
    scripts: KNOWN_SCRIPTS.filter((script) =>
      intersect(representatives.map((f) => f.scripts)).includes(script),
    ),
    languages: intersect(representatives.map((f) => f.languages)),
    features: intersect(representatives.map((f) => f.features)).sort(),
    formats: FONT_FORMATS.filter((format) => readings.some((r) => r.font.format === format)),
    styles,
    embeddingRestricted: representatives.some((font) => font.embedding === "restricted"),
    readCount: readings.length,
  }
}

/* ----------------------------------------------------------------- adoption */

export type FontPatch = { [K in Exclude<keyof FontMetadata, "kind">]?: FontMetadata[K] | null }

export interface ProductPatch {
  name?: string
  canonicalTitle?: string | null
  slug?: string
  shortDescription?: string | null
  canonicalDescription?: string | null
  brandName?: string | null
  version?: string | null
  basePrice?: number | null
  currency?: string
  licenseSummary?: string | null
  font?: FontPatch
}

function sameList(a: readonly unknown[] | undefined, b: readonly unknown[]): boolean {
  return a !== undefined && a.length === b.length && a.every((item, i) => item === b[i])
}

function styleFromDetected(style: DetectedStyle): FontStyle {
  return {
    key: style.key,
    name: style.name.slice(0, 120),
    ...(style.weight !== undefined ? { weight: style.weight } : {}),
    ...(style.width !== undefined ? { width: style.width } : {}),
    ...(style.italic !== undefined ? { italic: style.italic } : {}),
  }
}

/**
 * What the files can fill in that the product does not yet say.
 *
 * Returns null when there is nothing to adopt, so the caller saves nothing.
 *
 * - A field the creator has set is left alone. `undefined` is "never
 *   answered"; an empty list or a changed number is an answer.
 * - Styles are seeded once, when the product has no list. Faces uploaded later
 *   are offered by `unlistedStyles`, never added behind the creator's back.
 * - `formats` is the one exception. It is a measurement of which files exist,
 *   not a claim anyone makes, so it always follows the files.
 */
export function adoptionPatch(params: {
  metadata: FontMetadata
  values: Pick<FontProductValues, "version" | "brandName">
  family: DetectedFamily
}): ProductPatch | null {
  const { metadata, values, family } = params
  if (family.readCount === 0) return null

  const font: FontPatch = {}
  const patch: ProductPatch = {}

  if (!sameList(metadata.formats, family.formats)) font.formats = family.formats

  if (metadata.glyphCount === undefined && family.glyphCount) font.glyphCount = family.glyphCount
  if (metadata.scripts === undefined && family.scripts.length > 0) font.scripts = family.scripts
  if (metadata.languageSupport === undefined && family.languages.length > 0) {
    font.languageSupport = family.languages
  }
  if (metadata.features === undefined && family.features.length > 0) {
    font.features = family.features
  }
  if (metadata.isVariable === undefined) font.isVariable = family.isVariable
  if (metadata.axes === undefined && family.axes.length > 0) font.axes = family.axes

  // Styles are seeded once. After that the list is the creator's: a style they
  // removed stays removed even though its file is still uploaded, and a newly
  // uploaded face is offered to them (`unlistedStyles`) rather than added.
  if (metadata.styles === undefined && family.styles.length > 0) {
    font.styles = family.styles.map(styleFromDetected)
    font.styleCount = family.styles.length
  }

  if (values.version.trim() === "" && family.version) patch.version = family.version
  const attribution = family.designer ?? family.manufacturer
  if (values.brandName.trim() === "" && attribution) patch.brandName = attribution.slice(0, 120)

  if (Object.keys(font).length > 0) patch.font = font
  return Object.keys(patch).length > 0 ? patch : null
}

/** Detected faces the product's style list does not include. */
export function unlistedStyles(metadata: FontMetadata, family: DetectedFamily): DetectedStyle[] {
  if (metadata.styles === undefined) return []
  const listed = new Set(metadata.styles.map((style) => style.key))
  return family.styles.filter((style) => !listed.has(style.key))
}

export function styleFromDetectedStyle(style: DetectedStyle): FontStyle {
  return styleFromDetected(style)
}

/* ------------------------------------------------------------------- images */

export interface SpecimenImageView {
  id: string
  filename: string
  assetType: "cover_image" | "preview_image"
  state: AssetState
  checksum: string | null
  width: number | null
  height: number | null
  altText: string
  altTextSource: AltTextSource | null
}

export function specimenImageViews(assets: readonly ProductAsset[]): SpecimenImageView[] {
  return assets.flatMap((asset) => {
    if (asset.derived_from !== null) return []
    if (asset.asset_type !== "cover_image" && asset.asset_type !== "preview_image") return []
    const dimensions = readImageDimensions(asset.metadata)
    return [
      {
        id: asset.id,
        filename: asset.filename,
        assetType: asset.asset_type,
        state: asset.asset_state,
        checksum: asset.checksum,
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
        altText: readAltText(asset.metadata),
        altTextSource: readAltTextSource(asset.metadata),
      },
    ]
  })
}

/**
 * The crop a grid of a given shape applies to an image.
 *
 * Deliberately not per channel: no adapter declares an image aspect ratio, and
 * inventing one here would be a claim about a marketplace this file may not
 * name. These are the two shapes storefront grids commonly use, stated as
 * shapes, so the warning is about geometry rather than about anyone's rules.
 */
export const GRID_SHAPES = [
  { key: "square", label: "Square grid", ratio: 1 },
  { key: "landscape", label: "4:3 grid", ratio: 4 / 3 },
] as const

/** The share of the image a centred crop to `ratio` discards, 0 to 1. */
export function cropLoss(width: number, height: number, ratio: number): number {
  const imageRatio = width / height
  return imageRatio > ratio ? 1 - ratio / imageRatio : 1 - imageRatio / ratio
}

/** Below this, a hero image looks soft on a large screen. */
export const MIN_HERO_WIDTH = 1200

/* ----------------------------------------------------------------- channels */

/**
 * Whose value a channel draft holds for a field it can inherit (ADR on listing
 * inheritance, docs/channel-adapters.md): `inherited` follows the product and
 * changes when the product does, `customized` is this channel's own and never
 * does, `absent` is a field this channel has no place for.
 */
export type DraftFieldOrigin = "inherited" | "customized" | "absent"

export interface ChannelDraftView {
  connectionId: string
  channelName: string
  integrationType: "api" | "assisted"
  listingId: string | null
  /** Resolved values: what the channel would be sent, as of the last server read. */
  title: string | null
  description: string | null
  tags: string[]
  category: string | null
  price: number | null
  currency: string
  origins: Record<"title" | "description" | "price", DraftFieldOrigin>
  results: Array<{
    key: string
    label: string
    severity: "error" | "warning" | "info"
    satisfied: boolean
    message?: string
  }>
  liveness: string
  externalUrl: string | null
  editHref: string
}

/**
 * A draft's value for an inheritable field, as of this keystroke.
 *
 * The server resolved the draft when the page loaded; an inherited field has
 * followed the product since, so it is read from the values being edited. A
 * customized field is the channel's and is shown as stored.
 */
export function liveDraftValue(
  channel: ChannelDraftView,
  field: "title" | "description" | "price",
  values: Pick<FontProductValues, "name" | "canonicalTitle" | "canonicalDescription" | "basePrice">,
): string | number | null {
  switch (channel.origins[field]) {
    case "absent":
      return null
    case "customized":
      return channel[field]
    case "inherited":
      if (field === "title") return values.canonicalTitle.trim() || values.name
      if (field === "description") return values.canonicalDescription.trim() || null
      return values.basePrice
  }
}
