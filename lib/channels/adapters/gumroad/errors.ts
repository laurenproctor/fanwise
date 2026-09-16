import { ChannelError, normalized } from "@/lib/channels/errors"
import type { NormalizedError } from "@/lib/channels/errors"

/**
 * Gumroad's ways of saying no, into the one vocabulary Fanwise has.
 *
 * Rule 8: the creator gets a sentence they can act on, the original is
 * persisted on the job row and rendered nowhere. Gumroad is unusual in that
 * most refusals arrive as HTTP 200 with `{ success: false, message }`, so the
 * client decides success from the body and hands the sentence here; only a
 * few failures carry a status worth reading. docs/channels/gumroad.md §11.
 */

const CHANNEL = "Gumroad"

export interface GumroadErrorBody {
  status?: number
  error?: string
  message?: string
}

export function httpError(status: number, body: GumroadErrorBody | string | null): NormalizedError {
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
      `Fanwise does not have permission to manage products on this ${CHANNEL} account. Reconnect it and accept the requested permissions.`,
      body,
    )
  }
  if (status === 404) {
    return normalized("not_found", `That ${CHANNEL} account or product could not be reached.`, body)
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
    const detail = (body.error ?? body.message ?? "").trim().replace(/\.$/, "")
    if (detail.length > 0) {
      return normalized("validation_rejected", `${CHANNEL} rejected this: ${detail}.`, body)
    }
  }
  return normalized("unknown", `${CHANNEL} refused the request and did not say why.`, {
    status,
    body,
  })
}

/**
 * A 200 whose body says no. Gumroad's sentence is written for a developer, so
 * the few that a creator can act on are translated and the rest are passed
 * through with the channel named, which is still better than a status code.
 */
export function refusal(message: string | undefined, raw: unknown): NormalizedError {
  const text = (message ?? "").trim()
  const lower = text.toLowerCase()

  if (lower.includes("already used by another one of your products")) {
    return normalized(
      "validation_rejected",
      `${CHANNEL} already has one of your products at this address. Change the product's slug in Fanwise, or remove the older product on ${CHANNEL}, and publish again.`,
      raw,
    )
  }
  if (lower.includes("confirm your email")) {
    return normalized(
      "validation_rejected",
      `${CHANNEL} will not put a product on sale until the account's email address is confirmed. Confirm it on ${CHANNEL} and publish again.`,
      raw,
    )
  }
  if (lower.includes("payout")) {
    return normalized(
      "validation_rejected",
      `${CHANNEL} will not put a product on sale until the account has a payout method. Add one on ${CHANNEL} and publish again.`,
      raw,
    )
  }
  if (lower.includes("not a supported currency")) {
    return normalized(
      "validation_rejected",
      `${CHANNEL} does not sell in this listing's currency. Choose one of the currencies ${CHANNEL} supports.`,
      raw,
    )
  }
  if (text.length === 0) {
    return normalized("unknown", `${CHANNEL} refused the request and did not say why.`, raw)
  }
  return normalized(
    "validation_rejected",
    `${CHANNEL} rejected this: ${text.replace(/\.$/, "")}.`,
    raw,
  )
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

/** The exact sentence Gumroad uses for a missing product, read by id. */
export const PRODUCT_NOT_FOUND = "The product was not found."

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
