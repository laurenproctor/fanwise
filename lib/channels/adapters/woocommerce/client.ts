import { z } from "zod"
import { ChannelError, IN_CALL_MAX_ATTEMPTS, inCallBackoffMs } from "@/lib/channels/errors"
import { OutboundError, outboundFetch, type OutboundOptions } from "@/lib/net/outbound"
import { API_NAMESPACE } from "./config"
import {
  fail,
  httpError,
  malformed,
  refusedByBoundary,
  transportError,
  type WooErrorBody,
} from "./errors"

/**
 * The WooCommerce REST client.
 *
 * Small on purpose: signs the request with the store's key pair over HTTPS,
 * notices every shape of failure a WordPress REST API has, validates the
 * payload with Zod before anything reads it, and retries the failures worth
 * retrying. Basic auth over HTTPS is what WooCommerce documents for its own
 * keys; there is no token exchange and nothing expires.
 *
 * Every request leaves through `lib/net/outbound`, never through `fetch`.
 * The store's address is the one thing in this adapter a creator typed, and
 * the boundary is what keeps a typed address from pointing the store's keys at
 * the server's own network: it resolves the name itself, refuses anything
 * private, connects to the address it checked, follows no redirect, and gives
 * up on a slow or enormous answer. A refusal from it is final, never retried.
 */

/**
 * How long a store gets to answer.
 *
 * Longer than the boundary's default, and for a reason: creating a product
 * makes WordPress sideload every image inside the request, on whatever the
 * creator's hosting is. A tight deadline here is a product that publishes
 * without its images and a retry that creates it twice.
 */
const STORE_RESPONSE_TIMEOUT_MS = 60_000

const errorBodySchema = z.object({
  code: z.string().optional(),
  message: z.string().optional(),
  data: z
    .object({
      status: z.number().optional(),
      params: z.record(z.string(), z.string()).optional(),
      resource_id: z.number().optional(),
    })
    .nullish(),
})

export interface WooClientOptions {
  /** The store's base, `https://` and host and any path, no trailing slash. */
  storeUrl: string
  consumerKey: string
  consumerSecret: string
  /**
   * Test seam for the boundary: a scripted resolver and transport. Production
   * passes nothing and gets real DNS and the `node:https` transport.
   */
  outbound?: OutboundOptions
  /** Test seam, so the retry path does not make the suite sleep. */
  sleep?: (ms: number) => Promise<void>
}

export interface WooRequest<T> {
  method: "GET" | "POST" | "PUT"
  /** Relative to the namespace: `products`, `products/12`, `products/tags`. */
  path: string
  body?: unknown
  schema: z.ZodType<T>
}

export interface WooClient {
  request<T>(params: WooRequest<T>): Promise<T>
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** The REST root for a store, with the `rest_route` form as the documented fallback. */
export function apiUrl(storeUrl: string, path: string): string {
  return `${storeUrl}/wp-json/${API_NAMESPACE}/${path}`
}

export function createWooClient(options: WooClientOptions): WooClient {
  const { storeUrl, consumerKey, consumerSecret } = options
  const sleep = options.sleep ?? defaultSleep
  const outbound: OutboundOptions = {
    responseTimeoutMs: STORE_RESPONSE_TIMEOUT_MS,
    ...options.outbound,
  }
  // The one place the keys are used. Never logged, never in an error, never
  // returned: errors carry the response body, which is the store's, not ours.
  const authorization = `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64")}`

  return {
    async request<T>({ method, path, body, schema }: WooRequest<T>): Promise<T> {
      let lastError: ChannelError | null = null

      for (let attempt = 1; attempt <= IN_CALL_MAX_ATTEMPTS; attempt += 1) {
        let response: Response
        try {
          response = await outboundFetch(
            apiUrl(storeUrl, path),
            {
              method,
              headers: {
                Authorization: authorization,
                Accept: "application/json",
                ...(body === undefined ? {} : { "Content-Type": "application/json" }),
              },
              ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            },
            outbound,
          )
        } catch (error) {
          // A refusal is about the address, not the moment: the same address
          // will be refused on every attempt, so it is not retried.
          if (error instanceof OutboundError && !error.retryable) {
            throw new ChannelError(refusedByBoundary(error))
          }
          lastError = new ChannelError(transportError(error))
          if (attempt === IN_CALL_MAX_ATTEMPTS) throw lastError
          await sleep(inCallBackoffMs(attempt))
          continue
        }

        if (!response.ok) {
          // A WordPress error is JSON with a code; anything else, an HTML page
          // from a host or a plugin, is kept as text so the parse error does
          // not replace the store's answer.
          const text = await response.text().catch(() => "")
          let parsedBody: WooErrorBody | string | null = text.slice(0, 2000) || null
          try {
            const candidate = errorBodySchema.safeParse(JSON.parse(text))
            if (candidate.success) parsedBody = candidate.data
          } catch {
            // Not JSON. The text stands.
          }
          const error = new ChannelError(httpError(response.status, parsedBody))
          if (!error.normalized.retryable || attempt === IN_CALL_MAX_ATTEMPTS) throw error
          lastError = error
          await sleep(inCallBackoffMs(attempt))
          continue
        }

        const raw: unknown = await response.json().catch(() => null)
        // Every external API response is validated with Zod before use (rule 6).
        const parsed = schema.safeParse(raw)
        if (!parsed.success) fail(malformed(parsed.error.issues))
        return parsed.data
      }

      throw lastError ?? new ChannelError(transportError(new Error("no attempts made")))
    },
  }
}
