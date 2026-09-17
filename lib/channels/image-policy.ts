import type { ImageSpec } from "@/lib/products/derivatives"
import { readImageDimensions } from "@/lib/products/image-metadata"
import type { ProductAsset } from "@/lib/products/types"
import type { PublishContext } from "./types"

/**
 * What a channel can take as an image, and the rendition that makes a source
 * fit when it cannot.
 *
 * Every marketplace has three rules about a picture: the formats it accepts,
 * how many bytes it will hold, and how large a picture is worth sending. The
 * policy states those three as data on the adapter, and this module turns a
 * policy and a source asset into either "send the source" or one ImageSpec for
 * the derivative engine. The adapter never touches sharp, storage or a pixel
 * (architecture invariant 2); the engine never learns a channel exists.
 *
 * Two decisions worth stating, because both are easy to reverse by accident:
 *
 * A source inside the policy is sent as it is. A rendition is a re-encode, and
 * re-encoding a picture that already fits costs quality for nothing. The
 * common case, a creator who exported sensibly, produces no derivative at all.
 *
 * Renditions never crop. The fit is `inside`: the picture keeps its own shape
 * and only shrinks. Storefront grids crop for themselves, each to its own
 * ratio, and a picture cropped here would then be cropped again there. The
 * font workspace shows the creator how much a square or 4:3 grid takes off so
 * they can compose for it; that is the crop control, not a spec.
 */

export interface ImagePolicy {
  /**
   * Names the ceiling in derivative filenames and spec keys, as a shape rather
   * than a channel, so two channels with the same ceiling share one cached
   * rendition. "fit-3000", never a marketplace's name.
   */
  key: string
  /** Longest edge worth sending. Anything larger is scaled down to it. */
  maxEdge: number
  /** Mime types the channel accepts as they are. */
  accepts: readonly string[]
  /** The channel's byte ceiling for one image. */
  maxByteSize: number
}

/** Formats the engine can produce and a channel policy may name. */
const RENDITION_FORMATS = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
} as const

/**
 * The spec that makes this source acceptable, or null when the source already
 * is.
 *
 * A GIF is never re-encoded: a rendition would keep one frame of an animation,
 * and a channel that takes GIFs takes them whole. One that does not gets the
 * source anyway and refuses it itself, which is what it did before this
 * existed.
 *
 * Dimensions come from the finalize job's measurement. A picture measured by
 * an older worker has none; it is judged on format and bytes alone rather than
 * re-encoded on a guess.
 */
export function renditionSpec(policy: ImagePolicy, asset: ProductAsset): ImageSpec | null {
  const mime = asset.mime_type
  if (!mime || !mime.startsWith("image/") || mime === "image/gif") return null

  const dimensions = readImageDimensions(asset.metadata)
  const tooLarge =
    dimensions !== null && (dimensions.width > policy.maxEdge || dimensions.height > policy.maxEdge)
  const tooHeavy = asset.byte_size !== null && asset.byte_size > policy.maxByteSize
  const wrongFormat = !policy.accepts.includes(mime)

  if (!tooLarge && !tooHeavy && !wrongFormat) return null

  const format = renditionFormat(policy, mime)
  if (!format) return null

  return {
    key: `${policy.key}-${format}`,
    width: policy.maxEdge,
    height: policy.maxEdge,
    fit: "inside",
    format,
    maxByteSize: policy.maxByteSize,
  }
}

/**
 * PNG stays PNG where the channel takes it, because a specimen on a
 * transparent ground would otherwise gain a white box. Everything else becomes
 * JPEG, the one format every channel in the catalog accepts and the one whose
 * quality the engine can step down to land under a byte ceiling.
 */
function renditionFormat(policy: ImagePolicy, mime: string): ImageSpec["format"] | null {
  if (mime === "image/png" && policy.accepts.includes("image/png")) return "png"
  if (policy.accepts.includes("image/jpeg")) return "jpeg"
  const accepted = policy.accepts.find((type) => type in RENDITION_FORMATS)
  return accepted ? RENDITION_FORMATS[accepted as keyof typeof RENDITION_FORMATS] : null
}

export interface ChannelImage {
  /** A time-limited signed link to what the channel should fetch. */
  url: string
  /** The name to hand the channel, with the extension the bytes actually have. */
  filename: string
  /** True when a rendition was sent rather than the source. */
  rendered: boolean
}

/**
 * The address an adapter sends for one image: the rendition when the policy
 * needs one and the runner can build it, the source otherwise.
 *
 * A rendition that cannot be built falls back to the source rather than
 * failing the publish. The publish is about the product going on sale; a
 * picture the channel then refuses is reported by the channel, exactly as it
 * was before renditions existed, and never turned into a failure of Fanwise's
 * own making.
 */
export async function channelImage(
  context: PublishContext,
  policy: ImagePolicy,
  asset: ProductAsset,
): Promise<ChannelImage> {
  const spec = renditionSpec(policy, asset)
  if (spec && context.derivativeUrl) {
    try {
      return {
        url: await context.derivativeUrl(asset, spec),
        filename: withExtension(asset.filename, spec.format),
        rendered: true,
      }
    } catch (error) {
      console.error("[channels] rendition failed, sending the source", {
        assetId: asset.id,
        spec: spec.key,
        name: error instanceof Error ? error.name : "unknown",
      })
    }
  }
  return { url: await context.assetUrl(asset), filename: asset.filename, rendered: false }
}

function withExtension(filename: string, format: ImageSpec["format"]): string {
  const stem = filename.replace(/\.[^.]+$/, "")
  return `${stem}.${format === "jpeg" ? "jpg" : format}`
}
