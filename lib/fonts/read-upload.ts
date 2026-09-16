import { brotliDecompressSync, inflateSync } from "node:zlib"
import sharp from "sharp"
import { isDerivableImage } from "@/lib/products/sniff"
import { readFontAsset } from "./detected"
import { inspectFont } from "./inspect"
import type { Decompressors } from "./sfnt"

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

const decompressors: Decompressors = {
  inflate: (data) => inflateSync(data, { maxOutputLength: MAX_DECOMPRESSED_BYTES }),
  brotli: (data) => brotliDecompressSync(data, { maxOutputLength: MAX_DECOMPRESSED_BYTES }),
}

const FONT_MIME_TYPES = new Set(["font/otf", "font/ttf", "font/woff", "font/woff2"])

export function isFontMimeType(mimeType: string | null | undefined): boolean {
  return mimeType !== null && mimeType !== undefined && FONT_MIME_TYPES.has(mimeType)
}

export async function describeUpload(
  data: Buffer,
  mimeType: string,
): Promise<Record<string, unknown> | null> {
  if (isFontMimeType(mimeType)) {
    const inspection = inspectFont(data, decompressors)
    return inspection.ok ? { font: inspection.font } : { fontProblem: inspection.problem }
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
