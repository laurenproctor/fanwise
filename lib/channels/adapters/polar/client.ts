import { z } from "zod"
import { ChannelError, IN_CALL_MAX_ATTEMPTS, inCallBackoffMs } from "@/lib/channels/errors"
import { API_VERSION, apiBase } from "./config"
import { fail, httpError, malformed, transportError, type PolarErrorBody } from "./errors"

/**
 * The Polar client.
 *
 * Two body shapes: JSON for the product, file and benefit writes, and
 * form-encoded for the OAuth endpoints. Every authenticated request carries
 * the seller's bearer token and the pinned `Polar-Version`, and every answer
 * is validated with Zod before anything reads it (rule 6).
 *
 * A 404 on a read by id is the one status a caller may want to see rather
 * than have normalized: an update reads the product first, and "there is no
 * such product" is the signal the runner acts on. `notFound` opts in per
 * request; every other 404 is normalized here.
 */

const errorBodySchema = z.object({
  error: z.string().optional(),
  error_description: z.string().optional(),
  detail: z
    .union([
      z.string(),
      z.array(
        z.object({
          loc: z.array(z.unknown()).optional(),
          msg: z.string().optional(),
          type: z.string().optional(),
        }),
      ),
    ])
    .optional(),
})

export interface PolarClientOptions {
  accessToken?: string
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

export type PolarBody =
  { kind: "json"; value: unknown } | { kind: "form"; value: Record<string, string> }

export interface PolarRequest<T> {
  method: "GET" | "POST" | "PATCH" | "DELETE"
  /** Relative to the v1 base: `products/abc`. Absolute URLs pass through. */
  path: string
  body?: PolarBody
  schema: z.ZodType<T>
  /** True when a 404 should surface as `PolarNotFound` rather than be normalized. */
  notFound?: boolean
}

export class PolarNotFound extends Error {
  constructor(readonly raw: unknown) {
    super("not found")
    this.name = "PolarNotFound"
  }
}

export interface PolarClient {
  request<T>(params: PolarRequest<T>): Promise<T>
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Polar's own answer to "how long should I wait", in milliseconds, believed
 * up to a minute. Its limit is 500 requests a minute per organization or
 * OAuth client, and the window is the minute.
 */
function retryAfterMs(retryAfter: string | null): number | null {
  const hinted = retryAfter ? Number(retryAfter) : NaN
  if (!Number.isFinite(hinted) || hinted <= 0) return null
  return Math.min(60_000, hinted * 1000)
}

export function createPolarClient(options: PolarClientOptions = {}): PolarClient {
  const doFetch = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? defaultSleep

  return {
    async request<T>({ method, path, body, schema, notFound }: PolarRequest<T>): Promise<T> {
      const url = /^https?:\/\//.test(path) ? path : `${apiBase()}/${path}`
      let lastError: ChannelError | null = null

      for (let attempt = 1; attempt <= IN_CALL_MAX_ATTEMPTS; attempt += 1) {
        // The token is used here and nowhere else. Never logged, never in an
        // error: errors carry the response body, which is Polar's.
        const headers: Record<string, string> = {
          Accept: "application/json",
          "Polar-Version": API_VERSION,
          ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
        }
        let payload: BodyInit | undefined
        if (body?.kind === "json") {
          headers["Content-Type"] = "application/json"
          payload = JSON.stringify(body.value)
        } else if (body?.kind === "form") {
          headers["Content-Type"] = "application/x-www-form-urlencoded"
          payload = new URLSearchParams(body.value).toString()
        }

        let response: Response
        try {
          response = await doFetch(url, { method, headers, body: payload })
        } catch (error) {
          lastError = new ChannelError(transportError(error))
          if (attempt === IN_CALL_MAX_ATTEMPTS) throw lastError
          await sleep(inCallBackoffMs(attempt))
          continue
        }

        if (!response.ok) {
          const text = await response.text().catch(() => "")
          let parsedBody: PolarErrorBody | string | null = text.slice(0, 2000) || null
          try {
            const candidate = errorBodySchema.safeParse(JSON.parse(text))
            if (candidate.success) parsedBody = candidate.data
          } catch {
            // Not JSON. The text stands.
          }
          if (response.status === 404 && notFound) throw new PolarNotFound(parsedBody)
          const error = new ChannelError(httpError(response.status, parsedBody))
          if (!error.normalized.retryable || attempt === IN_CALL_MAX_ATTEMPTS) throw error
          lastError = error
          await sleep(inCallBackoffMs(attempt, retryAfterMs(response.headers.get("retry-after"))))
          continue
        }

        const raw: unknown =
          response.status === 204 ? null : await response.json().catch(() => null)
        const parsed = schema.safeParse(raw)
        if (!parsed.success) fail(malformed(parsed.error.issues))
        return parsed.data
      }

      throw lastError ?? new ChannelError(transportError(new Error("no attempts made")))
    },
  }
}
