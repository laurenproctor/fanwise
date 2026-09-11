import { ChannelError, normalized } from "@/lib/channels/errors"
import type { NormalizedError } from "@/lib/channels/errors"
import type { OutboundError } from "@/lib/net/outbound"

/**
 * WooCommerce's ways of saying no, into the one vocabulary Fanwise has.
 *
 * Rule 8: the creator gets a sentence they can act on, the original is
 * persisted on the job row and rendered nowhere. WooCommerce is a WordPress
 * REST API, so a refusal is an HTTP status carrying `{ code, message, data }`
 * where `code` is a machine name and `data.status` repeats the status. Both
 * are read, because the status says how bad and the code says what.
 */

const CHANNEL = "WooCommerce"

export interface WooErrorBody {
  code?: string
  message?: string
  data?: { status?: number; params?: Record<string, string>; resource_id?: number } | null
}

export function httpError(status: number, body: WooErrorBody | string | null): NormalizedError {
  const code = typeof body === "object" && body ? body.code : undefined

  if (status === 401) {
    return normalized(
      "credentials_invalid",
      `${CHANNEL} rejected the connection's keys. Reconnect the store to issue new ones.`,
      body,
    )
  }
  if (status === 403) {
    return normalized(
      "permission_denied",
      `Fanwise does not have permission to manage products on this ${CHANNEL} store. Reconnect it and approve read and write access.`,
      body,
    )
  }
  if (status === 404) {
    // A missing REST route is a store without pretty permalinks or without
    // WooCommerce at all, which is a different problem from a missing product.
    // The product case is raised by name in the client, from a read of a
    // specific id, and never inferred here.
    if (code === "rest_no_route") {
      return normalized(
        "not_found",
        `That ${CHANNEL} store's API could not be reached. Check that WooCommerce is active and that the store uses pretty permalinks.`,
        body,
      )
    }
    return normalized("not_found", `That ${CHANNEL} store could not be reached.`, body)
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
  if (status === 400 && typeof body === "object" && body) {
    const params = body.data?.params ? Object.keys(body.data.params) : []
    const field = params[0]
    const detail = body.message?.trim().replace(/\.$/, "") ?? "it did not say why"
    return normalized(
      "validation_rejected",
      field
        ? `${CHANNEL} rejected this listing on ${field}: ${detail}.`
        : `${CHANNEL} rejected this listing: ${detail}.`,
      body,
    )
  }
  return normalized("unknown", `${CHANNEL} refused the request and did not say why.`, {
    status,
    body,
  })
}

/** The provider was asked about a product by id and said there is none. */
export function productMissing(body: unknown): NormalizedError {
  return normalized(
    "external_object_missing",
    `This product no longer exists in ${CHANNEL}. It looks like it was deleted there, ` +
      "so Fanwise has marked the listing as not published. Publish it again to create a new one.",
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

/** A request that never reached the store at all. */
export function transportError(error: unknown): NormalizedError {
  return normalized(
    "network",
    `Fanwise could not reach ${CHANNEL}. This will be retried automatically.`,
    error instanceof Error
      ? {
          name: error.name,
          message: error.message,
          ...("kind" in error ? { kind: error.kind } : {}),
        }
      : { value: String(error) },
  )
}

/**
 * The outbound boundary would not send the request, or would not accept the
 * answer. None of these is the store's fault in the moment, so none is
 * retried, and none of them repeats an address or a header: the boundary's
 * own message names the host and the kind and nothing else.
 */
export function refusedByBoundary(error: OutboundError): NormalizedError {
  const raw = { name: error.name, kind: error.kind, message: error.message }
  switch (error.kind) {
    case "redirect":
      return normalized(
        "unknown",
        `That ${CHANNEL} store sends requests on to a different address. Reconnect it using the address it sends them to.`,
        raw,
      )
    case "body_too_large":
      return normalized(
        "unknown",
        `${CHANNEL} answered with more data than Fanwise accepts. Nothing was confirmed, so the listing has not been marked published.`,
        raw,
      )
    default:
      return normalized(
        "unknown",
        `That ${CHANNEL} store's address does not point at a public https site, so Fanwise will not send its keys there. Reconnect the store using its public address.`,
        raw,
      )
  }
}

export function fail(error: NormalizedError): never {
  throw new ChannelError(error)
}
