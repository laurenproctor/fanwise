import { z } from "zod"
import { ChannelError } from "@/lib/channels/errors"
import { API_BASE } from "./config"
import { fail, httpError, malformed, transportError, type EtsyErrorBody } from "./errors"

/**
 * The Etsy v3 client.
 *
 * Three body shapes, because Etsy takes three: JSON for reads and for the
 * listing writes, form-encoded for the OAuth token endpoint, and multipart
 * for the two binary uploads. Every request carries the app's key header;
 * a shop-scoped request carries the shop's bearer token as well. Every
 * answer is validated with Zod before anything reads it (rule 6), and the
 * failures worth retrying are retried with bounded backoff.
 */

const MAX_ATTEMPTS = 3

const errorBodySchema = z.object({
  error: z.string().optional(),
  error_description: z.string().optional(),
})

export interface EtsyClientOptions {
  apiKey: string
  /** Absent for the public endpoints: the token exchange and the taxonomy. */
  accessToken?: string
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

export type EtsyBody =
  | { kind: "json"; value: unknown }
  | { kind: "form"; value: Record<string, string> }
  | { kind: "multipart"; value: FormData }

export interface EtsyRequest<T> {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"
  /** Relative to the v3 base: `application/shops/1/listings`. Absolute URLs pass through. */
  path: string
  body?: EtsyBody
  schema: z.ZodType<T>
}

export interface EtsyClient {
  request<T>(params: EtsyRequest<T>): Promise<T>
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function backoffMs(attempt: number, retryAfter: string | null): number {
  const hinted = retryAfter ? Number(retryAfter) : NaN
  if (Number.isFinite(hinted) && hinted > 0) return Math.min(10_000, hinted * 1000)
  return Math.min(5_000, 250 * 2 ** (attempt - 1))
}

export function createEtsyClient(options: EtsyClientOptions): EtsyClient {
  const doFetch = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? defaultSleep

  return {
    async request<T>({ method, path, body, schema }: EtsyRequest<T>): Promise<T> {
      const url = /^https?:\/\//.test(path) ? path : `${API_BASE}/${path}`
      let lastError: ChannelError | null = null

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        // The key and the token are used here and nowhere else. Never logged,
        // never in an error: errors carry the response body, which is Etsy's.
        const headers: Record<string, string> = {
          "x-api-key": options.apiKey,
          Accept: "application/json",
          ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
        }
        let payload: BodyInit | undefined
        if (body?.kind === "json") {
          headers["Content-Type"] = "application/json"
          payload = JSON.stringify(body.value)
        } else if (body?.kind === "form") {
          headers["Content-Type"] = "application/x-www-form-urlencoded"
          payload = new URLSearchParams(body.value).toString()
        } else if (body?.kind === "multipart") {
          // fetch sets the boundary itself; a hand-set Content-Type breaks it.
          payload = body.value
        }

        let response: Response
        try {
          response = await doFetch(url, { method, headers, body: payload })
        } catch (error) {
          lastError = new ChannelError(transportError(error))
          if (attempt === MAX_ATTEMPTS) throw lastError
          await sleep(backoffMs(attempt, null))
          continue
        }

        if (!response.ok) {
          const text = await response.text().catch(() => "")
          let parsedBody: EtsyErrorBody | string | null = text.slice(0, 2000) || null
          try {
            const candidate = errorBodySchema.safeParse(JSON.parse(text))
            if (candidate.success) parsedBody = candidate.data
          } catch {
            // Not JSON. The text stands.
          }
          const error = new ChannelError(httpError(response.status, parsedBody))
          if (!error.normalized.retryable || attempt === MAX_ATTEMPTS) throw error
          lastError = error
          await sleep(backoffMs(attempt, response.headers.get("retry-after")))
          continue
        }

        // A 204 has no body; the schema decides whether that is acceptable.
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
