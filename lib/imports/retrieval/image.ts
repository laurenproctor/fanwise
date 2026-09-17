import sharp from "sharp"
import { isDerivableImage, sniffMimeType } from "@/lib/products/sniff"
import { sha256 } from "@/lib/products/assets"
import { IMPORT_LIMITS } from "../limits"

/**
 * What a picture is, from its bytes, and whether Fanwise will keep it.
 *
 * One inspection for every picture an import meets, whichever way it arrived:
 * a picture a page advertised is fetched and then inspected here, and a
 * picture the creator uploaded is read from private storage and inspected
 * here. The rules are the same because the result is the same — a row in
 * `product_assets` — and a picture that would be refused from a stranger's
 * page is not made acceptable by having been chosen from a file dialog.
 *
 *   1. **The bytes decide the type, not the header and not the extension.**
 *      `sniffMimeType` reads the signature. A `.png` that is really a zip is a
 *      zip.
 *   2. **Only raster images Fanwise can decode.** SVG is deliberately refused:
 *      it is markup, it can carry script, and a preview image is not worth the
 *      conversation. `isDerivableImage` is the same predicate the upload
 *      pipeline uses, so the two cannot drift.
 *   3. **Dimensions are measured, not read.** `sharp` decodes the header; an
 *      image that will not decode is not an image, and one larger than the
 *      pixel cap is refused before anything tries to resize it. An animated
 *      GIF or WebP is measured by its first frame and kept whole.
 *
 * Nothing here writes anywhere. Bytes in, facts or a reason out.
 */

export const IMAGE_LIMITS = {
  maxBytes: IMPORT_LIMITS.maxImageBytes,
  /** A decoded image larger than this is a decompression bomb, not a preview. */
  maxPixels: 40_000_000,
  /** Tracking pixels and spacer gifs are not previews. */
  minEdge: 32,
} as const

export interface InspectedImage {
  mimeType: string
  byteSize: number
  width: number
  height: number
  checksum: string
  /** Frames, for an animated picture. One for a still. */
  frames: number
}

/** Why a picture was not kept. Mirrors the asset skip reasons. */
export type ImageProblem = "too_large" | "not_an_image"

export type ImageInspection =
  { ok: true; image: InspectedImage } | { ok: false; problem: ImageProblem }

export async function inspectImage(bytes: Buffer): Promise<ImageInspection> {
  if (bytes.byteLength === 0) return { ok: false, problem: "not_an_image" }
  if (bytes.byteLength > IMAGE_LIMITS.maxBytes) return { ok: false, problem: "too_large" }

  const mimeType = sniffMimeType(bytes)
  if (!isDerivableImage(mimeType)) return { ok: false, problem: "not_an_image" }

  let width: number
  let height: number
  let frames: number
  try {
    const metadata = await sharp(bytes, { limitInputPixels: IMAGE_LIMITS.maxPixels }).metadata()
    width = metadata.width ?? 0
    height = metadata.height ?? 0
    frames = metadata.pages ?? 1
  } catch {
    // A file that sniffs as a png and will not decode is not a png.
    return { ok: false, problem: "not_an_image" }
  }

  if (width < IMAGE_LIMITS.minEdge || height < IMAGE_LIMITS.minEdge) {
    return { ok: false, problem: "not_an_image" }
  }
  if (width * height > IMAGE_LIMITS.maxPixels) return { ok: false, problem: "too_large" }

  return {
    ok: true,
    image: {
      mimeType,
      byteSize: bytes.byteLength,
      width,
      height,
      checksum: sha256(bytes),
      frames: Math.max(1, frames),
    },
  }
}

/** Node's Buffer over the same memory, for the sniffer and for sharp. */
export function asBuffer(bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}
