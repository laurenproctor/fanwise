/**
 * Normalized channel errors.
 *
 * Rule 8: do not surface raw provider errors. Normalize to a user-readable
 * message, persist the original. This file is the shared vocabulary; each
 * adapter owns the mapping from its provider's noise into it, because only the
 * adapter knows what a given status code means on that platform.
 *
 * The `retryable` flag is the part that earns its keep. Publishing runs in a
 * background job, and a job that cannot tell "the shop is briefly down" from
 * "you asked for a scope you were not granted" either retries something that
 * will never succeed or gives up on something that would have.
 */

export const NORMALIZED_ERROR_CODES = [
  /** The stored credential is missing, malformed, or the provider rejected it. */
  "credentials_invalid",
  /** The credential is valid but does not carry the permission this call needs. */
  "permission_denied",
  /** Rate limited or throttled. Always retryable. */
  "rate_limited",
  /** The provider understood the request and refused the content. */
  "validation_rejected",
  /** The external object named by an id is gone. */
  "not_found",
  /** The provider is down or erroring. Retryable. */
  "provider_unavailable",
  /** The request never reached the provider. Retryable. */
  "network",
  /** Anything that did not match. Never retried, always persisted. */
  "unknown",
] as const

export type NormalizedErrorCode = (typeof NORMALIZED_ERROR_CODES)[number]

const RETRYABLE = new Set<NormalizedErrorCode>(["rate_limited", "provider_unavailable", "network"])

export function isRetryable(code: NormalizedErrorCode): boolean {
  return RETRYABLE.has(code)
}

export interface NormalizedError {
  code: NormalizedErrorCode
  /**
   * Shown to a creator. Written in their terms and in the second person, names
   * the channel by its display name, and never contains a stack, a status code,
   * a URL or a token.
   */
  message: string
  retryable: boolean
  /**
   * The provider's own words, persisted to publication_jobs.provider_response
   * so the original is recoverable. Never rendered.
   */
  raw: unknown
}

/**
 * A failure with a normalization already attached.
 *
 * Adapters throw this; the publish runner catches it and writes both halves,
 * the readable message to the listing and the raw payload to the job row.
 * Anything else that escapes an adapter is normalized as `unknown`, which is
 * the honest answer for an error nobody anticipated.
 */
export class ChannelError extends Error {
  readonly normalized: NormalizedError

  constructor(normalized: NormalizedError) {
    super(normalized.message)
    this.name = "ChannelError"
    this.normalized = normalized
  }
}

export function normalized(
  code: NormalizedErrorCode,
  message: string,
  raw: unknown = null,
): NormalizedError {
  return { code, message, retryable: isRetryable(code), raw }
}

/**
 * The fallback for anything that reaches the runner un-normalized.
 *
 * `raw` deliberately keeps only the message and name. An arbitrary thrown value
 * can hold a request object, and a request object can hold an Authorization
 * header, which would then be written to a database column and read by whoever
 * debugs the failure. Persisting the original is a rule about provider
 * responses, not about everything that was in scope when something threw.
 */
export function normalizeUnknown(error: unknown, channelName: string): NormalizedError {
  if (error instanceof ChannelError) return error.normalized

  const raw =
    error instanceof Error ? { name: error.name, message: error.message } : { value: String(error) }

  return normalized(
    "unknown",
    `${channelName} could not complete that. Nothing was changed on the channel, and the error has been recorded.`,
    raw,
  )
}
