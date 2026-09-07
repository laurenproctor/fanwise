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
 *
 * The two publication scopes arrived with ADR 0004, and they are a pair rather
 * than a choice. `publishablePublish` needs write access; finding which
 * publication is the Online Store needs read access first, because a
 * publication cannot be published to before it is enumerated and its id is per
 * shop. Asking for the write half alone would produce an app that is permitted
 * to publish and unable to say where.
 *
 * Adding these re-authorizes every existing connection, and Fanwise has to
 * drive that itself: Shopify's "merchants approve new scopes the next time they
 * open the app" is the managed-installation flow, and this app runs its own
 * authorization code grant. See `staleScopes` below.
 */
export const SCOPES = [
  "write_products",
  "read_products",
  "read_publications",
  "write_publications",
] as const

/**
 * The scopes a connection is missing, if any.
 *
 * `channel_connections.scopes` has been written at every authorization since A5
 * and read by nothing, which was fine while the list never changed. It changed.
 * A connection authorized before ADR 0004 holds a token that cannot publish to
 * a sales channel, and the failure that produces without this check is a 403
 * from deep inside an activate — normalized correctly, but arriving after the
 * product has already been created and the creator has already done the manual
 * file step.
 *
 * Checked before the call instead, so the ask comes with an explanation rather
 * than as the tail end of a failure.
 *
 * An empty stored list means the connection predates the column being
 * populated, not that it was granted nothing. Those are left alone: the token
 * is probably fine, and forcing a re-authorization on a guess is the more
 * expensive mistake.
 */
/**
 * Whether a granted list covers one required scope.
 *
 * Not plain membership, and assuming it was is a bug this shipped with. Shopify
 * treats `write_x` as implying `read_x` and **collapses the pair in what it
 * grants back**: authorize for `write_products,read_products` and the token
 * response says `write_products`, alone. The live connection proved it — one
 * entry in `channel_connections.scopes` for an authorization that asked for
 * two.
 *
 * A literal comparison therefore reports `read_products` missing on a
 * connection that holds it, forever. The creator reconnects, the prompt does
 * not clear, and they reconnect again. A nag that cannot be satisfied is worse
 * than no nag: it teaches people to ignore the one that matters.
 */
function holds(granted: readonly string[], required: string): boolean {
  if (granted.includes(required)) return true
  const readScope = /^read_(.+)$/.exec(required)
  return readScope !== null && granted.includes(`write_${readScope[1]}`)
}

export function staleScopes(granted: readonly string[]): string[] {
  if (granted.length === 0) return []
  return SCOPES.filter((scope) => !holds(granted, scope))
}

/** The same rule, for the shared scope comparison. See ChannelOAuth.holdsScope. */
export const holdsScope = holds

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
