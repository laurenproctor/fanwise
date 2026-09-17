/**
 * What a package is, as data: the half of `./package.ts` an adapter may
 * import.
 *
 * Adapters are bundled to the browser by the listing editor, and the build
 * itself reaches storage, the admin client and, through the asset pipeline,
 * sharp. So the spec, the limits and the manifest reader live here with no
 * import at all, and the build stays server-side in `./package.ts`.
 */

export const PACKAGE_LIMITS = {
  /** The sum of the input files' bytes. A package past this is refused before any download. */
  maxInputBytes: 512 * 1024 * 1024,
  /** Entries kept in the row's manifest. */
  maxManifestEntries: 500,
} as const

export interface PackageEntry {
  /** A ready buyer file, documentation or license row of the product. */
  assetId: string
  /** The row's checksum, so the spec hash moves when the bytes do. */
  checksum: string
  /** Where the file lands in the archive; an archive's own entries land under it. */
  path: string
}

export interface PackageSpec {
  /** A shape key, never a channel name. */
  key: string
  /** The archive's filename, ending in .zip. */
  filename: string
  entries: PackageEntry[]
  /** A generated text file, from the canonical record only. */
  readme: { path: string; text: string } | null
}

/** The source the package row derives from: the first file in the spec. */
export function packageSource(spec: PackageSpec): string | null {
  return spec.entries[0]?.assetId ?? null
}

/** What a built package holds, read back from its row. */
export function readPackageManifest(
  metadata: unknown,
): { entryCount: number; entries: string[] } | null {
  const m = metadata as { entryCount?: unknown; entries?: unknown } | null
  if (!m || typeof m.entryCount !== "number" || !Array.isArray(m.entries)) return null
  return {
    entryCount: m.entryCount,
    entries: m.entries.filter((e): e is string => typeof e === "string"),
  }
}
