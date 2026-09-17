import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { ChannelError } from "@/lib/channels/errors"
import { findAdapter } from "@/lib/channels/registry"
import { jobs } from "@/lib/jobs"

/**
 * A channel's webhook, for every channel that delivers one (ADR 0014).
 *
 * Generic in the channel key for the reason the OAuth callback is: a route
 * named after a marketplace would put a provider name in the application
 * tree. The signature, the shape and the act live behind `adapter.webhooks`.
 *
 * Nobody is signed in here and nothing in the request is trusted. The order
 * is the security of the route, per docs/security.md rule 5, and it is the
 * billing webhook's order:
 *
 *   1. the raw body is read as text, because the signature covers the bytes
 *   2. the adapter verifies the signature before any field is read
 *   3. the delivery is recorded by the provider's own id, so a redelivery
 *      collides at the database and is answered without being re-queued
 *   4. only then is a job enqueued, carrying the receipt's id and nothing else
 *
 * The work itself never runs here. A provider allows a few seconds for the
 * whole request and drops a subscription that keeps failing, so the route does
 * the least it can and answers 200. A failure to record is the
 * one answer that asks for a redelivery.
 */

const UNIQUE_VIOLATION = "23505"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ channelKey: string }> },
): Promise<NextResponse> {
  const { channelKey } = await params
  const adapter = findAdapter(channelKey)
  if (!adapter?.webhooks) return NextResponse.json({ error: "no such webhook" }, { status: 404 })

  const rawBody = await request.text()

  let verified: boolean
  try {
    verified = adapter.webhooks.verify(rawBody, request.headers)
  } catch (error) {
    console.error("[webhooks] could not verify", { channelKey, error })
    return NextResponse.json({ error: "could not verify" }, { status: 401 })
  }
  if (!verified) {
    console.warn("[webhooks] delivery failed signature verification", { channelKey })
    return NextResponse.json({ error: "could not verify" }, { status: 401 })
  }

  let event
  try {
    event = adapter.webhooks.parse(rawBody, request.headers)
  } catch (error) {
    // Acknowledged, not retried: a redelivery of the same bytes would be the
    // same shape. The refusal is logged by code and never by body.
    const code = error instanceof ChannelError ? error.normalized.code : "unknown"
    console.warn("[webhooks] delivery unreadable", { channelKey, code })
    return NextResponse.json({ ok: true, ignored: true })
  }
  if (!event) return NextResponse.json({ ok: true, ignored: true })

  const admin = createAdminClient()
  const { error: insertError } = await admin.from("channel_webhook_events").insert({
    id: event.id,
    channel_key: channelKey,
    external_account_id: event.externalAccountId,
    topic: event.topic,
    external_object_id: event.externalObjectId,
    idempotency_key: `${channelKey}:${event.externalAccountId}:${event.topic}:${event.externalObjectId}`,
  })

  if (insertError) {
    if (insertError.code !== UNIQUE_VIOLATION) {
      console.error("[webhooks] could not record delivery", { channelKey, code: insertError.code })
      return NextResponse.json({ error: "could not record" }, { status: 500 })
    }
    // A collision is one of two things: this delivery again, or another
    // delivery about the same provider object. Either way the earlier receipt
    // owns the work. Finished, it is acknowledged; unfinished, it is queued
    // again under its own id, which the queue de-duplicates.
    const { data: seen } = await admin
      .from("channel_webhook_events")
      .select("id, processed_at")
      .or(
        `id.eq.${event.id},idempotency_key.eq.${channelKey}:${event.externalAccountId}:${event.topic}:${event.externalObjectId}`,
      )
      .limit(1)
      .maybeSingle()
    if (!seen || seen.processed_at) return NextResponse.json({ ok: true, duplicate: true })
    await jobs.enqueue(
      "channel_webhook",
      { eventId: seen.id },
      { idempotencyKey: `webhook:${seen.id}` },
    )
    return NextResponse.json({ ok: true, duplicate: true, queued: true })
  }

  await jobs.enqueue(
    "channel_webhook",
    { eventId: event.id },
    { idempotencyKey: `webhook:${event.id}` },
  )
  return NextResponse.json({ ok: true, queued: true })
}
