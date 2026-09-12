/**
 * Every limit on what a creator can hand the importer, in one place.
 *
 * The composer shows these, the server actions enforce them, the readers
 * enforce the ones about content, and the migration repeats the few a column
 * can hold. A limit changed here and nowhere else is a limit the server still
 * enforces at its old value, which is the safe direction to be wrong in.
 */
export const IMPORT_LIMITS = {
  /** Sources in one import, counting the link and the pasted text. */
  maxSources: 10,
  /** At most one public link per import, so re-importing it can open what exists. */
  maxLinks: 1,
  /** Characters of pasted text. Well inside the server action body limit. */
  maxPasteCharacters: 200_000,
  maxPdfBytes: 20 * 1024 * 1024,
  /** Pages of a PDF read for text. */
  maxPdfPages: 40,
  maxHtmlBytes: 2 * 1024 * 1024,
  /** Characters of running text carried from one source into evidence. */
  maxBodyText: 20_000,
  maxAudioBytes: 25 * 1024 * 1024,
  /** Ten minutes. A recording is auto-stopped here, and refused beyond it. */
  maxAudioMs: 10 * 60 * 1000,
} as const

export function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`
}
