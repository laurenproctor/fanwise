import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  RLS_DENIED,
  adminClient,
  anonClient,
  createActor,
  destroyActor,
  type Actor,
} from "./harness"

/**
 * Webhook receipts (ADR 0014) are a provider's event stream, and nothing in
 * the browser has any business reading one. Service role only: RLS is on with
 * zero policies and no grant to anon or authenticated, the shape
 * billing_webhook_events established at C1.
 */

let alice: Actor
const RECEIPT_ID = "test-delivery-0014"

beforeAll(async () => {
  alice = await createActor("webhook-alice")
  const { error } = await adminClient()
    .from("channel_webhook_events")
    .upsert({
      id: RECEIPT_ID,
      channel_key: "shopify",
      external_account_id: "aster-type.myshopify.com",
      topic: "fulfillment_orders/order_routing_complete",
      external_object_id: "gid://shopify/FulfillmentOrder/1",
      idempotency_key: `shopify:aster-type.myshopify.com:routing:${RECEIPT_ID}`,
    })
  if (error) throw new Error(`could not seed receipt: ${error.message}`)
})

afterAll(async () => {
  await adminClient().from("channel_webhook_events").delete().eq("id", RECEIPT_ID)
  await destroyActor(alice)
})

describe("channel_webhook_events", () => {
  it("is unreachable from a signed-in member and from anon", async () => {
    const signedIn = await alice.client.from("channel_webhook_events").select("*")
    expect(signedIn.error?.code).toBe(RLS_DENIED)
    const anon = await anonClient().from("channel_webhook_events").select("*")
    expect(anon.error?.code).toBe(RLS_DENIED)
  })

  it("refuses a browser insert, so no client can forge a receipt", async () => {
    const forged = await alice.client.from("channel_webhook_events").insert({
      id: "forged",
      channel_key: "shopify",
      external_account_id: "aster-type.myshopify.com",
      topic: "fulfillment_orders/order_routing_complete",
      external_object_id: "gid://shopify/FulfillmentOrder/2",
      idempotency_key: "forged",
    })
    expect(forged.error?.code).toBe(RLS_DENIED)
    const { data } = await adminClient()
      .from("channel_webhook_events")
      .select("id")
      .eq("id", "forged")
    expect(data).toEqual([])
  })

  it("collides a second delivery about the same provider object on the idempotency key", async () => {
    const again = await adminClient()
      .from("channel_webhook_events")
      .insert({
        id: `${RECEIPT_ID}-redelivered-under-a-new-id`,
        channel_key: "shopify",
        external_account_id: "aster-type.myshopify.com",
        topic: "fulfillment_orders/order_routing_complete",
        external_object_id: "gid://shopify/FulfillmentOrder/1",
        idempotency_key: `shopify:aster-type.myshopify.com:routing:${RECEIPT_ID}`,
      })
    expect(again.error?.code).toBe("23505")
  })
})
