/**
 * Files an operating system leaves in a folder that no buyer wants and no
 * reading needs. Skipped when a folder is dropped and when a package is
 * looked inside, and counted rather than listed, so a creator who zipped a
 * folder on a Mac is not shown forty resource forks.
 */
const JUNK_NAMES = new Set([".DS_Store", "Thumbs.db", "desktop.ini", ".localized"])

export function isJunkPath(path: string): boolean {
  const segments = path.split("/")
  const name = segments[segments.length - 1] ?? ""
  return segments.includes("__MACOSX") || JUNK_NAMES.has(name) || name.startsWith("._")
}
