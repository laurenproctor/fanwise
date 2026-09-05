import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { storeConnectionCredentials } from "@/lib/credentials"
import {
  appOrigin,
  callbackUrl,
  consumeAuthorizationState,
  pruneExpiredStates,
} from "@/lib/channels/oauth"
import { findAdapter } from "@/lib/channels/registry"
import { normalizeUnknown } from "@/lib/channels/errors"

/**
 * The OAuth callback, for every channel that has one.
 *
 * Generic in the channel key on purpose: a route named after a marketplace
 * would put a provider name in the application tree, and the next channel would
 * copy the file rather than reuse it. The provider-specific half — the
 * signature check, the token exchange, the account read — all lives behind
 * `adapter.oauth`.
 *
 * The order below is the security of this route, and it is deliberate:
 *
 *   1. verify the callback's signature, before any parameter is used
 *   2. consume the state, exactly once
 *   3. confirm the person finishing is the person who started
 *   4. only then exchange the code
 *
 * Doing 4 before 1 would have Fanwise send a client secret in response to an
 * unauthenticated GET that anyone can trigger. Doing 3 before 2 would leave a
 * usable state row behind after a failed attempt.
 */

/**
 * Everything the creator is told. Details go to the log, not the query string.
 *
 * The origin comes from NEXT_PUBLIC_APP_URL, not from the request, for the same
 * reason callbackUrl() does: an origin derived from a header is an origin
 * someone else can suggest. Behind the tunnel that development against a real
 * provider requires, request.nextUrl.origin is also simply wrong — it pairs the
 * forwarded protocol with the internal host and sends the creator to
 * https://localhost:3001, which is nowhere.
 */
function back(workspaceSlug: string | null, message?: string): NextResponse {
  const target = new URL(workspaceSlug ? `/w/${workspaceSlug}/channels` : "/", appOrigin())
  if (message) target.searchParams.set("error", message)
  return NextResponse.redirect(target)
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ channelKey: string }> },
): Promise<NextResponse> {
  const { channelKey } = await params
  const adapter = findAdapter(channelKey)

  if (!adapter?.oauth) return back(null, "That channel cannot be connected.")

  const query = request.nextUrl.searchParams

  // 1. Signature first, per docs/security.md rule 5. Until this passes, every
  // parameter in the URL is a string a stranger chose.
  let verified: boolean
  try {
    verified = adapter.oauth.verifyCallback(query)
  } catch (error) {
    console.error("[oauth] could not verify callback", { channelKey, error })
    return back(null, "That connection could not be completed.")
  }
  if (!verified) {
    console.warn("[oauth] callback failed signature verification", { channelKey })
    return back(null, "That connection could not be verified. Start again.")
  }

  // 2. Consume the state. One winner, decided by the database.
  const state = query.get("state")
  const consumed = state ? await consumeAuthorizationState(state) : null
  if (!consumed) {
    return back(null, "That connection link has expired or was already used. Start again.")
  }

  void pruneExpiredStates().catch(() => {})

  const admin = createAdminClient()
  const { data: workspace } = await admin
    .from("workspaces")
    .select("slug")
    .eq("id", consumed.workspaceId)
    .maybeSingle()
  const workspaceSlug = workspace?.slug ?? null

  // 3. The person finishing must be the person who started. The state row is
  // already proof that *someone* authorized this, but without this check a
  // completed authorization could be landed in a workspace by whoever happened
  // to open the callback URL.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user || user.id !== consumed.userId) {
    return back(workspaceSlug, "Sign in as the person who started that connection, then try again.")
  }

  try {
    // 4. Exchange, and read the account. Both are provider work.
    const grant = await adapter.oauth.exchange({
      accountHint: consumed.accountHint ?? "",
      query,
      redirectUri: callbackUrl(channelKey),
    })

    const { data: connection, error: connectionError } = await admin
      .from("channel_connections")
      .upsert(
        {
          workspace_id: consumed.workspaceId,
          channel_id: consumed.channelId,
          external_account_id: grant.externalAccountId,
          external_account_name: grant.externalAccountName,
          status: "active",
          scopes: grant.scopes,
          metadata: grant.metadata as never,
          last_verified_at: new Date().toISOString(),
          expires_at: grant.expiresAt,
        },
        { onConflict: "workspace_id,channel_id,external_account_id" },
      )
      .select("id")
      .single()

    if (connectionError || !connection) {
      throw new Error(`could not record the connection: ${connectionError?.message}`)
    }

    // The credential is sealed and written last, so a connection row never
    // outlives a failed seal in a state that looks connected. If this throws,
    // the row exists without a secret, which the publish path reports as
    // "reconnect" rather than failing obscurely.
    await storeConnectionCredentials({
      workspaceId: consumed.workspaceId,
      connectionId: connection.id,
      credentials: grant.credentials,
    })
  } catch (error) {
    // Nothing from here reaches the browser except a normalized sentence. The
    // thrown value may hold a provider body, and the request that produced it
    // held a client secret.
    const normalized = normalizeUnknown(error, adapter.name)
    console.error("[oauth] exchange failed", { channelKey, code: normalized.code })
    return back(workspaceSlug, normalized.message)
  }

  return back(workspaceSlug)
}
