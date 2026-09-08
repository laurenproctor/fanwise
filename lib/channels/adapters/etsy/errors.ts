import { ChannelError, normalized } from "@/lib/channels/errors"
import type { NormalizedError } from "@/lib/channels/errors"

/**
 * Etsy's ways of saying no, into the one vocabulary Fanwise has.
 *
 * Rule 8: the creator gets a sentence they can act on, the original is
 * persisted on the job row and rendered nowhere. Etsy v3 answers a refusal
 * with an HTTP status and a JSON body whose `error` is a sentence for
 * developers; the status decides the code and the sentence is kept raw.
 */

const CHANNEL = "Etsy"

export interface EtsyErrorBody {
  error?: string
  error_description?: string
}

export function httpError(status: number, body: EtsyErrorBody | string | null): NormalizedError {
  if (status === 401) {
    return normalized(
      "credentials_invalid",
      `${CHANNEL} rejected the connection. Reconnect the shop to authorize Fanwise again.`,
      body,
    )
  }
  if (status === 403) {
    return normalized(
      "permission_denied",
      `Fanwise does not have permission to manage listings on this ${CHANNEL} shop. Reconnect it and accept the requested permissions.`,
      body,
    )
  }
  if (status === 404) {
    return normalized("not_found", `That ${CHANNEL} shop or listing could not be reached.`, body)
  }
  if (status === 409) {
    return normalized(
      "validation_rejected",
      `${CHANNEL} refused the change because the listing is not in a state that allows it.`,
      body,
    )
  }
  if (status === 429) {
    return normalized(
      "rate_limited",
      `${CHANNEL} is rate limiting Fanwise. This will be retried automatically.`,
      body,
    )
  }
  if (status >= 500) {
    return normalized(
      "provider_unavailable",
      `${CHANNEL} is not responding. This will be retried automatically.`,
      body,
    )
  }
  if (status === 400 && typeof body === "object" && body?.error) {
    const detail = body.error.trim().replace(/\.$/, "")
    return normalized("validation_rejected", `${CHANNEL} rejected this listing: ${detail}.`, body)
  }
  return normalized("unknown", `${CHANNEL} refused the request and did not say why.`, {
    status,
    body,
  })
}

/** The provider was asked about a listing by id and said there is none. */
export function listingMissing(body: unknown): NormalizedError {
  return normalized(
    "external_object_missing",
    `This listing no longer exists on ${CHANNEL}. It looks like it was deleted there, ` +
      "so Fanwise has marked it as not published. Publish it again to create a new one.",
    body,
  )
}

export function malformed(issues: unknown): NormalizedError {
  return normalized(
    "unknown",
    `${CHANNEL} answered in a shape Fanwise does not recognize. Nothing was confirmed, so the listing has not been marked published.`,
    { issues },
  )
}

export function transportError(error: unknown): NormalizedError {
  return normalized(
    "network",
    `Fanwise could not reach ${CHANNEL}. This will be retried automatically.`,
    error instanceof Error
      ? { name: error.name, message: error.message }
      : { value: String(error) },
  )
}

export function fail(error: NormalizedError): never {
  throw new ChannelError(error)
}
