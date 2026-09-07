import { ChannelError, normalized } from "@/lib/channels/errors"
import type { NormalizedError } from "@/lib/channels/errors"

/**
 * Turning Shopify's several kinds of "no" into one kind Fanwise understands.
 *
 * Rule 8: never surface a raw provider error. The creator gets a sentence they
 * can act on; the original is persisted on the publication_jobs row and is not
 * rendered anywhere.
 *
 * Shopify says no in four different registers and they do not mean the same
 * thing, which is why this is a file rather than a try/catch:
 *
 *   HTTP status      the request did not get to the resolver
 *   errors[]         GraphQL itself refused: bad query, bad token, throttled
 *   userErrors[]     the mutation ran and declined the content
 *   nothing at all   a 200 with a null payload, which is still a failure
 */

const CHANNEL = "Shopify"

/** A GraphQL error entry, as far as anything here needs to care. */
export interface ShopifyGraphQLError {
  message: string
  extensions?: { code?: string } | null
}

export interface ShopifyUserError {
  field?: string[] | null
  message: string
  code?: string | null
}

export function httpError(status: number, body: unknown): NormalizedError {
  if (status === 401) {
    return normalized(
      "credentials_invalid",
      `${CHANNEL} rejected the connection. Reconnect the store to authorize Fanwise again.`,
      body,
    )
  }
  if (status === 403) {
    return normalized(
      "permission_denied",
      `Fanwise does not have permission to manage products on this ${CHANNEL} store. Reconnect it and accept the requested permissions.`,
      body,
    )
  }
  if (status === 404) {
    return normalized(
      "not_found",
      `That ${CHANNEL} store could not be reached. Check the store is still open and that Fanwise is still installed on it.`,
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
  return normalized("unknown", `${CHANNEL} refused the request and did not say why.`, {
    status,
    body,
  })
}

/**
 * GraphQL-level errors. THROTTLED is the one worth singling out: it is a 200
 * with an error entry, so a client that only checks status treats a rate limit
 * as a successful empty response and reports a publish that never happened.
 */
export function graphqlError(errors: readonly ShopifyGraphQLError[]): NormalizedError {
  const codes = errors.map((e) => e.extensions?.code).filter(Boolean)

  if (codes.includes("THROTTLED")) {
    return normalized(
      "rate_limited",
      `${CHANNEL} is rate limiting Fanwise. This will be retried automatically.`,
      errors,
    )
  }
  if (codes.includes("ACCESS_DENIED") || codes.includes("UNAUTHORIZED")) {
    return normalized(
      "permission_denied",
      `Fanwise does not have permission to do that on this ${CHANNEL} store. Reconnect it and accept the requested permissions.`,
      errors,
    )
  }
  if (codes.includes("INTERNAL_SERVER_ERROR")) {
    return normalized(
      "provider_unavailable",
      `${CHANNEL} is not responding. This will be retried automatically.`,
      errors,
    )
  }

  return normalized("unknown", `${CHANNEL} refused the request and did not say why.`, errors)
}

/**
 * Mutation-level refusals. These are the creator's to fix, so the message names
 * the field where Shopify named one.
 *
 * The field path arrives as an array like ["input","variants","0","price"].
 * Only the last readable segment is shown: a creator recognizes "price", and
 * the full path is a description of Shopify's input shape, not of their listing.
 */
export function userErrors(errors: readonly ShopifyUserError[]): NormalizedError {
  const first = errors[0]
  const field = first?.field?.filter((part) => !/^\d+$/.test(part) && part !== "input").pop()
  const detail = first?.message?.trim().replace(/\.$/, "") ?? "it did not say why"

  return normalized(
    "validation_rejected",
    field
      ? `${CHANNEL} rejected this listing on ${field}: ${detail}.`
      : `${CHANNEL} rejected this listing: ${detail}.`,
    errors,
  )
}

export function emptyPayload(): NormalizedError {
  return normalized(
    "unknown",
    `${CHANNEL} accepted the request but returned nothing. Nothing was confirmed, so the listing has not been marked published.`,
    null,
  )
}

/** A request that never reached Shopify at all. */
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
