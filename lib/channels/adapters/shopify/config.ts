import { z } from "zod"

/**
 * Shopify app configuration.
 *
 * These variables are parsed here, in the adapter, rather than in lib/env.ts.
 * Two reasons, and the second is the one that decided it:
 *
 *   1. Architecture invariant 2: no provider name in shared utils. lib/env.ts is
 *      imported by everything, and a SHOPIFY_ field on the global env schema is
 *      a provider name in the one module that is genuinely everywhere.
 *   2. They cannot be required at boot. lib/env.ts fails fast so a
 *      misconfiguration surfaces at start rather than at the first request, but
 *      an app with no Shopify credentials is a perfectly valid app: every step
 *      before A5, every CI run, and every local checkout is one. Making them
 *      required would break all three; making them optional in a schema that
 *      exists to be strict would weaken it for everything else.
 *
 * So they are parsed lazily, on the first call that genuinely needs them, and
 * the failure lands on the creator who just clicked Connect rather than on the
 * whole application.
 */

const schema = z.object({
  clientId: z.string().min(1, "SHOPIFY_CLIENT_ID is not set"),
  clientSecret: z.string().min(1, "SHOPIFY_CLIENT_SECRET is not set"),
})

export type ShopifyConfig = z.infer<typeof schema>

/**
 * The Admin API version this adapter is written against.
 *
 * Pinned, never "latest". Shopify ships a new version quarterly and drops
 * support after a year; an unpinned client changes behaviour on Shopify's
 * schedule rather than on ours, which is how a working publish becomes a
 * mystery on a Tuesday. Upgrading is a deliberate edit here plus a re-read of
 * docs/channels/shopify.md section 13.
 */
export const ADMIN_API_VERSION = "2026-07"

/**
 * Only what publishing needs.
 *
 * read_orders arrives at B5 with transaction ingestion, and adding it will
 * force every connected creator to re-authorize. That is correct: the ask
 * changed, so the creator should be asked again. Requesting it now to avoid the
 * re-prompt would mean holding order-reading permission on a creator's shop for
 * two gates before there is any code that reads an order.
 */
export const SCOPES = ["write_products", "read_products"] as const

let cached: ShopifyConfig | null = null

export function shopifyConfig(): ShopifyConfig {
  if (cached) return cached
  const parsed = schema.safeParse({
    clientId: process.env.SHOPIFY_CLIENT_ID,
    clientSecret: process.env.SHOPIFY_CLIENT_SECRET,
  })
  if (!parsed.success) {
    throw new Error(
      "Shopify is not configured on this deployment:\n" +
        parsed.error.issues.map((i) => `  ${i.message}`).join("\n"),
    )
  }
  cached = parsed.data
  return cached
}

/** True when this deployment can run a Shopify authorization at all. */
export function isConfigured(): boolean {
  return Boolean(process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET)
}

/** Test seam. Never call from application code. */
export function resetConfigCacheForTests(): void {
  cached = null
}
