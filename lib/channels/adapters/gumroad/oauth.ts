import { z } from "zod"
import { ChannelError, normalized } from "@/lib/channels/errors"
import type { ChannelOAuth, OAuthAuthorizeRequest, OAuthGrant } from "@/lib/channels/types"
import { readConnectionCredentials } from "@/lib/credentials"
import { createGumroadClient } from "./client"
import { AUTHORIZE_URL, REVOKE_URL, SCOPES, TOKEN_URL, gumroadConfig } from "./config"

/**
 * Gumroad authorization: OAuth 2.0 authorization code with PKCE.
 *
 * Gumroad supports PKCE and does not require it; Fanwise sends S256 anyway,
 * because the verifier costs nothing and the shared flow already mints one.
 * The client secret goes in the token exchange too, which Gumroad accepts.
 *
 * Access tokens never expire. Gumroad issues a refresh token as well, but no
 * call Fanwise makes needs one, so the credential holds both sealed and
 * `expiresAt` is null. A token that does not expire is valid until revoked,
 * which is why disconnect revokes it: nothing else would.
 *
 * The account hint is the seller's username, used only to label the field.
 * Gumroad identifies the seller from the token, and the connection records
 * what `GET /v2/user` says rather than what was typed.
 */

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  refresh_token: z.string().nullish(),
  scope: z.string().optional(),
})

const userSchema = z.object({
  user: z.object({
    user_id: z.string().min(1),
    name: z.string().nullish(),
    url: z.string().nullish(),
    profile_picture_url: z.string().nullish(),
  }),
})

export const gumroadCredentialsSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().nullable(),
})

export type GumroadCredentials = z.infer<typeof gumroadCredentialsSchema>

export function parseUsernameHint(
  raw: string,
): { ok: true; value: string } | { ok: false; message: string } {
  const value = raw.trim()
  if (value.length === 0 || value.length > 100) {
    return {
      ok: false,
      message:
        "Enter your Gumroad username. It is the first part of your store's address, before .gumroad.com.",
    }
  }
  // A pasted store URL is the common case, in either of its two shapes.
  const subdomain = /^https?:\/\/([^./]+)\.gumroad\.com/i.exec(value)
  if (subdomain) return { ok: true, value: subdomain[1]! }
  const path = /gumroad\.com\/([^/?#]+)/i.exec(value)
  if (path) return { ok: true, value: path[1]! }
  return { ok: true, value: value.replace(/^@/, "") }
}

async function tokenRequest(
  form: Record<string, string>,
  fetchImpl?: typeof fetch,
): Promise<z.infer<typeof tokenResponseSchema>> {
  const client = createGumroadClient(fetchImpl ? { fetchImpl } : {})
  return client.request({
    method: "POST",
    path: TOKEN_URL,
    body: { kind: "form", value: form },
    schema: tokenResponseSchema,
  })
}

/**
 * Tells Gumroad the token is finished with.
 *
 * Best effort by design: the caller is about to delete the connection, and a
 * revoke that fails because the token was already revoked, or the account is
 * gone, should not keep a creator from disconnecting. Doorkeeper answers a
 * revoke with an empty 200 whether or not the token existed.
 */
export async function revokeAccessToken(
  accessToken: string,
  fetchImpl?: typeof fetch,
): Promise<void> {
  const { clientId, clientSecret } = gumroadConfig()
  const client = createGumroadClient(fetchImpl ? { fetchImpl } : {})
  await client.request({
    method: "POST",
    path: REVOKE_URL,
    body: {
      kind: "form",
      value: { token: accessToken, client_id: clientId, client_secret: clientSecret },
    },
    schema: z.unknown(),
  })
}

export const gumroadOAuth: ChannelOAuth = {
  scopes: SCOPES,
  pkce: true,
  accountHintLabel: "Your Gumroad username",
  accountHintPlaceholder: "astertype",

  parseAccountHint: parseUsernameHint,

  authorizeUrl({ state, redirectUri, codeChallenge }: OAuthAuthorizeRequest): string {
    const { clientId } = gumroadConfig()
    if (!codeChallenge)
      throw new Error("refusing to build an authorize URL without a PKCE challenge")
    const url = new URL(AUTHORIZE_URL)
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
   * The return carries no signature. What can be checked is that Gumroad did
   * not report an error and that a code and a state are present; the code is
   * worthless without the verifier on the state row, which is the check that
   * matters, and it happens at the exchange.
   */
  verifyCallback(query: URLSearchParams): boolean {
    if (query.get("error")) return false
    return Boolean(query.get("code") && query.get("state"))
  },

  async exchange({ query, redirectUri, codeVerifier }): Promise<OAuthGrant> {
    const code = query.get("code")
    if (!code || !codeVerifier) {
      throw new ChannelError(
        normalized(
          "unknown",
          "Gumroad did not return an authorization code. Try connecting the account again.",
        ),
      )
    }
    const { clientId, clientSecret } = gumroadConfig()
    const token = await tokenRequest({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
      code_verifier: codeVerifier,
    })

    const client = createGumroadClient({ accessToken: token.access_token })
    const { user } = await client.request({ method: "GET", path: "user", schema: userSchema })

    return {
      externalAccountId: user.user_id,
      externalAccountName: user.name ?? null,
      scopes: [...SCOPES],
      // Access tokens do not expire. Null is the honest answer, and disconnect
      // revokes the token because nothing else ever will.
      expiresAt: null,
      credentials: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? null,
      } satisfies GumroadCredentials,
      metadata: {
        profileUrl: user.url ?? null,
      },
    }
  },

  /**
   * Called by disconnect, before the connection row goes. The credential is
   * read here rather than passed in, so the token never travels through the
   * action that asked for the revoke.
   */
  async revoke({ workspaceId, connectionId }): Promise<void> {
    const credentials = await readConnectionCredentials({
      workspaceId,
      connectionId,
      schema: gumroadCredentialsSchema,
    })
    if (!credentials) return
    await revokeAccessToken(credentials.accessToken)
  },
}
