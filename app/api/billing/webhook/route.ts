import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { BillingGatewayError } from "@/lib/billing/gateway"
import { gateway } from "@/lib/billing/providers"
import { processWebhookEvent } from "@/lib/billing/webhook"

/**
 * The payment provider's webhook.
 *
 * Nobody is signed in here and nothing in the request is trusted. The order
 * is the security of the route, per docs/security.md rule 5:
 *
 *   1. the raw body is read as text, because the signature covers the bytes
 *      and a parsed-then-reserialized body does not verify
 *   2. the gateway verifies the signature before any field is read
 *   3. the event is recorded by the provider's own id, so a redelivery
 *      collides at the database and is answered without being re-applied
 *   4. only then is the event applied
 *
 * A failure inside step 4 is recorded on the receipt row and answered with a
 * 500, which is what asks the provider to deliver it again. A redelivery of
 * an event that was recorded but never finished is applied again; one that
 * finished is acknowledged and dropped.
 */

const UNIQUE_VIOLATION = "23505"

export async function POST(request: NextRequest): Promise<NextResponse> {
  const provider = gateway()
  if (!provider) return NextResponse.json({ error: "billing is not configured" }, { status: 404 })

  const rawBody = await request.text()
  const signature = request.headers.get(provider.signatureHeader)

  let event
  try {
    event = provider.parseWebhook(rawBody, signature)
  } catch (error) {
    const code = error instanceof BillingGatewayError ? error.code : "unknown"
    console.warn("[billing] webhook rejected", { code })
    return NextResponse.json({ error: "could not verify" }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error: insertError } = await admin
    .from("billing_webhook_events")
    .insert({ id: event.id, type: event.type === "ignored" ? event.providerType : event.type })

  if (insertError) {
    if (insertError.code !== UNIQUE_VIOLATION) {
      console.error("[billing] could not record webhook", { code: insertError.code })
      return NextResponse.json({ error: "could not record" }, { status: 500 })
    }
    const { data: seen } = await admin
      .from("billing_webhook_events")
      .select("processed_at")
      .eq("id", event.id)
      .maybeSingle()
    if (seen?.processed_at) return NextResponse.json({ ok: true, duplicate: true })
  }

  try {
    const outcome = await processWebhookEvent(event, { gateway: provider })
    await admin
      .from("billing_webhook_events")
      .update({ processed_at: new Date().toISOString(), error: null })
      .eq("id", event.id)
    return NextResponse.json({ ok: true, handled: outcome.handled })
  } catch (error) {
    // The message is ours or the gateway's, never a provider body.
    const message = error instanceof Error ? error.message : "unknown"
    console.error("[billing] webhook failed", { eventId: event.id, type: event.type })
    await admin.from("billing_webhook_events").update({ error: message }).eq("id", event.id)
    return NextResponse.json({ error: "could not apply" }, { status: 500 })
  }
}
