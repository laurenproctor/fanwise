import { createHash } from "node:crypto"
import sharp from "sharp"

/**
 * The image derivative engine.
 *
 * This module knows nothing about channels, and must not learn. It takes an
 * ImageSpec as plain data and renders to it. Which spec a given marketplace
 * wants is the adapter's business (A3), per architecture invariant 2.
 *
 * plan-audit 3.4 is the reason this exists at all: one product becoming six
 * correctly shaped listings rests entirely on per-channel derivatives, and a
 * badly cropped specimen is the thing creators actually judge.
 */

export type ImageFormat = "jpeg" | "png" | "webp"

/** How to reconcile a source whose aspect ratio differs from the target. */
export type ImageFit =
  /** Fill the frame and crop the overflow. */
  | "cover"
  /** Fit inside the frame and pad to size. */
  | "contain"

/** Which region survives a cover crop. */
export type CropFocus =
  /** Highest-entropy region. Better than centre for specimens and lockups. */
  "attention" | "centre" | "north" | "south" | "east" | "west"

export interface ImageSpec {
  /** Stable identifier, used in filenames and logs. Not a channel name. */
  key: string
  width: number
  height: number
  format: ImageFormat
  /** 1-100. Ignored for png. */
  quality?: number
  fit?: ImageFit
  focus?: CropFocus
  /** Hard ceiling. The renderer steps quality down to land under it. */
  maxByteSize?: number
  /** Background for contain padding. Defaults to white. */
  background?: string
}

export interface RenderedDerivative {
  data: Buffer
  width: number
  height: number
  format: ImageFormat
  byteSize: number
  /** Quality actually used after any downward steps. */
  quality: number
}

export class UpscaleRefused extends Error {
  constructor(
    readonly sourceWidth: number,
    readonly sourceHeight: number,
    readonly spec: ImageSpec,
  ) {
    super(
      `source is ${sourceWidth}x${sourceHeight}, smaller than the ${spec.width}x${spec.height} ` +
        `required by "${spec.key}"`,
    )
    this.name = "UpscaleRefused"
  }
}

const DEFAULT_QUALITY = 82
const MIN_QUALITY = 40
const QUALITY_STEP = 10

/**
 * Canonical, order-independent hash of a spec.
 *
 * Together with derived_from this is the entire cache key: see the
 * product_assets_derivative_cache_idx unique index. There is deliberately no
 * source checksum in it, because a ready asset's bytes are immutable, so
 * derived_from already pins the input.
 */
export function specHash(spec: ImageSpec): string {
  const canonical = JSON.stringify({
    key: spec.key,
    width: spec.width,
    height: spec.height,
    format: spec.format,
    quality: spec.quality ?? DEFAULT_QUALITY,
    fit: spec.fit ?? "cover",
    focus: spec.focus ?? "attention",
    maxByteSize: spec.maxByteSize ?? null,
    background: spec.background ?? "#ffffff",
  })
  return createHash("sha256").update(canonical).digest("hex")
}

/** sharp takes either a gravity keyword or a numeric strategy constant. */
function sharpPosition(focus: CropFocus): string | number {
  return focus === "attention" ? sharp.strategy.attention : focus
}

export interface SourceDimensions {
  width: number
  height: number
}

export async function readImageDimensions(data: Buffer): Promise<SourceDimensions | null> {
  try {
    const { width, height } = await sharp(data).metadata()
    if (!width || !height) return null
    return { width, height }
  } catch {
    return null
  }
}

/**
 * Renders one derivative. Pure with respect to storage and the database, which
 * is what makes it directly testable against real bytes.
 *
 * Refuses to upscale. Shipping a blurry enlargement silently is worse than
 * telling the creator their source is too small, and a channel requirement can
 * surface that in A3.
 */
export async function renderDerivative(
  source: Buffer,
  spec: ImageSpec,
): Promise<RenderedDerivative> {
  const dimensions = await readImageDimensions(source)
  if (!dimensions) throw new Error("source is not a readable image")

  if (dimensions.width < spec.width || dimensions.height < spec.height) {
    throw new UpscaleRefused(dimensions.width, dimensions.height, spec)
  }

  const fit = spec.fit ?? "cover"
  const focus = spec.focus ?? "attention"
  let quality = spec.quality ?? DEFAULT_QUALITY

  for (;;) {
    const pipeline = sharp(source)
      .rotate() // honour EXIF orientation before measuring anything
      .resize({
        width: spec.width,
        height: spec.height,
        fit,
        position: fit === "cover" ? sharpPosition(focus) : undefined,
        background: spec.background ?? "#ffffff",
        withoutEnlargement: true,
      })

    const encoded =
      spec.format === "png"
        ? await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
        : spec.format === "webp"
          ? await pipeline.webp({ quality }).toBuffer({ resolveWithObject: true })
          : await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer({ resolveWithObject: true })

    const byteSize = encoded.data.byteLength
    const withinCeiling = !spec.maxByteSize || byteSize <= spec.maxByteSize

    // png quality is not adjustable, so there is nothing to step down to.
    if (withinCeiling || spec.format === "png" || quality <= MIN_QUALITY) {
      return {
        data: encoded.data,
        width: encoded.info.width,
        height: encoded.info.height,
        format: spec.format,
        byteSize,
        quality,
      }
    }

    // Clamp, so the floor is exactly MIN_QUALITY and never undershoots it.
    quality = Math.max(MIN_QUALITY, quality - QUALITY_STEP)
  }
}

export function derivativeFilename(spec: ImageSpec, sourceFilename: string): string {
  const stem = sourceFilename.replace(/\.[^.]+$/, "").slice(0, 80)
  const extension = spec.format === "jpeg" ? "jpg" : spec.format
  return `${stem}-${spec.key}.${extension}`
}
