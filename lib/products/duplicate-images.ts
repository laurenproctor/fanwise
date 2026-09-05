/**
 * Spotting the same picture twice in one product's image list.
 *
 * By checksum, not by filename. Two files called "Screenshot 2026-09-05 at
 * 6.51.39 PM.jpg" are usually the same picture, but the same picture is also
 * routinely called something else — saved twice, renamed, dragged from a copy —
 * and a name comparison would miss the case it exists for while flagging two
 * genuinely different crops that share a name. `finalize_asset` already records
 * the checksum of the stored bytes, so the honest comparison costs nothing.
 *
 * Position matters in the answer, not just the fact. The list is ordered, the
 * first image is the cover, and "same as the cover" is a different sentence
 * from "same as the third one" — so this returns where the original sits rather
 * than a boolean. Dragging a tile changes both, which is why it is computed
 * from the rendered order rather than stored.
 *
 * Deliberately not a block. A byte-identical image twice in one product is
 * almost never intentional, but "almost never" is the reason to say something
 * rather than the reason to refuse: the cost of being wrong about a warning is
 * a sentence someone ignores, and the cost of being wrong about a refusal is a
 * creator who cannot do the thing they meant.
 */

/**
 * For each position, where the same bytes first appeared, or null if this is
 * the first (or the only) time they have.
 *
 * A null checksum is never a duplicate of anything. It means the finalize job
 * has not measured the file yet, and a tile that says "same as the cover"
 * before anyone knows what it contains would be guessing.
 */
export function duplicateOrigins(checksums: readonly (string | null)[]): (number | null)[] {
  const firstSeenAt = new Map<string, number>()

  return checksums.map((checksum, index) => {
    if (!checksum) return null
    const origin = firstSeenAt.get(checksum)
    if (origin === undefined) {
      firstSeenAt.set(checksum, index)
      return null
    }
    return origin
  })
}
