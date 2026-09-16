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
  maxPdfBytes: Math.floor(4.8 * 1024 * 1024),
  /** Pages of a PDF read for text. */
  maxPdfPages: 40,
  maxHtmlBytes: Math.floor(4.8 * 1024 * 1024),
  /** Characters of running text carried from one source into evidence. */
  maxBodyText: 20_000,
  /**
   * Characters the review screen's description field takes: the canonical
   * product's own limit, so nothing a model composed is cut before the creator
   * reads it. A description the screen fills in is still fitted to it, so the
   * field never opens over its own limit.
   */
  maxListingDescription: 8000,
  /** Characters of the short description, as `updateProductSchema` takes it. */
  maxShortDescription: 500,
  /**
   * A recording is sent to the transcription provider in one request, base64
   * inside JSON, so it is kept small: the recorder captures speech at 48 kbps,
   * which puts ten minutes near 3.6 MB, well inside this.
   */
  maxAudioBytes: 10 * 1024 * 1024,
  /** Ten minutes. A recording is auto-stopped here, and refused beyond it. */
  maxAudioMs: 10 * 60 * 1000,
} as const

export function megabytes(bytes: number): string {
  // One decimal, so 4.8 MB is not rounded up to a limit Fanwise does not keep.
  return `${Number((bytes / (1024 * 1024)).toFixed(1))} MB`
}
