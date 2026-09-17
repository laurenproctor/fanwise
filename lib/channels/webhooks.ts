import { createAdminClient } from "@/lib/supabase/admin"
import { normalizeUnknown } from "./errors"
import { findAdapter } from "./registry"
import type { ChannelConnection, ChannelWebhookEvent, WebhookHandleResult } from "./types"

/**
 * Acting on one recorded delivery (ADR 0014).
 *
 * The route recorded the receipt and enqueued this with the row's id and
 * nothing else. Here the row is loaded, every active connection to the account
 * it names is found, and the adapter is asked to act once per connection. A
 * shop connected to two workspaces is two connections, each answerable for
 * its own listings, and the provider refuses to fulfil a line twice.
 *
 * Everything goes through the service role, because nobody is signed in on a
 * job, and the scope is established here in code: the connection rows are
 * looked up by the account the verified delivery named, never by anything in
 * a payload.
 *
 * Outcomes are persisted, failures included. A retryable provider failure
 * — the shop briefly down — is rethrown after being recorded, so the durable
 * queue tries again; anything else is final and the receipt says why.
 */

type Outcome =
  WebhookHandleResult | { action: "failed"; code: string; message: string; raw: unknown }

export async function runChannelWebhook({ eventId }: { eventId: string }): Promise<void> {
  const admin = createAdminClient()

  const { data: receipt, error: readError } = await admin
    .from("channel_webhook_events")
    .select("*")
    .eq("id", eventId)
    .maybeSingle()
  if (readError) throw new Error(`could not read webhook receipt: ${readError.message}`)
  if (!receipt) {
    console.warn("[webhooks] receipt not found", { eventId })
    return
  }
  if (receipt.processed_at) return

  const adapter = findAdapter(receipt.channel_key)
  if (!adapter?.webhooks) {
    await admin
      .from("channel_webhook_events")
      .update({
        processed_at: new Date().toISOString(),
        error: "no adapter acts on this channel's deliveries",
      })
      .eq("id", eventId)
    return
  }

  await admin
    .from("channel_webhook_events")
    .update({ claimed_at: new Date().toISOString() })
    .eq("id", eventId)

  const { data: channel } = await admin
    .from("channels")
    .select("id")
    .eq("key", receipt.channel_key)
    .maybeSingle()

  const { data: connections, error: connectionsError } = channel
    ? await admin
        .from("channel_connections")
        .select("*")
        .eq("channel_id", channel.id)
        .eq("external_account_id", receipt.external_account_id)
        .eq("status", "active")
    : { data: [] as ChannelConnection[], error: null }
  if (connectionsError) {
    throw new Error(`could not read connections: ${connectionsError.message}`)
  }

  const event: ChannelWebhookEvent = {
    id: receipt.id,
    topic: receipt.topic,
    externalAccountId: receipt.external_account_id,
    externalObjectId: receipt.external_object_id,
  }

  const outcomes: Record<string, Outcome> = {}
  let retryable: unknown = null

  for (const connection of connections ?? []) {
    try {
      outcomes[connection.id] = await adapter.webhooks.handle(event, {
        connection,
        externalListingIds: () => externalListingIds(admin, connection.id),
      })
    } catch (error) {
      const failure = normalizeUnknown(error, adapter.name)
      outcomes[connection.id] = {
        action: "failed",
        code: failure.code,
        message: failure.message,
        raw: failure.raw ?? null,
      }
      if (failure.retryable) retryable = error
    }
  }

  const outcome = { connections: (connections ?? []).length, byConnection: outcomes }

  if (retryable) {
    await admin
      .from("channel_webhook_events")
      .update({ outcome: outcome as never, error: "retrying after a provider failure" })
      .eq("id", eventId)
    throw retryable
  }

  const failed = Object.values(outcomes).find((o) => o.action === "failed")
  await admin
    .from("channel_webhook_events")
    .update({
      processed_at: new Date().toISOString(),
      outcome: outcome as never,
      error: failed && failed.action === "failed" ? failed.message : null,
    })
    .eq("id", eventId)
}

async function externalListingIds(
  admin: ReturnType<typeof createAdminClient>,
  connectionId: string,
): Promise<string[]> {
  const { data, error } = await admin
    .from("channel_listings")
    .select("external_listing_id")
    .eq("channel_connection_id", connectionId)
    .not("external_listing_id", "is", null)
  if (error) throw new Error(`could not read listings: ${error.message}`)
  return (data ?? [])
    .map((row) => row.external_listing_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0)
}
