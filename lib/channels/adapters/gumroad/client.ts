import { z } from "zod"
import { ChannelError, IN_CALL_MAX_ATTEMPTS, inCallBackoffMs } from "@/lib/channels/errors"
import { API_BASE } from "./config"
import {
  fail,
  httpError,
  malformed,
  refusal,
  transportError,
  type GumroadErrorBody,
} from "./errors"

/**
 * The Gumroad v2 client.
 *
 * Two body shapes: JSON for the product writes and form-encoded for the OAuth
 * endpoints, which is what Doorkeeper expects. Every authenticated request
 * carries the seller's bearer token. Every answer is validated with Zod before
 * anything reads it (rule 6).
 *
 * The one thing that makes this client different from Etsy's is that Gumroad
 * answers most refusals with HTTP 200 and `{ success: false, message }`. So a
 * 200 is not success here: the body is read first, and only a body that says
 * `success: true` reaches the caller's schema. A client that trusted the
 * status would record a refused create as a published product.
 */

const errorBodySchema = z.object({
  status: z.number().optional(),
  error: z.string().optional(),
  message: z.string().optional(),
})

const envelopeSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
})

export interface GumroadClientOptions {
  accessToken?: string
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

export type GumroadBody =
  { kind: "json"; value: unknown } | { kind: "form"; value: Record<string, string> }

export interface GumroadRequest<T> {
  method: "GET" | "POST" | "PUT" | "DELETE"
  /** Relative to the v2 base: `products/abc`. Absolute URLs pass through. */
  path: string
  body?: GumroadBody
  /**
   * The shape of a successful body. The envelope's `success` is checked before
   * this runs, so a schema never has to say `success: z.literal(true)`.
   */
  schema: z.ZodType<T>
  /**
   * Refusals the caller wants to see rather than have normalized, keyed by the
   * sentence Gumroad uses. A read by id answers "The product was not found."
   * as `success: false`, and the adapter turns exactly that into the one code
   * the runner acts on; every other refusal is normalized here.
   */
  refusals?: readonly string[]
  /**
   * False for the one request that creates an object: a transport failure on
   * it is not retried inside the call, because the request may have landed
   * and a repeat would create twice (ADR 0005). Every other request is
   * repeatable and retried on the shared curve.
   */
  idempotent?: boolean
}

export class GumroadRefusal extends Error {
  constructor(
    readonly text: string,
    readonly raw: unknown,
  ) {
    super(text)
    this.name = "GumroadRefusal"
  }
}

export interface GumroadClient {
  request<T>(params: GumroadRequest<T>): Promise<T>
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Gumroad's own answer to "how long should I wait", in milliseconds.
 *
 * Believed up to a minute. The create limit is shared by every workspace, so
 * waiting exactly as long as it asks is cheaper for every tenant than asking
 * again sooner, and a minute is the window the limit is measured over.
 */
function retryAfterMs(retryAfter: string | null): number | null {
  const hinted = retryAfter ? Number(retryAfter) : NaN
  if (!Number.isFinite(hinted) || hinted <= 0) return null
  return Math.min(60_000, hinted * 1000)
}

export function createGumroadClient(options: GumroadClientOptions = {}): GumroadClient {
  const doFetch = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? defaultSleep

  return {
    async request<T>({
      method,
      path,
      body,
      schema,
      refusals,
      idempotent = true,
    }: GumroadRequest<T>): Promise<T> {
      const url = /^https?:\/\//.test(path) ? path : `${API_BASE}/${path}`
      let lastError: ChannelError | null = null
      const attempts = idempotent ? IN_CALL_MAX_ATTEMPTS : 1

      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        // The token is used here and nowhere else. Never logged, never in an
        // error: errors carry the response body, which is Gumroad's.
        const headers: Record<string, string> = {
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
        }

        let response: Response
        try {
          response = await doFetch(url, { method, headers, body: payload })
        } catch (error) {
          lastError = new ChannelError(transportError(error))
          if (attempt === attempts) throw lastError
          await sleep(inCallBackoffMs(attempt))
          continue
        }

        if (!response.ok) {
          const text = await response.text().catch(() => "")
          let parsedBody: GumroadErrorBody | string | null = text.slice(0, 2000) || null
          try {
            const candidate = errorBodySchema.safeParse(JSON.parse(text))
            if (candidate.success) parsedBody = candidate.data
          } catch {
            // Not JSON. The text stands.
          }
          const error = new ChannelError(httpError(response.status, parsedBody))
          if (!error.normalized.retryable || attempt === attempts) throw error
          lastError = error
          await sleep(inCallBackoffMs(attempt, retryAfterMs(response.headers.get("retry-after"))))
          continue
        }

        const raw: unknown =
          response.status === 204 ? null : await response.json().catch(() => null)

        // The envelope first. A 200 that says no is a refusal, not a result.
        const envelope = envelopeSchema.safeParse(raw)
        if (envelope.success && !envelope.data.success) {
          const message = envelope.data.message ?? ""
          if (refusals?.some((sentence) => message.includes(sentence))) {
            throw new GumroadRefusal(message, raw)
          }
          fail(refusal(message, raw))
        }

        const parsed = schema.safeParse(raw)
        if (!parsed.success) fail(malformed(parsed.error.issues))
        return parsed.data
      }

      throw lastError ?? new ChannelError(transportError(new Error("no attempts made")))
    },
  }
}
