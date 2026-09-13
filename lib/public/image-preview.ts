import { AVATAR_MIME_TYPES, MAX_AVATAR_BYTES } from "./avatar-rules"

/**
 * Local image previews for the profile builder.
 *
 * An object URL holds the whole file in memory until it is revoked, and a
 * creator trying five pictures in a row is five files held for the life of the
 * tab. So there is only ever one live URL: setting a new file revokes the
 * previous one, and disposing revokes whatever is left.
 *
 * `URL.createObjectURL` is injected so the rule can be tested in Node.
 */

export interface ObjectUrls {
  create: (file: Blob) => string
  revoke: (url: string) => void
}

export interface ImagePreviewManager {
  show(file: Blob): string
  clear(): void
  current(): string | null
  dispose(): void
}

export function createImagePreviewManager(urls: ObjectUrls): ImagePreviewManager {
  let url: string | null = null

  function revoke() {
    if (url !== null) urls.revoke(url)
    url = null
  }

  return {
    show(file) {
      revoke()
      url = urls.create(file)
      return url
    },
    clear: revoke,
    current: () => url,
    dispose: revoke,
  }
}

export type LocalImageCheck = { ok: true } | { ok: false; message: string }

/**
 * The browser's first look at a picked file: the declared type and the size.
 * Advisory only. The server action sniffs the bytes, because a declared type
 * is whatever the file's name suggested.
 */
export function checkLocalImage(file: { type: string; size: number }): LocalImageCheck {
  if (!(AVATAR_MIME_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, message: "That file is not a JPG, PNG or WebP image." }
  }
  if (file.size === 0) return { ok: false, message: "That file is empty. Choose an image." }
  if (file.size > MAX_AVATAR_BYTES) {
    return { ok: false, message: "That image is over 5 MB. Choose a smaller one." }
  }
  return { ok: true }
}

/**
 * Whether a pick is the same file as the last one uploaded. Re-picking the
 * same picture — or a field change re-rendering the picker — must not upload
 * the same bytes again.
 */
export function fileIdentity(file: { name: string; size: number; lastModified: number }): string {
  return `${file.name}:${file.size}:${file.lastModified}`
}
