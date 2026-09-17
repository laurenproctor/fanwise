import { OutboundError, outboundRequest, type OutboundOptions } from "@/lib/net/outbound"
import type { SourceAsset } from "../evidence"
import { IMAGE_LIMITS, inspectImage, type InspectedImage } from "./image"

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
 *   2. **Then the same inspection every picture gets** (`./image.ts`): the
 *      bytes decide the type, only raster images Fanwise can decode are kept,
 *      and dimensions are measured rather than read. A `Content-Type:
 *      image/png` on a zip is a zip.
 *
 * Nothing here writes to the database or to storage. It returns bytes and
 * facts, and the runner decides what to do with them — so this file can be
 * tested with a scripted transport and no Supabase at all.
 */

export const ASSET_LIMITS = {
  /** How many pictures one import will keep, however many its sources offered. */
  maxAssets: 6,
  maxBytes: IMAGE_LIMITS.maxBytes,
  connectTimeoutMs: 6_000,
  responseTimeoutMs: 12_000,
  maxRedirects: 3,
  maxPixels: IMAGE_LIMITS.maxPixels,
  minEdge: IMAGE_LIMITS.minEdge,
} as const

export interface FetchedAsset extends InspectedImage {
  bytes: Buffer
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
  const inspected = await inspectImage(bytes)
  if (!inspected.ok) throw new AssetSkipped(inspected.problem)
  return { ...inspected.image, bytes }
}
