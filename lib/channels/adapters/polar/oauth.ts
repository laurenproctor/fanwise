import { z } from "zod"
import { ChannelError, normalized } from "@/lib/channels/errors"
import type { ChannelOAuth, OAuthAuthorizeRequest, OAuthGrant } from "@/lib/channels/types"
import { readConnectionCredentials } from "@/lib/credentials"
import { createPolarClient } from "./client"
import { SCOPES, authorizeUrl, polarConfig, revokeUrl, tokenUrl } from "./config"

/**
 * Polar authorization: OpenID Connect, which is OAuth 2.0 authorization code
 * with a discovery document on top.
 *
 * Polar requires PKCE only for public clients; Fanwise is a confidential one
 * and sends S256 anyway, because the verifier costs nothing and the shared
 * flow already mints one. The client secret goes in the token exchange, which
 * Polar requires of a confidential client.
 *
 * Tokens are user-scoped, not organization-scoped: the person who authorizes
 * grants access to their organizations, optionally narrowed on the consent
 * screen. A Fanwise connection is to one organization, so the account hint is
 * the organization's slug, and the exchange reads the user's organizations
 * and refuses unless the named one is among them.
 *
 * Access tokens last ten days and come with a refresh token, so the sealed
 * credential is the pair plus the expiry and the adapter refreshes before a
 * call when the ten days are nearly up. How long a refresh token lives is
 * not documented, so `expiresAt` on the connection is null and a 401 reads as
 * `credentials_invalid` and offers Reconnect. Disconnect revokes both.
 */

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().nullish(),
  scope: z.string().optional(),
})

const organizationSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  slug: z.string(),
  default_presentment_currency: z.string().nullish(),
  status: z.string().nullish(),
})

const organizationsSchema = z.object({
  items: z.array(organizationSchema),
  pagination: z.object({ total_count: z.number(), max_page: z.number() }).optional(),
})

export const polarCredentialsSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().nullable(),
  /** ISO time the access token stops working. */
  expiresAt: z.string().min(1),
})

export type PolarCredentials = z.infer<typeof polarCredentialsSchema>

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/

/**
 * The organization slug, as the creator knows it: the segment after
 * `polar.sh/` on their own page, or typed on its own.
 */
export function parseOrganizationHint(
  raw: string,
): { ok: true; value: string } | { ok: false; message: string } {
  const value = raw.trim().toLowerCase()
  const refusal = {
    ok: false as const,
    message:
      "Enter your Polar organization's slug. It is the part of your Polar address after polar.sh/.",
  }
  if (value.length === 0 || value.length > 200) return refusal
  const path = /polar\.sh\/(?:dashboard\/)?([^/?#]+)/i.exec(value)
  const candidate = (path ? path[1]! : value.replace(/^@/, "")).toLowerCase()
  return SLUG.test(candidate) ? { ok: true, value: candidate } : refusal
}

async function tokenRequest(
  form: Record<string, string>,
  fetchImpl?: typeof fetch,
): Promise<z.infer<typeof tokenResponseSchema>> {
  const client = createPolarClient(fetchImpl ? { fetchImpl } : {})
  return client.request({
    method: "POST",
    path: tokenUrl(),
    body: { kind: "form", value: form },
    schema: tokenResponseSchema,
  })
}

function expiryFrom(expiresIn: number): string {
  return new Date(Date.now() + expiresIn * 1000).toISOString()
}

/**
 * A fresh access token from the refresh token. Whether Polar rotates the
 * refresh token is not documented; one that comes back replaces the old,
 * and one that does not leaves the old in place.
 */
export async function refreshAccessToken(
  refreshToken: string,
  fetchImpl?: typeof fetch,
): Promise<{ accessToken: string; refreshToken: string; expiresAt: string }> {
  const { clientId, clientSecret } = polarConfig()
  const token = await tokenRequest(
    {
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    },
    fetchImpl,
  )
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? refreshToken,
    expiresAt: expiryFrom(token.expires_in),
  }
}

/**
 * Tells Polar a token is finished with. Best effort by design: the caller is
 * about to delete the connection, and a revoke that fails because the token
 * was already revoked should not keep a creator from disconnecting.
 */
export async function revokeToken(
  token: string,
  hint: "access_token" | "refresh_token",
  fetchImpl?: typeof fetch,
): Promise<void> {
  const { clientId, clientSecret } = polarConfig()
  const client = createPolarClient(fetchImpl ? { fetchImpl } : {})
  await client.request({
    method: "POST",
    path: revokeUrl(),
    body: {
      kind: "form",
      value: { token, token_type_hint: hint, client_id: clientId, client_secret: clientSecret },
    },
    schema: z.unknown(),
  })
}

export const polarOAuth: ChannelOAuth = {
  scopes: SCOPES,
  pkce: true,
  accountHintLabel: "Your Polar organization",
  accountHintPlaceholder: "astertype",

  parseAccountHint: parseOrganizationHint,

  authorizeUrl({ state, redirectUri, codeChallenge }: OAuthAuthorizeRequest): string {
    const { clientId } = polarConfig()
    if (!codeChallenge)
      throw new Error("refusing to build an authorize URL without a PKCE challenge")
    const url = new URL(authorizeUrl())
    url.searchParams.set("response_type", "code")
    url.searchParams.set("client_id", clientId)
    url.searchParams.set("redirect_uri", redirectUri)
    url.searchParams.set("scope", SCOPES.join(" "))
    url.searchParams.set("state", state)
    url.searchParams.set("code_challenge", codeChallenge)
    url.searchParams.set("code_challenge_method", "S256")
    return url.toString()
  },

  /**
   * The return carries no signature. What can be checked is that Polar did
   * not report an error and that a code and a state are present; the code is
   * worthless without the verifier on the state row, which is the check that
   * matters, and it happens at the exchange.
   */
  verifyCallback(query: URLSearchParams): boolean {
    if (query.get("error")) return false
    return Boolean(query.get("code") && query.get("state"))
  },

  async exchange({ accountHint, query, redirectUri, codeVerifier }): Promise<OAuthGrant> {
    const code = query.get("code")
    if (!code || !codeVerifier) {
      throw new ChannelError(
        normalized(
          "unknown",
          "Polar did not return an authorization code. Try connecting the organization again.",
        ),
      )
    }
    const { clientId, clientSecret } = polarConfig()
    const token = await tokenRequest({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
      code_verifier: codeVerifier,
    })

    const client = createPolarClient({ accessToken: token.access_token })
    const { items } = await client.request({
      method: "GET",
      path: "organizations?limit=100",
      schema: organizationsSchema,
    })
    const wanted = accountHint.trim().toLowerCase()
    const organization = items.find((o) => o.slug.toLowerCase() === wanted)
    if (!organization) {
      throw new ChannelError(
        normalized(
          "permission_denied",
          items.length === 0
            ? "That Polar account has no organization Fanwise was allowed to reach. Create one on Polar, or allow it on the consent screen, then connect again."
            : `Fanwise was not allowed to reach the Polar organization "${wanted}". Check the slug, and allow that organization on Polar's consent screen.`,
          { allowed: items.map((o) => o.slug) },
        ),
      )
    }

    return {
      externalAccountId: organization.id,
      externalAccountName: organization.name,
      scopes: [...SCOPES],
      // The access token's ten days are the adapter's business and recorded
      // in the credential. The refresh token's life is undocumented, so the
      // connection makes no claim, and a 401 offers Reconnect.
      expiresAt: null,
      credentials: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? null,
        expiresAt: expiryFrom(token.expires_in),
      } satisfies PolarCredentials,
      metadata: {
        slug: organization.slug,
        currencyCode: organization.default_presentment_currency ?? null,
        status: organization.status ?? null,
      },
    }
  },

  /**
   * Called by disconnect, before the connection row goes. The credential is
   * read here rather than passed in, so no token travels through the action
   * that asked for the revoke. Both tokens are revoked: a refresh token that
   * outlived its access token would otherwise still mint new ones.
   */
  async revoke({ workspaceId, connectionId }): Promise<void> {
    const credentials = await readConnectionCredentials({
      workspaceId,
      connectionId,
      schema: polarCredentialsSchema,
    })
    if (!credentials) return
    if (credentials.refreshToken) {
      await revokeToken(credentials.refreshToken, "refresh_token").catch(() => {})
    }
    await revokeToken(credentials.accessToken, "access_token")
  },
}
