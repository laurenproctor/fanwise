import { createAdminClient } from "@/lib/supabase/admin"
import { sniffMimeType } from "@/lib/products/sniff"

/**
 * The public profile's avatar: private storage, profile-scoped path, sniffed
 * bytes.
 *
 * Deliberately the same shape as `lib/workspaces/icons.ts`, including the
 * private bucket, and the privacy is the part worth defending. An avatar is
 * shown to the public, so a public bucket looks like the obvious answer and is
 * not: a public object stays fetchable by its URL forever, which means
 * unpublishing a profile would take down the page and leave the creator's
 * picture sitting on a CDN. Serving it through a route handler that mints a
 * five-minute signed URL makes "unpublish" mean what it says.
 *
 * Path convention: <public_profile_id>/<avatar_id><ext>. The profile id leads,
 * so `storage_object_profile_workspace_id()` can read the owning workspace out
 * of the first segment and one policy expression covers the bucket.
 *
 * SECURITY: no signed upload URL exists for this bucket. The bytes are posted
 * to a server action, identified from their own magic numbers, and written
 * with the service role to a path the server builds, so no caller ever holds a
 * capability into the bucket and no caller names its own destination.
 */

export const PROFILE_AVATAR_BUCKET = "public-profile-avatars"

/** Matches the bucket's own limit and the sentence the settings page shows. */
export const MAX_AVATAR_BYTES = 4 * 1024 * 1024

export const AVATAR_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const

export type AvatarMimeType = (typeof AVATAR_MIME_TYPES)[number]

const EXTENSIONS: Record<AvatarMimeType, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
}

/**
 * Longer than the workspace icon's five minutes, and shorter than a session.
 *
 * A public page is cached and its avatar is fetched by strangers, so the URL
 * has to outlive the render that produced it. Ten minutes is long enough that
 * a cached page does not serve a dead image and short enough that a leaked URL
 * is not a lasting one.
 */
const AVATAR_URL_TTL_SECONDS = 60 * 10

export type AvatarCheck =
  { ok: true; mimeType: AvatarMimeType; bytes: Buffer } | { ok: false; message: string }

export function describeAvatarRules(): string {
  return "PNG, JPG or WebP. Maximum 4 MB. Square images look best."
}

/**
 * What the bytes actually are, not what the browser said they were. Size first
 * because it is the cheap check, then the format from the magic numbers, so a
 * .png that is really a zip is refused here rather than stored and later
 * served back to a browser as an image.
 */
export function checkAvatar(bytes: Buffer, declaredSize: number): AvatarCheck {
  if (declaredSize === 0 || bytes.length === 0) {
    return { ok: false, message: "That file is empty. Choose an image." }
  }
  if (bytes.length > MAX_AVATAR_BYTES) {
    return { ok: false, message: "That image is over 4 MB. Choose a smaller one." }
  }

  const sniffed = sniffMimeType(bytes)
  if (!(AVATAR_MIME_TYPES as readonly string[]).includes(sniffed)) {
    return { ok: false, message: "That file is not a PNG, JPG or WebP image." }
  }

  return { ok: true, mimeType: sniffed as AvatarMimeType, bytes }
}

export function buildAvatarPath(
  profileId: string,
  avatarId: string,
  mimeType: AvatarMimeType,
): string {
  return `${profileId}/${avatarId}${EXTENSIONS[mimeType]}`
}

export async function uploadAvatar(
  storagePath: string,
  bytes: Buffer,
  mimeType: AvatarMimeType,
): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin.storage
    .from(PROFILE_AVATAR_BUCKET)
    .upload(storagePath, bytes, { contentType: mimeType, upsert: true })
  if (error) throw error
}

/**
 * Removes avatar objects. Never the reason a save fails: a replaced avatar
 * that lingers wastes a few kilobytes, while a save that reports failure after
 * the column has already moved leaves a creator disbelieving a change that
 * actually landed.
 */
export async function removeAvatars(storagePaths: string[]): Promise<void> {
  if (storagePaths.length === 0) return
  const admin = createAdminClient()
  const { error } = await admin.storage.from(PROFILE_AVATAR_BUCKET).remove(storagePaths)
  if (error) throw error
}

export async function createAvatarUrl(storagePath: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data, error } = await admin.storage
    .from(PROFILE_AVATAR_BUCKET)
    .createSignedUrl(storagePath, AVATAR_URL_TTL_SECONDS)

  // A missing object is a broken avatar, not a broken page: fall back to
  // initials rather than rendering an <img> at a dead URL.
  if (error || !data) return null
  return data.signedUrl
}

/**
 * The fallback when no avatar is set: up to two letters from the display name.
 *
 * The same rule `lib/workspaces/icons.ts` uses, and deliberately a copy rather
 * than a shared import. These two names are different things — one is the
 * workspace, one is the public identity — and a shared helper would be the
 * first thread pulling them back together.
 */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .map((word) => [...word].filter((ch) => /\p{L}|\p{N}/u.test(ch)))
    .filter((letters) => letters.length > 0)

  if (words.length === 0) return ""
  if (words.length === 1) return words[0]!.slice(0, 2).join("").toUpperCase()
  return `${words[0]![0]}${words[1]![0]}`.toUpperCase()
}
