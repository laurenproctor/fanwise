import { z } from "zod"
import { ChannelError } from "@/lib/channels/errors"
import { ADMIN_API_VERSION } from "./config"
import {
  emptyPayload,
  fail,
  graphqlError,
  httpError,
  transportError,
  type ShopifyGraphQLError,
} from "./errors"

/**
 * The GraphQL Admin API client.
 *
 * Small on purpose. It does four things: signs the request, notices every shape
 * of failure Shopify has, validates the payload with Zod before anything reads
 * it, and retries the failures that are worth retrying.
 *
 * The retry is the part that needs stating. Shopify's rate limiting is
 * cost-based and a throttled call comes back as **HTTP 200** carrying an errors
 * entry, so a client that branches on status alone treats a rate limit as a
 * successful empty response, and the caller reports a publish that never
 * happened. That is the specific bug this file exists to not have.
 */

const MAX_ATTEMPTS = 3

const graphqlErrorSchema = z.object({
  message: z.string(),
  extensions: z.object({ code: z.string().optional() }).nullish(),
})

/**
 * Shopify's cost envelope. Read for the restore rate when backing off, so the
 * wait is the provider's number rather than a guess.
 */
const throttleStatusSchema = z.object({
  maximumAvailable: z.number(),
  currentlyAvailable: z.number(),
  restoreRate: z.number(),
})

const envelopeSchema = z.object({
  data: z.unknown().nullish(),
  errors: z.array(graphqlErrorSchema).nullish(),
  extensions: z
    .object({ cost: z.object({ throttleStatus: throttleStatusSchema.nullish() }).nullish() })
    .nullish(),
})

export interface ShopifyClientOptions {
  shopDomain: string
  accessToken: string
  /** Test seam. Production passes nothing and gets global fetch. */
  fetchImpl?: typeof fetch
  /** Test seam, so the retry path does not make the suite sleep. */
  sleep?: (ms: number) => Promise<void>
}

export interface ShopifyClient {
  request<T>(params: {
    query: string
    variables: Record<string, unknown>
    schema: z.ZodType<T>
  }): Promise<T>
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * How long to wait before retrying a throttled call.
 *
 * Shopify restores points at a documented rate, so when the envelope carries
 * one the wait is computed from it. Without it, a bounded exponential backoff.
 * Capped, because a background job that sleeps for a minute is a background job
 * nobody can tell apart from a hung one.
 */
function backoffMs(attempt: number, restoreRate: number | null): number {
  if (restoreRate && restoreRate > 0) {
    return Math.min(5_000, Math.ceil((50 / restoreRate) * 1000))
  }
  return Math.min(5_000, 250 * 2 ** (attempt - 1))
}

export function createShopifyClient(options: ShopifyClientOptions): ShopifyClient {
  const { shopDomain, accessToken } = options
  const doFetch = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? defaultSleep
  const endpoint = `https://${shopDomain}/admin/api/${ADMIN_API_VERSION}/graphql.json`

  return {
    async request<T>({
      query,
      variables,
      schema,
    }: {
      query: string
      variables: Record<string, unknown>
      schema: z.ZodType<T>
    }): Promise<T> {
      let lastError: ChannelError | null = null

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        let response: Response
        try {
          response = await doFetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              // The one place the token is used. It is never logged, never put
              // in an error, and never returned: errors here carry the response
              // body, and the body is Shopify's, not ours.
              "X-Shopify-Access-Token": accessToken,
              Accept: "application/json",
            },
            body: JSON.stringify({ query, variables }),
          })
        } catch (error) {
          lastError = new ChannelError(transportError(error))
          if (attempt === MAX_ATTEMPTS) throw lastError
          await sleep(backoffMs(attempt, null))
          continue
        }

        // A non-2xx never carries a usable payload, so it is read as text: a
        // JSON.parse on an HTML error page would replace Shopify's answer with
        // a parse error, and the parse error is not the problem.
        if (!response.ok) {
          const body = await response.text().catch(() => "")
          const error = new ChannelError(httpError(response.status, body.slice(0, 2000)))
          if (!error.normalized.retryable || attempt === MAX_ATTEMPTS) throw error
          lastError = error
          await sleep(backoffMs(attempt, null))
          continue
        }

        const raw: unknown = await response.json().catch(() => null)
        const envelope = envelopeSchema.safeParse(raw)
        if (!envelope.success) fail(emptyPayload())

        if (envelope.data.errors && envelope.data.errors.length > 0) {
          const error = new ChannelError(
            graphqlError(envelope.data.errors as ShopifyGraphQLError[]),
          )
          if (!error.normalized.retryable || attempt === MAX_ATTEMPTS) throw error
          lastError = error
          await sleep(
            backoffMs(attempt, envelope.data.extensions?.cost?.throttleStatus?.restoreRate ?? null),
          )
          continue
        }

        if (envelope.data.data === null || envelope.data.data === undefined) {
          fail(emptyPayload())
        }

        // Every external API response is validated with Zod before use (rule 6).
        // A shape Shopify changed under us is a normalized failure here rather
        // than an undefined three lines into the caller.
        const parsed = schema.safeParse(envelope.data.data)
        if (!parsed.success) {
          fail({
            code: "unknown",
            message:
              "Shopify answered in a shape Fanwise does not recognize. Nothing was confirmed, so the listing has not been marked published.",
            retryable: false,
            raw: { issues: parsed.error.issues },
          })
        }

        return parsed.data
      }

      throw lastError ?? new ChannelError(emptyPayload())
    },
  }
}
