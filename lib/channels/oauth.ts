import { randomBytes } from "node:crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import { clientEnv } from "@/lib/env"

/**
 * OAuth state, as a single-use database row.
 *
 * docs/security.md rule 6: OAuth state is validated on every callback. A cookie
 * would satisfy the letter of that and not the point of it. A cookie can be
 * replayed: the same callback URL, opened twice, validates twice. A row can be
 * *consumed*, so the second attempt fails because there is nothing left to
 * consume.
 *
 * The row also carries what the callback is not allowed to choose for itself:
 * which workspace the connection lands in, which user started it, and which
 * account was being authorized. All three arrive from the database rather than
 * from the query string, so a valid callback cannot be steered at a different
 * workspace or a different shop.
 *
 * channel_oauth_states has no grant to anon or authenticated, so everything
 * here goes through the service role. Both functions take the ids they need and
 * neither trusts a caller for a workspace it has not established.
 */

/** Long enough to complete an authorization, short enough that a leaked link dies. */
const TTL_MS = 5 * 60 * 1000

/**
 * Where a provider sends the creator back to.
 *
 * Built from NEXT_PUBLIC_APP_URL rather than from the incoming request, because
 * a redirect URI derived from a header is a redirect URI an attacker can
 * suggest. It must match the value registered with the provider exactly.
 *
 * Lives here rather than beside the action that uses it because
 * lib/channels/actions.ts is a "use server" module, and every export from one
 * of those has to be an async server action. A plain string helper exported
 * from there is a build error, not a style problem.
 */
export function callbackUrl(channelKey: string): string {
  const base = clientEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, "")
  return `${base}/api/channels/${channelKey}/oauth/callback`
}

export async function createAuthorizationState(params: {
  workspaceId: string
  channelId: string
  userId: string
  accountHint: string
}): Promise<string> {
  // 32 bytes. The state is the only thing standing between a forged callback
  // and a connection, so it is generated the same way a session token would be.
  const state = randomBytes(32).toString("base64url")

  const admin = createAdminClient()
  const { error } = await admin.from("channel_oauth_states").insert({
    state,
    workspace_id: params.workspaceId,
    channel_id: params.channelId,
    user_id: params.userId,
    external_account_hint: params.accountHint,
    expires_at: new Date(Date.now() + TTL_MS).toISOString(),
  })

  if (error) throw new Error(`could not create an authorization state: ${error.message}`)
  return state
}

export interface ConsumedState {
  workspaceId: string
  channelId: string
  userId: string
  accountHint: string | null
}

/**
 * Consumes a state exactly once.
 *
 * The consume is a conditional update rather than a read followed by a write:
 * `consumed_at is null` is part of the statement, so two callbacks racing on
 * the same state produce one winner and one null, decided by the database. A
 * read-then-write would let both pass the check before either wrote.
 *
 * Returns null for every failure — unknown, expired, or already used — because
 * the caller has the same response to all three and distinguishing them in a
 * return value invites distinguishing them in a message.
 */
export async function consumeAuthorizationState(state: string): Promise<ConsumedState | null> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from("channel_oauth_states")
    .update({ consumed_at: new Date().toISOString() })
    .eq("state", state)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("workspace_id, channel_id, user_id, external_account_hint")
    .maybeSingle()

  if (error || !data) return null

  return {
    workspaceId: data.workspace_id,
    channelId: data.channel_id,
    userId: data.user_id,
    accountHint: data.external_account_hint,
  }
}

/**
 * Removes states that were never completed.
 *
 * Not scheduled. Called opportunistically from the callback, which is the only
 * moment the system is already thinking about this table and the only moment
 * new rows stop arriving. A cron job for a table that gains a row per Connect
 * click would be infrastructure bought ahead of a demonstrated need.
 */
export async function pruneExpiredStates(): Promise<void> {
  const admin = createAdminClient()
  await admin.from("channel_oauth_states").delete().lt("expires_at", new Date().toISOString())
}
