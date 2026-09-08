import { z } from "zod"
import { ChannelError, normalized } from "@/lib/channels/errors"
import type {
  ChannelGrant,
  ChannelOAuth,
  OAuthAuthorizeRequest,
  OAuthGrant,
} from "@/lib/channels/types"
import { createWooClient } from "./client"
import { APP_NAME, SCOPES } from "./config"
import { parseStoreUrl, storeBase } from "./transform"

/**
 * WooCommerce authorization.
 *
 * Not OAuth, though it rhymes with it. Fanwise sends the creator to their own
 * store's `/wc-auth/v1/authorize` with an app name, a scope, a reference, a
 * return URL and a callback URL. The store shows an approval screen, mints a
 * consumer key and secret, POSTs them as JSON to the callback URL, and sends
 * the creator back to the return URL with `success=1` or `success=0`.
 *
 * Two consequences shape this file. Nothing secret reaches the browser, so
 * the return carries no signature to verify and the browser's callback is a
 * report rather than a completion; the connection is made from the POST, in
 * the generic grant route. And the state Fanwise minted travels as `user_id`,
 * which is the only thing tying the POST to the person who started it, so a
 * POST with an unknown or spent state is refused before its keys are read.
 *
 * The keys are proven before they are stored: one call to the store the
 * creator named, with the keys the store posted. A key pair that does not
 * work against that store is refused, whatever state it arrived with.
 */

const grantBodySchema = z.object({
  key_id: z.union([z.number(), z.string()]).optional(),
  user_id: z.string().min(16).max(128),
  consumer_key: z.string().min(1),
  consumer_secret: z.string().min(1),
  key_permissions: z.enum(["read", "write", "read_write"]),
})

/** The store's general settings, of which one entry is the currency. */
const settingsSchema = z.array(
  z.object({
    id: z.string(),
    value: z.unknown(),
  }),
)

/** The WordPress REST index, which is where the site's name lives. */
const siteIndexSchema = z.object({
  name: z.string().optional(),
  url: z.string().optional(),
})

export const woocommerceGrant: ChannelGrant = {
  parse(body: unknown) {
    const parsed = grantBodySchema.safeParse(body)
    if (!parsed.success) return null
    return {
      state: parsed.data.user_id,
      credentials: {
        consumerKey: parsed.data.consumer_key,
        consumerSecret: parsed.data.consumer_secret,
      },
      scopes: [parsed.data.key_permissions],
    }
  },

  async verify({ accountHint, credentials, scopes }): Promise<OAuthGrant> {
    const store = parseStoreUrl(accountHint)
    if (!store.ok) {
      throw new ChannelError(
        normalized("unknown", "That connection was started against an address Fanwise cannot use."),
      )
    }
    const parsedCredentials = woocommerceCredentialsSchema.safeParse(credentials)
    if (!parsedCredentials.success) {
      throw new ChannelError(
        normalized("credentials_invalid", "The store sent keys Fanwise could not read. Try again."),
      )
    }

    // Read and write are both needed: publishing writes, and every write here
    // reads first. A creator who chose read-only on the approval screen has
    // not connected a store Fanwise can publish to, and is told so now rather
    // than at the first publish.
    if (!scopes.includes("read_write")) {
      throw new ChannelError(
        normalized(
          "permission_denied",
          "The store granted read-only access. Connect again and choose read and write.",
        ),
      )
    }

    const client = createWooClient({
      storeUrl: storeBase(store.value),
      consumerKey: parsedCredentials.data.consumerKey,
      consumerSecret: parsedCredentials.data.consumerSecret,
    })

    // The proof, and the one read the connection needs: the store's currency,
    // which listings are checked against. A key pair the store did not issue
    // for this address fails here with a 401 and never reaches a row.
    const settings = await client.request({
      method: "GET",
      path: "settings/general",
      schema: settingsSchema,
    })
    const currency = settings.find((s) => s.id === "woocommerce_currency")?.value
    const site = await client.request({ method: "GET", path: "../../", schema: siteIndexSchema })

    return {
      externalAccountId: store.value,
      externalAccountName: site.name?.trim() || store.value,
      scopes,
      // Keys do not expire.
      expiresAt: null,
      credentials: parsedCredentials.data,
      metadata: {
        ...(typeof currency === "string" && currency.length > 0
          ? { currency: currency.toUpperCase() }
          : {}),
      },
    }
  },
}

export const woocommerceOAuth: ChannelOAuth = {
  scopes: SCOPES,
  accountHintLabel: "Your store's address",
  accountHintPlaceholder: "shop.example.com",

  parseAccountHint: parseStoreUrl,
  grant: woocommerceGrant,

  authorizeUrl({ state, accountHint, redirectUri, grantUri }: OAuthAuthorizeRequest): string {
    const store = parseStoreUrl(accountHint)
    // Unreachable through the sanctioned path, which parses before it stores.
    if (!store.ok)
      throw new Error("refusing to build an authorize URL for an invalid store address")

    // The state rides in return_url as well as in user_id, so the browser's
    // return can be matched to a row without trusting the store to echo it.
    const returnUrl = new URL(redirectUri)
    returnUrl.searchParams.set("state", state)

    const url = new URL(`${storeBase(store.value)}/wc-auth/v1/authorize`)
    url.searchParams.set("app_name", APP_NAME)
    url.searchParams.set("scope", SCOPES[0])
    url.searchParams.set("user_id", state)
    url.searchParams.set("return_url", returnUrl.toString())
    url.searchParams.set("callback_url", grantUri)
    return url.toString()
  },

  /**
   * The browser's return carries no signature. What can be checked is that
   * the store says yes, that it names the same state it was given, and that
   * the state is present at all; the credential itself was proven in the
   * grant route against the store, which is the stronger check.
   */
  verifyCallback(query: URLSearchParams): boolean {
    const state = query.get("state")
    const userId = query.get("user_id")
    if (!state || !userId || state !== userId) return false
    return query.get("success") === "1"
  },

  async exchange(): Promise<OAuthGrant> {
    // Never called: this channel completes from the grant route.
    throw new ChannelError(
      normalized("unknown", "This connection completes from the store's confirmation, not here."),
    )
  },
}

/** The shape lib/credentials seals and opens for this channel. */
export const woocommerceCredentialsSchema = z.object({
  consumerKey: z.string().min(1),
  consumerSecret: z.string().min(1),
})

export type WooCommerceCredentials = z.infer<typeof woocommerceCredentialsSchema>
