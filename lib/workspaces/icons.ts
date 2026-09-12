import { createAdminClient } from "@/lib/supabase/admin"
import { sniffMimeType } from "@/lib/products/sniff"

/**
 * The workspace icon: private storage, tenant-scoped path, sniffed bytes.
 *
 * Path convention: <workspace_id>/<icon_id><ext>, the same workspace-id-leading
 * shape product-assets uses, so storage_object_workspace_id() reads the owner
 * out of the first segment and one policy expression covers the bucket.
 *
 * SECURITY: unlike a product asset, an icon never gets a signed upload URL. It
 * is small enough to post to a server action, so the bytes arrive at the server,
 * are identified from their own magic numbers, and are written with the service
 * role to a path the server builds. No caller ever holds a capability into this
 * bucket, and no caller names its own destination.
 */

export const WORKSPACE_ICON_BUCKET = "workspace-icons"

/** Matches the bucket's own limit and the sentence the settings page shows. */
export const MAX_ICON_BYTES = 2 * 1024 * 1024

/** Rendered in an <img> by the browser, so: raster formats it can decode. */
export const ICON_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const

export type IconMimeType = (typeof ICON_MIME_TYPES)[number]

const EXTENSIONS: Record<IconMimeType, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
}

/**
 * Short lived, and affordable: the settings page mints one per render and the
 * browser follows it immediately. A signed URL is a bearer capability, so there
 * is no reason to hand out one that outlives the page that asked for it.
 */
const ICON_URL_TTL_SECONDS = 60 * 5

export type IconCheck =
  { ok: true; mimeType: IconMimeType; bytes: Buffer } | { ok: false; message: string }

export function describeIconRules(): string {
  return "PNG, JPG or WebP. Maximum 2 MB."
}

/**
 * What the bytes actually are, not what the browser said they were.
 *
 * The upload's declared type is a hint and trivially spoofed, so the size is
 * checked first (it is the cheap one) and the format is then read from the magic
 * numbers. A .png that is really a zip is refused here rather than stored and
 * served back to a browser as an image.
 */
export function checkIcon(bytes: Buffer, declaredSize: number): IconCheck {
  if (declaredSize === 0 || bytes.length === 0) {
    return { ok: false, message: "That file is empty. Choose an image." }
  }
  if (bytes.length > MAX_ICON_BYTES) {
    return { ok: false, message: "That image is over 2 MB. Choose a smaller one." }
  }

  const sniffed = sniffMimeType(bytes)
  if (!ICON_MIME_TYPES.includes(sniffed as IconMimeType)) {
    return { ok: false, message: "That file is not a PNG, JPG or WebP image." }
  }

  return { ok: true, mimeType: sniffed as IconMimeType, bytes }
}

export function buildIconPath(workspaceId: string, iconId: string, mimeType: IconMimeType): string {
  return `${workspaceId}/${iconId}${EXTENSIONS[mimeType]}`
}

export async function uploadIcon(
  storagePath: string,
  bytes: Buffer,
  mimeType: IconMimeType,
): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin.storage
    .from(WORKSPACE_ICON_BUCKET)
    .upload(storagePath, bytes, { contentType: mimeType, upsert: true })
  if (error) throw error
}

/**
 * Removes icon objects. Never the reason a save fails: a replaced icon that
 * lingers in the bucket wastes a few kilobytes, while a save that reports
 * failure after the column has moved leaves the creator disbelieving a change
 * that actually landed.
 */
export async function removeIcons(storagePaths: string[]): Promise<void> {
  if (storagePaths.length === 0) return
  const admin = createAdminClient()
  const { error } = await admin.storage.from(WORKSPACE_ICON_BUCKET).remove(storagePaths)
  if (error) throw error
}

export async function createIconUrl(storagePath: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data, error } = await admin.storage
    .from(WORKSPACE_ICON_BUCKET)
    .createSignedUrl(storagePath, ICON_URL_TTL_SECONDS)

  // A missing object is a broken icon, not a broken page: fall back to initials.
  if (error || !data) return null
  return data.signedUrl
}

/**
 * The fallback when no icon is set: up to two letters from the workspace name.
 *
 * Words first, so "Northbound Type" is NT rather than NO. A name with no letters
 * at all still has to render something, and the fan mark is the wordless option.
 */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .map((word) => [...word].filter((ch) => /\p{L}|\p{N}/u.test(ch)))
    .filter((letters) => letters.length > 0)

  if (words.length === 0) return ""
  // One word gives two of its own letters, so "Studio" is ST rather than a
  // lonely S in a 56 pixel circle.
  if (words.length === 1) return words[0]!.slice(0, 2).join("").toUpperCase()
  return `${words[0]![0]}${words[1]![0]}`.toUpperCase()
}
