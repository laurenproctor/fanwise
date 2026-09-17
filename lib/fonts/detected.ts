import { z } from "zod"

/**
 * What a font file said about itself, as stored on its asset row.
 *
 * Kept on `product_assets.metadata` rather than on the product, because it is
 * evidence about one file and not a decision about the product. The product's
 * own `metadata` holds what the creator stands behind — seeded from this, then
 * theirs to correct. Keeping the two apart is what lets a correction survive a
 * re-upload: the new file's reading lands on the new row, and the product's
 * corrected value is untouched.
 *
 * Written only by the finalize job, from the stored bytes. The browser never
 * supplies any of it.
 */

export const FONT_FORMATS = ["otf", "ttf", "woff", "woff2"] as const
export type FontFormat = (typeof FONT_FORMATS)[number]

export const fontAxisSchema = z.object({
  tag: z.string().min(1).max(4),
  name: z.string().max(64).optional(),
  min: z.number(),
  default: z.number(),
  max: z.number(),
})

export type FontAxis = z.infer<typeof fontAxisSchema>

export const detectedFontSchema = z.object({
  format: z.enum(FONT_FORMATS),
  outlines: z.enum(["truetype", "cff"]).optional(),
  familyName: z.string().max(200).optional(),
  styleName: z.string().max(200).optional(),
  fullName: z.string().max(200).optional(),
  postscriptName: z.string().max(200).optional(),
  version: z.string().max(40).optional(),
  designer: z.string().max(200).optional(),
  manufacturer: z.string().max(200).optional(),
  weight: z.number().int().min(1).max(1000).optional(),
  /** OS/2 usWidthClass, 1 (ultra-condensed) to 9 (ultra-expanded). */
  width: z.number().int().min(1).max(9).optional(),
  italic: z.boolean().optional(),
  glyphCount: z.number().int().min(0).max(65535).optional(),
  codepointCount: z.number().int().min(0).optional(),
  isVariable: z.boolean(),
  axes: z.array(fontAxisSchema).max(64),
  instanceCount: z.number().int().min(0).optional(),
  scripts: z.array(z.string().max(64)).max(64),
  languages: z.array(z.string().max(64)).max(200),
  blocks: z
    .array(
      z.object({ name: z.string().max(80), covered: z.number().int(), total: z.number().int() }),
    )
    .max(64),
  features: z.array(z.string().max(4)).max(512),
  /** From OS/2 fsType. What the file itself permits a licensee to embed. */
  embedding: z.enum(["installable", "restricted", "preview_print", "editable"]).optional(),
})

export type DetectedFont = z.infer<typeof detectedFontSchema>

export const FONT_PROBLEMS = ["unrecognised", "collection", "malformed", "missing_tables"] as const
export type FontProblem = (typeof FONT_PROBLEMS)[number]

/**
 * The shape the finalize job writes. Exactly one of `font` or `fontProblem`
 * for a font upload; neither for any other file.
 */
export const fontAssetMetadataSchema = z.union([
  z.object({ font: detectedFontSchema }),
  z.object({ fontProblem: z.enum(FONT_PROBLEMS) }),
])

export type FontAssetReading =
  | { kind: "font"; font: DetectedFont }
  | { kind: "problem"; problem: FontProblem }
  | { kind: "none" }

/** Reads an asset's metadata without ever throwing on an old or foreign shape. */
export function readFontAsset(metadata: unknown): FontAssetReading {
  const parsed = fontAssetMetadataSchema.safeParse(metadata)
  if (!parsed.success) return { kind: "none" }
  return "font" in parsed.data
    ? { kind: "font", font: parsed.data.font }
    : { kind: "problem", problem: parsed.data.fontProblem }
}

/* ---------------------------------------------------------------- archives */

/**
 * What the finalize job found inside a ZIP package (`metadata.archive`), or
 * why it could not look (`metadata.archiveProblem`).
 *
 * Every font inside is read with the same inspector as a loose file, so the
 * workspace can detect a family from a package alone. The package itself is
 * still what buyers download, exactly as uploaded: this is a table of
 * contents, never an unpacking.
 */
export const ARCHIVE_ENTRY_KINDS = ["font", "document", "image", "other"] as const
export type ArchiveEntryKind = (typeof ARCHIVE_ENTRY_KINDS)[number]

/** Why one entry inside a package has no reading. */
export const ARCHIVE_ENTRY_PROBLEMS = [
  ...FONT_PROBLEMS,
  "encrypted",
  "too_large",
  "unsupported",
  "not_read",
] as const
export type ArchiveEntryProblem = (typeof ARCHIVE_ENTRY_PROBLEMS)[number]

export const archiveEntrySchema = z.object({
  path: z.string().max(512),
  byteSize: z.number().int().min(0),
  kind: z.enum(ARCHIVE_ENTRY_KINDS),
  font: detectedFontSchema.optional(),
  problem: z.enum(ARCHIVE_ENTRY_PROBLEMS).optional(),
})
export type ArchiveEntry = z.infer<typeof archiveEntrySchema>

export const archiveContentsSchema = z.object({
  entries: z.array(archiveEntrySchema).max(500),
  /** Every file in the package, junk and unlisted ones included. */
  entryCount: z.number().int().min(0),
  fontCount: z.number().int().min(0),
  /** Operating-system leftovers left out of the list. */
  ignoredCount: z.number().int().min(0),
  /** True when the package held more files than the list shows. */
  truncated: z.boolean(),
})
export type ArchiveContents = z.infer<typeof archiveContentsSchema>

export const ARCHIVE_PROBLEMS = ["malformed", "unsupported"] as const
export type ArchiveProblem = (typeof ARCHIVE_PROBLEMS)[number]

const archiveMetadataSchema = z.union([
  z.object({ archive: archiveContentsSchema }),
  z.object({ archiveProblem: z.enum(ARCHIVE_PROBLEMS) }),
])

export type ArchiveReading =
  | { kind: "archive"; contents: ArchiveContents }
  | { kind: "problem"; problem: ArchiveProblem }
  | { kind: "none" }

/** Reads a package's table of contents without ever throwing on an old shape. */
export function readArchive(metadata: unknown): ArchiveReading {
  const parsed = archiveMetadataSchema.safeParse(metadata)
  if (!parsed.success) return { kind: "none" }
  return "archive" in parsed.data
    ? { kind: "archive", contents: parsed.data.archive }
    : { kind: "problem", problem: parsed.data.archiveProblem }
}

export const ARCHIVE_PROBLEM_TEXT: Record<ArchiveProblem, string> = {
  malformed:
    "This ZIP file could not be opened. It may be damaged; zip the folder again and replace it.",
  unsupported:
    "This ZIP uses a format Fanwise cannot look inside (a very large or split archive). Buyers still receive it as uploaded.",
}

export const ARCHIVE_ENTRY_PROBLEM_TEXT: Record<ArchiveEntryProblem, string> = {
  unrecognised: "Not a font file Fanwise can read",
  collection: "A font collection; upload each face on its own",
  malformed: "Damaged or incomplete",
  missing_tables: "Missing tables every font needs",
  encrypted: "Password-protected, so it was not read",
  too_large: "Too large to read inside a package",
  unsupported: "Compressed in a way Fanwise cannot read",
  not_read: "Not read; the package holds more fonts than Fanwise reads",
}

export const FONT_PROBLEM_TEXT: Record<FontProblem, string> = {
  unrecognised: "This is not a font file Fanwise can read. Upload OTF, TTF, WOFF or WOFF2.",
  collection:
    "This is a font collection. Upload each face as its own OTF or TTF so buyers know what they get.",
  malformed: "This font file is damaged or incomplete. Export it again and replace it.",
  missing_tables:
    "This file is missing tables every font needs. Export it again from your font editor.",
}

/*
  Image metadata moved to lib/products/image-metadata.ts once alt text stopped
  being a font-only concern. Re-exported so nothing that reads it here breaks.
*/
export {
  imageDimensionsSchema,
  readImageDimensions,
  readAltText,
} from "@/lib/products/image-metadata"

/** Which extension a browser-picked file claims. A hint only; the job sniffs. */
export function formatFromFilename(filename: string): FontFormat | null {
  const ext = filename.toLowerCase().split(".").pop() ?? ""
  return (FONT_FORMATS as readonly string[]).includes(ext) ? (ext as FontFormat) : null
}

export const WEIGHT_NAMES: Record<number, string> = {
  100: "Thin",
  200: "Extra light",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "Semibold",
  700: "Bold",
  800: "Extra bold",
  900: "Black",
}

export const WIDTH_NAMES: Record<number, string> = {
  1: "Ultra condensed",
  2: "Extra condensed",
  3: "Condensed",
  4: "Semi condensed",
  5: "Normal",
  6: "Semi expanded",
  7: "Expanded",
  8: "Extra expanded",
  9: "Ultra expanded",
}

export function weightLabel(weight: number | undefined): string {
  if (weight === undefined) return "—"
  const rounded = Math.round(weight / 100) * 100
  return `${weight}${WEIGHT_NAMES[rounded] ? ` · ${WEIGHT_NAMES[rounded]}` : ""}`
}
