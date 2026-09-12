/**
 * What a profile image may be. Split from `./avatars` so browser code can read
 * the rules without importing the module that holds the service-role client.
 *
 * Matches the bucket's own limit (migration 20260912220000) and the sentence
 * the builder shows.
 */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024

export const AVATAR_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const

export type AvatarMimeType = (typeof AVATAR_MIME_TYPES)[number]

export const AVATAR_RULES_SENTENCE = "JPG, PNG or WebP · 5 MB max"
