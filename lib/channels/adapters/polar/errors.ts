import { ChannelError, normalized } from "@/lib/channels/errors"
import type { NormalizedError } from "@/lib/channels/errors"

/**
 * Polar's ways of saying no, into the one vocabulary Fanwise has.
 *
 * Rule 8: the creator gets a sentence they can act on, the original is
 * persisted on the job row and rendered nowhere. Polar is a plain HTTP API:
 * the status carries the meaning, and a 422 carries a list of field errors
 * in FastAPI's shape, `{ detail: [{ loc, msg, type }] }`, of which the first
 * `msg` is the one worth showing. docs/channels/polar.md §11.
 */

const CHANNEL = "Polar"

export interface PolarErrorBody {
  error?: string
  error_description?: string
  detail?: string | { loc?: unknown[]; msg?: string; type?: string }[]
}

function firstDetail(body: PolarErrorBody | string | null): string {
  if (!body || typeof body === "string") return ""
  if (typeof body.detail === "string") return body.detail
  if (Array.isArray(body.detail)) {
    const first = body.detail.find((d) => typeof d?.msg === "string")
    if (!first?.msg) return ""
    const path = Array.isArray(first.loc)
      ? first.loc.filter((p) => typeof p === "string" && p !== "body").join(".")
      : ""
    return path ? `${path}: ${first.msg}` : first.msg
  }
  return body.error_description ?? ""
}

export function httpError(status: number, body: PolarErrorBody | string | null): NormalizedError {
  if (status === 401) {
    return normalized(
      "credentials_invalid",
      `${CHANNEL} rejected the connection. Reconnect the account to authorize Fanwise again.`,
      body,
    )
  }
  if (status === 403) {
    return normalized(
      "permission_denied",
      `Fanwise does not have permission to manage products on this ${CHANNEL} organization. Reconnect it and accept the requested permissions.`,
      body,
    )
  }
  if (status === 404) {
    return normalized(
      "not_found",
      `That ${CHANNEL} organization or product could not be reached.`,
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
  if (status === 422 || status === 400) {
    const detail = firstDetail(body).trim().replace(/\.$/, "")
    if (detail.length > 0) {
      return normalized("validation_rejected", `${CHANNEL} rejected this: ${detail}.`, body)
    }
    return normalized("validation_rejected", `${CHANNEL} rejected this and did not say why.`, body)
  }
  return normalized("unknown", `${CHANNEL} refused the request and did not say why.`, {
    status,
    body,
  })
}

/** The provider was asked about a product by id and said there is none. */
export function productMissing(raw: unknown): NormalizedError {
  return normalized(
    "external_object_missing",
    `This product no longer exists on ${CHANNEL}. It looks like it was deleted there, ` +
      "so Fanwise has marked it as not published. Publish it again to create a new one.",
    raw,
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
