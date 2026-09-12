import sharp from "sharp"
import { OutboundError, outboundRequest, type OutboundOptions } from "@/lib/net/outbound"
import { isDerivableImage, sniffMimeType } from "@/lib/products/sniff"
import { sha256 } from "@/lib/products/assets"
import type { SourceAsset } from "../evidence"

/**
 * Fetching one picture a page advertised.
 *
 * The URL came out of a stranger's markup, so it gets the same treatment as the
 * page did and then several checks the page did not need:
 *
 *   1. **The same outbound boundary.** https only, public address, pinned
 *      before connect, redirects re-validated, deadline, size cap. An
 *      `og:image` pointing at `http://169.254.169.254/` is refused here for
 *      exactly the reason the page would have been.
 *   2. **The bytes decide the type, not the header and not the extension.**
 *      `sniffMimeType` reads the signature. A `Content-Type: image/png` on a
 *      zip is a zip.
 *   3. **Only raster images Fanwise can decode.** SVG is deliberately refused:
 *      it is markup, it can carry script, and a preview image is not worth the
 *      conversation. `isDerivableImage` is the same predicate the upload
 *      pipeline uses, so the two cannot drift.
 *   4. **Dimensions are measured, not read.** `sharp` decodes the header; an
 *      image that will not decode is not an image, and one larger than the
 *      pixel cap is refused before anything tries to resize it.
 *
 * Nothing here writes to the database or to storage. It returns bytes and
 * facts, and the runner decides what to do with them — so this file can be
 * tested with a scripted transport and no Supabase at all.
 */

export const ASSET_LIMITS = {
  /** How many pictures one import will fetch, however many the page offered. */
  maxAssets: 6,
  maxBytes: 8 * 1024 * 1024,
  connectTimeoutMs: 6_000,
  responseTimeoutMs: 12_000,
  maxRedirects: 3,
  /** A decoded image larger than this is a decompression bomb, not a preview. */
  maxPixels: 40_000_000,
  minEdge: 32,
} as const

export interface FetchedAsset {
  bytes: Buffer
  mimeType: string
  byteSize: number
  width: number
  height: number
  checksum: string
}

/** Why an asset was not kept. Mirrors `SourceAsset["skipped"]`. */
export type AssetSkip = NonNullable<SourceAsset["skipped"]>

export class AssetSkipped extends Error {
  readonly reason: AssetSkip
  constructor(reason: AssetSkip, cause?: unknown) {
    super(`asset skipped: ${reason}`, cause === undefined ? undefined : { cause })
    this.name = "AssetSkipped"
    this.reason = reason
  }
}

export interface FetchAssetOptions {
  outbound?: Pick<OutboundOptions, "resolve" | "transport">
}

export async function fetchAsset(
  url: string,
  options: FetchAssetOptions = {},
): Promise<FetchedAsset> {
  let result: Awaited<ReturnType<typeof outboundRequest>>

  try {
    result = await outboundRequest(
      url,
      {
        method: "GET",
        // The same restraint as the page read: no cookie, no authorization,
        // no referer. A referer here would tell the image host which Fanwise
        // page asked for it.
        headers: {
          "user-agent": "FanwiseImporter/1.0 (+https://fanwise.app/bot)",
          accept: "image/*",
        },
      },
      {
        ...options.outbound,
        connectTimeoutMs: ASSET_LIMITS.connectTimeoutMs,
        responseTimeoutMs: ASSET_LIMITS.responseTimeoutMs,
        maxBodyBytes: ASSET_LIMITS.maxBytes,
        maxRedirects: ASSET_LIMITS.maxRedirects,
      },
    )
  } catch (error) {
    if (error instanceof OutboundError) {
      throw new AssetSkipped(
        error.kind === "body_too_large"
          ? "too_large"
          : error.kind === "address_blocked" || error.kind === "hostname" || error.kind === "scheme"
            ? "blocked"
            : "unreachable",
        error,
      )
    }
    throw new AssetSkipped("unreachable", error)
  }

  if (result.response.status < 200 || result.response.status >= 300) {
    throw new AssetSkipped("unreachable", { status: result.response.status })
  }

  const bytes = Buffer.from(await result.response.arrayBuffer())
  if (bytes.byteLength === 0) throw new AssetSkipped("not_an_image")
  if (bytes.byteLength > ASSET_LIMITS.maxBytes) throw new AssetSkipped("too_large")

  const mimeType = sniffMimeType(bytes)
  if (!isDerivableImage(mimeType)) throw new AssetSkipped("not_an_image")

  let width: number
  let height: number
  try {
    const metadata = await sharp(bytes, { limitInputPixels: ASSET_LIMITS.maxPixels }).metadata()
    width = metadata.width ?? 0
    height = metadata.height ?? 0
  } catch (cause) {
    // A file that sniffs as a png and will not decode is not a png.
    throw new AssetSkipped("not_an_image", cause)
  }

  if (width < ASSET_LIMITS.minEdge || height < ASSET_LIMITS.minEdge) {
    // Tracking pixels and spacer gifs. Not previews.
    throw new AssetSkipped("not_an_image")
  }
  if (width * height > ASSET_LIMITS.maxPixels) throw new AssetSkipped("too_large")

  return {
    bytes,
    mimeType,
    byteSize: bytes.byteLength,
    width,
    height,
    checksum: sha256(bytes),
  }
}
