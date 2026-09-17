import { brotliDecompressSync, inflateRawSync, inflateSync } from "node:zlib"
import sharp from "sharp"
import { isDerivableImage } from "@/lib/products/sniff"
import { inspectArchive, type ArchiveDecompressors } from "./archive"
import { readArchive, readFontAsset } from "./detected"
import { isFontMimeType } from "./font-mime"
import { inspectFont } from "./inspect"

/**
 * What the finalize job records about an upload beyond its size and type.
 *
 * Server-only, because the decompressors are Node's. Read from the stored
 * bytes, like everything else the job writes: a browser that parsed the file
 * itself could claim any family name it liked.
 *
 * Never throws. A reading that fails leaves the asset ready and says why on
 * its metadata, because a file that uploaded correctly is still a file the
 * creator can see, replace or remove, and hiding it behind a failed state
 * would take those actions away.
 */

/** Generous for a font, bounded against a zip bomb dressed as WOFF2. */
const MAX_DECOMPRESSED_BYTES = 128 * 1024 * 1024

const decompressors: ArchiveDecompressors = {
  inflate: (data) => inflateSync(data, { maxOutputLength: MAX_DECOMPRESSED_BYTES }),
  brotli: (data) => brotliDecompressSync(data, { maxOutputLength: MAX_DECOMPRESSED_BYTES }),
  inflateRaw: (data, maxOutputLength) => inflateRawSync(data, { maxOutputLength }),
}

export { isFontMimeType }

export const ZIP_MIME_TYPE = "application/zip"

export async function describeUpload(
  data: Buffer,
  mimeType: string,
): Promise<Record<string, unknown> | null> {
  if (isFontMimeType(mimeType)) {
    const inspection = inspectFont(data, decompressors)
    return inspection.ok ? { font: inspection.font } : { fontProblem: inspection.problem }
  }

  // A package is looked inside and every font in it read, so a creator who
  // uploads one ZIP sees what they would from the files themselves. The
  // bytes buyers receive are untouched; this is a table of contents.
  if (mimeType === ZIP_MIME_TYPE) {
    const inspection = inspectArchive(data, decompressors)
    return inspection.ok ? { archive: inspection.contents } : { archiveProblem: inspection.problem }
  }

  if (isDerivableImage(mimeType)) {
    try {
      const { width, height } = await sharp(data).metadata()
      return width && height ? { width, height } : null
    } catch {
      return null
    }
  }

  return null
}

/**
 * A ready font row the job never read.
 *
 * The reading lands in the same update that makes a row ready, so a ready
 * font with none was settled by a worker built before fonts were read. Worker
 * deploys are by hand and lag behind `main`; this is how the gap shows up.
 */
export function isUnreadFont(mimeType: string | null | undefined, metadata: unknown): boolean {
  return isFontMimeType(mimeType) && readFontAsset(metadata).kind === "none"
}

/** A ready package nobody has looked inside: settled before packages were read. */
export function isUnreadArchive(mimeType: string | null | undefined, metadata: unknown): boolean {
  return mimeType === ZIP_MIME_TYPE && readArchive(metadata).kind === "none"
}

/** Either kind of file the finalize job would read again on request. */
export function isUnread(mimeType: string | null | undefined, metadata: unknown): boolean {
  return isUnreadFont(mimeType, metadata) || isUnreadArchive(mimeType, metadata)
}
