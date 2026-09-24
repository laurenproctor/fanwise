/**
 * How much of a ZIP package Fanwise reads, stated once for the job that reads
 * it, the route that serves one font out of it, and the workspace that says
 * which fonts can be shown. Dependency-free, so the workspace model can import
 * it without pulling the reader into the browser bundle.
 */
export const ARCHIVE_LIMITS = {
  /** Entries kept in the list. Beyond this the contents are marked truncated. */
  maxEntries: 500,
  /** Fonts actually decompressed and read. Beyond this an entry says not_read. */
  maxFontsRead: 100,
  /** One entry's bytes after decompression. */
  maxEntryBytes: 64 * 1024 * 1024,
  /** All entries' bytes after decompression, across the whole reading. */
  maxTotalBytes: 256 * 1024 * 1024,
} as const

/**
 * The largest package the preview route will open in a request.
 *
 * A packaged font is read by downloading the whole package and reading one
 * entry, inside an interactive request rather than a job. That is fine for
 * the few megabytes a font family is and not fine for a package at the
 * bucket's 4 GB ceiling, so past this size the workspace shows the package's
 * fonts as delivered but not loadable, and the preview says so.
 */
export const MAX_PREVIEWABLE_PACKAGE_BYTES = 128 * 1024 * 1024
