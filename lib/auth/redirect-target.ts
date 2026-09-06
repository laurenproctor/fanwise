/**
 * Where a verified recovery link lands. It sits here rather than in the server
 * action module because a `"use server"` file may export nothing but async
 * functions, and both the action and the confirm route need this value.
 */
export const PASSWORD_RESET_PATH = "/reset-password"

/** Where a link that does not verify lands, with a message rather than a blank page. */
export const RECOVERY_FAILURE_PATH = "/forgot-password?error=link"

/**
 * Narrows a caller-supplied `next` parameter to a same-origin path.
 *
 * The confirm route redirects to whatever the link carries, so an unchecked
 * value is an open redirect on a URL that arrives by email and has just
 * established a session. `//evil.example` and `https://evil.example` are both
 * read as another origin by `new URL(value, base)`, and browsers fold a
 * backslash to a forward slash, so `/\evil.example` is protocol relative too.
 *
 * Anything that is not a plain absolute path falls back rather than throwing: a
 * person following a link from their inbox should land somewhere useful, not on
 * an error page.
 */
export function safeRedirectTarget(value: string | null, fallback: string): string {
  if (!value) return fallback
  if (!value.startsWith("/")) return fallback
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback
  // Whitespace and control characters hide the real target from a reader
  // skimming the URL, and a newline in a Location header is a splitting attempt.
  if (/[\u0000-\u0020\u007f]/.test(value)) return fallback
  return value
}
