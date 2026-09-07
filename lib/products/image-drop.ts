import type { ReorderableAssetType } from "./image-order"

/**
 * Deciding what a dropped pile of files means, with no browser in the room.
 *
 * A drop is messier than a file picker. It can carry a folder, a screenshot
 * still being written, a PDF, a dragged link, or eleven photographs at once,
 * and the panel has to answer the same three questions every time: which of
 * these are images, which one becomes the cover, and what do we say about the
 * rest. Keeping that pure is what makes it testable without a DOM.
 *
 * This filter is a courtesy, not a security boundary. The server sniffs the
 * stored bytes in `finalize_asset` and records the type it actually found
 * (`lib/products/sniff.ts`), so a file that lies about itself is caught there.
 * What this prevents is a creator dragging a zip onto the image grid and
 * getting a row that only fails minutes later.
 */

/** The structural minimum of a `File`, so this module needs no DOM lib. */
export interface DroppedFile {
  name: string
  type: string
}

export interface ImageDropUpload<T extends DroppedFile> {
  file: T
  assetType: ReorderableAssetType
}

/**
 * Why a drop produced nothing.
 *
 * `no_files` is a drag that carried no file at all — dragged text, a link, or
 * on most browsers a folder, which arrives as an entry rather than a file.
 * `not_images` is files that are simply the wrong kind. They read the same to
 * the code and completely differently to the person, so they are separate.
 */
export type ImageDropRejection = "no_files" | "not_images"

export type ImageDropPlan<T extends DroppedFile> =
  | { ok: true; uploads: ImageDropUpload<T>[]; skipped: number }
  | { ok: false; reason: ImageDropRejection }

/**
 * The extensions worth trusting when the browser volunteers no type.
 *
 * Empty `type` is common rather than exotic: files dragged out of some archive
 * viewers and several Linux file managers arrive that way. The set matches
 * DERIVABLE in `sniff.ts`, because an image this accepts but the derivative
 * pipeline cannot read is a row that lands `failed`.
 */
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp"])

function isImage(file: DroppedFile): boolean {
  if (file.type) return file.type.startsWith("image/")
  const extension = file.name.split(".").pop()?.toLowerCase()
  return extension !== undefined && IMAGE_EXTENSIONS.has(extension)
}

/**
 * Which dropped files to upload, and what each one becomes.
 *
 * `existingCount` is how many images the product already has, which is the only
 * thing that decides the cover: position is the model (see `planImageOrder`),
 * so the first image a product ever gets is the cover and everything after it
 * is a preview until someone drags it to the front. Dropping four photographs
 * onto an empty product must therefore produce exactly one cover, which is why
 * the index is offset rather than each file being judged on its own.
 */
export function planImageDrop<T extends DroppedFile>(
  files: readonly T[],
  existingCount: number,
): ImageDropPlan<T> {
  if (files.length === 0) return { ok: false, reason: "no_files" }

  const images = files.filter(isImage)
  if (images.length === 0) return { ok: false, reason: "not_images" }

  return {
    ok: true,
    uploads: images.map((file, index) => ({
      file,
      assetType: existingCount + index === 0 ? "cover_image" : "preview_image",
    })),
    skipped: files.length - images.length,
  }
}
