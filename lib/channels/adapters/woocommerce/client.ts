import { z } from "zod"
import { ChannelError } from "@/lib/channels/errors"
import { API_NAMESPACE } from "./config"
import { fail, httpError, malformed, transportError, type WooErrorBody } from "./errors"

/**
 * The WooCommerce REST client.
 *
 * Small on purpose: signs the request with the store's key pair over HTTPS,
 * notices every shape of failure a WordPress REST API has, validates the
 * payload with Zod before anything reads it, and retries the failures worth
 * retrying. Basic auth over HTTPS is what WooCommerce documents for its own
 * keys; there is no token exchange and nothing expires.
 */

const MAX_ATTEMPTS = 3

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
  /** Test seam. Production passes nothing and gets global fetch. */
  fetchImpl?: typeof fetch
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

function backoffMs(attempt: number): number {
  return Math.min(5_000, 250 * 2 ** (attempt - 1))
}

/** The REST root for a store, with the `rest_route` form as the documented fallback. */
export function apiUrl(storeUrl: string, path: string): string {
  return `${storeUrl}/wp-json/${API_NAMESPACE}/${path}`
}

export function createWooClient(options: WooClientOptions): WooClient {
  const { storeUrl, consumerKey, consumerSecret } = options
  const doFetch = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? defaultSleep
  // The one place the keys are used. Never logged, never in an error, never
  // returned: errors carry the response body, which is the store's, not ours.
  const authorization = `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64")}`

  return {
    async request<T>({ method, path, body, schema }: WooRequest<T>): Promise<T> {
      let lastError: ChannelError | null = null

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        let response: Response
        try {
          response = await doFetch(apiUrl(storeUrl, path), {
            method,
            headers: {
              Authorization: authorization,
              Accept: "application/json",
              ...(body === undefined ? {} : { "Content-Type": "application/json" }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          })
        } catch (error) {
          lastError = new ChannelError(transportError(error))
          if (attempt === MAX_ATTEMPTS) throw lastError
          await sleep(backoffMs(attempt))
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
          if (!error.normalized.retryable || attempt === MAX_ATTEMPTS) throw error
          lastError = error
          await sleep(backoffMs(attempt))
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
