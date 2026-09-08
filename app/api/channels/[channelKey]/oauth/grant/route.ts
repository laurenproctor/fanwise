import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { storeConnectionCredentials } from "@/lib/credentials"
import { consumeAuthorizationState, pruneExpiredStates } from "@/lib/channels/oauth"
import { findAdapter } from "@/lib/channels/registry"
import { normalizeUnknown } from "@/lib/channels/errors"

/**
 * The grant endpoint, for every channel whose provider posts the credential.
 *
 * Some providers never put a secret in the browser: the store posts the keys
 * here, server to server, and sends the person back to the callback with a
 * yes or a no. This route is therefore the completion for those channels, and
 * the callback is only a report.
 *
 * Nobody is signed in here and nothing in the request is trusted. The order
 * is the security of the route:
 *
 *   1. the adapter parses the body; anything malformed is a 400 and no state
 *      is touched
 *   2. the state is consumed, exactly once, so a replayed POST has nothing to
 *      consume
 *   3. the adapter proves the credential against the account the state row
 *      names, so keys for some other store are refused
 *   4. only then is a connection written and the credential sealed
 *
 * The response matters to the provider: a non-2xx is shown to the person on
 * the store's own screen, which is the one place they are looking.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ channelKey: string }> },
): Promise<NextResponse> {
  const { channelKey } = await params
  const adapter = findAdapter(channelKey)
  const grant = adapter?.oauth?.grant
  if (!adapter || !grant) {
    return NextResponse.json({ error: "no such channel" }, { status: 404 })
  }

  const body: unknown = await request.json().catch(() => null)
  const parsed = grant.parse(body)
  if (!parsed) return NextResponse.json({ error: "malformed grant" }, { status: 400 })

  const consumed = await consumeAuthorizationState(parsed.state)
  if (!consumed) {
    return NextResponse.json({ error: "unknown or expired authorization" }, { status: 410 })
  }

  void pruneExpiredStates().catch(() => {})

  try {
    const verified = await grant.verify({
      accountHint: consumed.accountHint ?? "",
      credentials: parsed.credentials,
      scopes: parsed.scopes,
    })

    const admin = createAdminClient()
    const { data: connection, error: connectionError } = await admin
      .from("channel_connections")
      .upsert(
        {
          workspace_id: consumed.workspaceId,
          channel_id: consumed.channelId,
          external_account_id: verified.externalAccountId,
          external_account_name: verified.externalAccountName,
          status: "active",
          scopes: verified.scopes,
          metadata: verified.metadata as never,
          last_verified_at: new Date().toISOString(),
          expires_at: verified.expiresAt,
        },
        { onConflict: "workspace_id,channel_id,external_account_id" },
      )
      .select("id")
      .single()

    if (connectionError || !connection) {
      throw new Error(`could not record the connection: ${connectionError?.message}`)
    }

    await storeConnectionCredentials({
      workspaceId: consumed.workspaceId,
      connectionId: connection.id,
      credentials: verified.credentials,
    })
  } catch (error) {
    // The body of this request held the store's keys. Only the normalized
    // code is logged, and only a sentence goes back.
    const normalized = normalizeUnknown(error, adapter.name)
    console.error("[oauth] grant refused", { channelKey, code: normalized.code })
    return NextResponse.json({ error: normalized.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
