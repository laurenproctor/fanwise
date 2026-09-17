import { createHmac } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/credentials", () => ({
  readConnectionCredentials: vi.fn(async () => ({ accessToken: "shpat-test-token" })),
}))

import { resetConfigCacheForTests, SCOPES } from "@/lib/channels/adapters/shopify/config"
import { createShopifyClient } from "@/lib/channels/adapters/shopify/client"
import {
  FULFILLMENT_MESSAGE,
  ROUTING_COMPLETE_TOPIC,
  ROUTING_COMPLETE_TOPIC_ENUM,
  ensureRoutingWebhook,
  fanwiseDigitalLines,
  parseWebhook,
  shopifyWebhooks,
  verifyWebhookHmac,
  type FulfillmentOrderState,
} from "@/lib/channels/adapters/shopify/webhooks"
import { ChannelError } from "@/lib/channels/errors"
import { DELIVERY_SETUP_CONFIRMED_KEY } from "@/lib/delivery/setup"
import type { ChannelConnection, WebhookContext } from "@/lib/channels/types"

/**
 * Marking a digital order fulfilled (ADR 0015).
 *
 * The three things a wrong version of this would do, each pinned: mark a mug
 * fulfilled because it shared an order with a font; mark anything fulfilled
 * before the shop's email prints the link; mark an unpaid order fulfilled.
 */

const SECRET = "test-client-secret"

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("base64")
}

function headersFor(body: string, overrides: Record<string, string | null> = {}): Headers {
  const base: Record<string, string> = {
    "x-shopify-hmac-sha256": sign(body),
    "x-shopify-topic": ROUTING_COMPLETE_TOPIC,
    "x-shopify-shop-domain": "Aster-Type.myshopify.com",
    "x-shopify-webhook-id": "delivery-1",
  }
  const headers = new Headers()
  for (const [key, value] of Object.entries({ ...base, ...overrides })) {
    if (value !== null) headers.set(key, value)
  }
  return headers
}

const ROUTING_BODY = JSON.stringify({
  fulfillment_order: { id: "gid://shopify/FulfillmentOrder/77", status: "open" },
})

beforeEach(() => {
  process.env.SHOPIFY_CLIENT_ID = "test-client-id"
  process.env.SHOPIFY_CLIENT_SECRET = SECRET
  resetConfigCacheForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("the signature", () => {
  it("accepts Shopify's HMAC over the raw bytes and nothing else", () => {
    expect(verifyWebhookHmac(ROUTING_BODY, sign(ROUTING_BODY), SECRET)).toBe(true)
    // The same body, one byte different: what a re-serialized body looks like.
    expect(verifyWebhookHmac(ROUTING_BODY + " ", sign(ROUTING_BODY), SECRET)).toBe(false)
    expect(verifyWebhookHmac(ROUTING_BODY, sign(ROUTING_BODY, "someone-else"), SECRET)).toBe(false)
    expect(verifyWebhookHmac(ROUTING_BODY, null, SECRET)).toBe(false)
    expect(verifyWebhookHmac(ROUTING_BODY, "short", SECRET)).toBe(false)
  })

  it("is checked by the adapter with the app's client secret", () => {
    expect(shopifyWebhooks.verify(ROUTING_BODY, headersFor(ROUTING_BODY))).toBe(true)
    expect(
      shopifyWebhooks.verify(
        ROUTING_BODY,
        headersFor(ROUTING_BODY, { "x-shopify-hmac-sha256": null }),
      ),
    ).toBe(false)
  })
})

describe("reading a delivery", () => {
  it("turns a routing-complete delivery into an event keyed by Shopify's ids", () => {
    expect(parseWebhook(ROUTING_BODY, headersFor(ROUTING_BODY))).toEqual({
      id: "delivery-1",
      topic: ROUTING_COMPLETE_TOPIC,
      // Lowercased, to match what the connection row holds.
      externalAccountId: "aster-type.myshopify.com",
      externalObjectId: "gid://shopify/FulfillmentOrder/77",
    })
  })

  it("ignores a topic this adapter does not act on", () => {
    expect(
      parseWebhook(ROUTING_BODY, headersFor(ROUTING_BODY, { "x-shopify-topic": "orders/paid" })),
    ).toBe(null)
  })

  it("refuses a delivery for its topic that is not the promised shape, rather than dropping it", () => {
    expect(() => parseWebhook("not json", headersFor("not json"))).toThrow(ChannelError)
    const wrong = JSON.stringify({ order: { id: 1 } })
    expect(() => parseWebhook(wrong, headersFor(wrong))).toThrow(ChannelError)
    expect(() =>
      parseWebhook(ROUTING_BODY, headersFor(ROUTING_BODY, { "x-shopify-webhook-id": null })),
    ).toThrow(ChannelError)
  })
})

function order(
  nodes: FulfillmentOrderState["lineItems"]["nodes"],
  overrides: Partial<Omit<FulfillmentOrderState, "lineItems">> = {},
): FulfillmentOrderState {
  return {
    id: "gid://shopify/FulfillmentOrder/77",
    status: "OPEN",
    order: { id: "gid://shopify/Order/9", displayFinancialStatus: "PAID" },
    lineItems: { nodes },
    ...overrides,
  }
}

const FONT = "gid://shopify/Product/font"
const MUG = "gid://shopify/Product/mug"
const HANDMADE_PDF = "gid://shopify/Product/pdf-made-in-admin"

const MIXED = [
  {
    id: "gid://shopify/FulfillmentOrderLineItem/1",
    remainingQuantity: 2,
    lineItem: { id: "li-1", requiresShipping: false, product: { id: FONT } },
  },
  {
    id: "gid://shopify/FulfillmentOrderLineItem/2",
    remainingQuantity: 1,
    lineItem: { id: "li-2", requiresShipping: true, product: { id: MUG } },
  },
  {
    id: "gid://shopify/FulfillmentOrderLineItem/3",
    remainingQuantity: 1,
    lineItem: { id: "li-3", requiresShipping: false, product: { id: HANDMADE_PDF } },
  },
  {
    id: "gid://shopify/FulfillmentOrderLineItem/4",
    remainingQuantity: 0,
    lineItem: { id: "li-4", requiresShipping: false, product: { id: FONT } },
  },
  {
    id: "gid://shopify/FulfillmentOrderLineItem/5",
    remainingQuantity: 1,
    lineItem: { id: "li-5", requiresShipping: false, product: null },
  },
]

describe("which lines are Fanwise's", () => {
  it("keeps only unfulfilled, unshipped lines whose product this connection published", () => {
    expect(fanwiseDigitalLines(order(MIXED), new Set([FONT]))).toEqual([
      { id: "gid://shopify/FulfillmentOrderLineItem/1", quantity: 2 },
    ])
  })

  it("keeps nothing when the connection published none of the products", () => {
    expect(fanwiseDigitalLines(order(MIXED), new Set())).toEqual([])
  })
})

function connection(overrides: Partial<ChannelConnection> = {}): ChannelConnection {
  return {
    id: "conn-1",
    workspace_id: "ws-1",
    channel_id: "chan-shopify",
    external_account_id: "aster-type.myshopify.com",
    external_account_name: "Aster Type",
    status: "active",
    scopes: [...SCOPES],
    metadata: { [DELIVERY_SETUP_CONFIRMED_KEY]: "2026-09-16T10:00:00Z" },
    last_verified_at: null,
    expires_at: null,
    created_at: "2026-09-16T10:00:00Z",
    updated_at: "2026-09-16T10:00:00Z",
    ...overrides,
  } as unknown as ChannelConnection
}

const EVENT = {
  id: "delivery-1",
  topic: ROUTING_COMPLETE_TOPIC,
  externalAccountId: "aster-type.myshopify.com",
  externalObjectId: "gid://shopify/FulfillmentOrder/77",
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

/** A Shopify that answers the two queries the handler makes, and records what it was sent. */
function stubShopify(state: FulfillmentOrderState | null, create?: unknown) {
  const calls: Array<{ query: string; variables: Record<string, unknown> }> = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init: RequestInit) => {
      const sent = JSON.parse(String(init.body)) as {
        query: string
        variables: Record<string, unknown>
      }
      calls.push(sent)
      if (sent.query.includes("FanwiseFulfillmentOrder")) {
        return jsonResponse({ data: { fulfillmentOrder: state } })
      }
      if (sent.query.includes("FanwiseFulfillmentCreate")) {
        return jsonResponse({
          data: {
            fulfillmentCreate: create ?? {
              fulfillment: { id: "gid://shopify/Fulfillment/500", status: "SUCCESS" },
              userErrors: [],
            },
          },
        })
      }
      throw new Error(`unexpected query: ${sent.query.slice(0, 60)}`)
    }),
  )
  return calls
}

function contextFor(conn: ChannelConnection, listingIds: string[] = [FONT]): WebhookContext {
  return { connection: conn, externalListingIds: async () => listingIds }
}

describe("acting on a delivery", () => {
  it("does nothing, and asks Shopify nothing, until the shop's email prints the link", async () => {
    const calls = stubShopify(order(MIXED))
    const result = await shopifyWebhooks.handle(EVENT, contextFor(connection({ metadata: {} })))
    expect(result).toEqual({ action: "skipped", reason: "delivery_setup_unconfirmed" })
    expect(calls).toHaveLength(0)
  })

  it("steps aside for a connection the Channels page is already asking to reconnect", async () => {
    const calls = stubShopify(order(MIXED))
    const result = await shopifyWebhooks.handle(
      EVENT,
      contextFor(connection({ scopes: ["write_products", "write_publications"] })),
    )
    expect(result).toEqual({ action: "skipped", reason: "reauthorization_needed" })
    expect(calls).toHaveLength(0)
  })

  it("marks exactly the Fanwise digital lines fulfilled on a paid mixed order", async () => {
    const calls = stubShopify(order(MIXED))
    const result = await shopifyWebhooks.handle(EVENT, contextFor(connection()))

    expect(result).toEqual({
      action: "fulfilled",
      externalFulfillmentId: "gid://shopify/Fulfillment/500",
      lineItemIds: ["gid://shopify/FulfillmentOrderLineItem/1"],
    })
    const create = calls.find((c) => c.query.includes("FanwiseFulfillmentCreate"))
    expect(create?.variables).toEqual({
      fulfillment: {
        lineItemsByFulfillmentOrder: [
          {
            fulfillmentOrderId: "gid://shopify/FulfillmentOrder/77",
            fulfillmentOrderLineItems: [
              { id: "gid://shopify/FulfillmentOrderLineItem/1", quantity: 2 },
            ],
          },
        ],
        // The buyer already holds the download; a parcel email would be a lie.
        notifyCustomer: false,
      },
      message: FULFILLMENT_MESSAGE,
    })
  })

  it("leaves an unpaid order alone, the way the email snippet does", async () => {
    for (const status of ["PENDING", "AUTHORIZED", "PARTIALLY_PAID", "REFUNDED", "VOIDED"]) {
      const calls = stubShopify(
        order(MIXED, { order: { id: "gid://shopify/Order/9", displayFinancialStatus: status } }),
      )
      const result = await shopifyWebhooks.handle(EVENT, contextFor(connection()))
      expect(result, status).toEqual({ action: "skipped", reason: "not_paid" })
      expect(
        calls.some((c) => c.query.includes("FanwiseFulfillmentCreate")),
        status,
      ).toBe(false)
    }
  })

  it("leaves a fulfillment order that is no longer open, or no longer there, alone", async () => {
    stubShopify(order(MIXED, { status: "CLOSED" }))
    expect(await shopifyWebhooks.handle(EVENT, contextFor(connection()))).toEqual({
      action: "skipped",
      reason: "not_open",
    })
    stubShopify(null)
    expect(await shopifyWebhooks.handle(EVENT, contextFor(connection()))).toEqual({
      action: "skipped",
      reason: "object_gone",
    })
  })

  it("does not touch an order with none of this connection's products on it", async () => {
    const calls = stubShopify(order(MIXED))
    const result = await shopifyWebhooks.handle(EVENT, contextFor(connection(), []))
    expect(result).toEqual({ action: "skipped", reason: "no_digital_lines" })
    expect(calls.some((c) => c.query.includes("FanwiseFulfillmentCreate"))).toBe(false)
  })

  it("normalizes a refusal from Shopify and never repeats its body to the creator", async () => {
    stubShopify(order(MIXED), {
      fulfillment: null,
      userErrors: [{ field: ["fulfillment"], message: "Fulfillment order is already closed." }],
    })
    await expect(shopifyWebhooks.handle(EVENT, contextFor(connection()))).rejects.toMatchObject({
      normalized: {
        code: "validation_rejected",
        message:
          "Shopify declined to mark the order fulfilled: Fulfillment order is already closed.",
        retryable: false,
      },
    })
  })
})

describe("the subscription at authorization time", () => {
  const URI = "https://fanwise.example/api/channels/shopify/webhook"

  function client(
    answer: (sent: { query: string; variables: Record<string, unknown> }) => unknown,
  ) {
    const calls: Array<{ query: string; variables: Record<string, unknown> }> = []
    const instance = createShopifyClient({
      shopDomain: "aster-type.myshopify.com",
      accessToken: "shpat-test-token",
      fetchImpl: (async (_url: unknown, init: RequestInit) => {
        const sent = JSON.parse(String(init.body)) as {
          query: string
          variables: Record<string, unknown>
        }
        calls.push(sent)
        return jsonResponse({ data: answer(sent) })
      }) as unknown as typeof fetch,
    })
    return { instance, calls }
  }

  it("reuses a subscription already pointed at this deployment", async () => {
    const { instance, calls } = client(() => ({
      webhookSubscriptions: {
        nodes: [
          {
            id: "gid://shopify/WebhookSubscription/1",
            topic: ROUTING_COMPLETE_TOPIC_ENUM,
            uri: URI,
          },
        ],
      },
    }))
    expect(await ensureRoutingWebhook(instance, URI)).toBe("gid://shopify/WebhookSubscription/1")
    expect(calls.some((c) => c.query.includes("FanwiseWebhookSubscribe"))).toBe(false)
  })

  it("creates one when the shop has none for this address", async () => {
    const { instance, calls } = client((sent) =>
      sent.query.includes("FanwiseWebhookSubscribe")
        ? {
            webhookSubscriptionCreate: {
              webhookSubscription: { id: "gid://shopify/WebhookSubscription/2" },
              userErrors: [],
            },
          }
        : {
            webhookSubscriptions: {
              nodes: [
                {
                  id: "gid://shopify/WebhookSubscription/9",
                  topic: ROUTING_COMPLETE_TOPIC_ENUM,
                  uri: "https://staging.example/api/channels/shopify/webhook",
                },
              ],
            },
          },
    )
    expect(await ensureRoutingWebhook(instance, URI)).toBe("gid://shopify/WebhookSubscription/2")
    const create = calls.find((c) => c.query.includes("FanwiseWebhookSubscribe"))
    expect(create?.variables).toEqual({
      topic: ROUTING_COMPLETE_TOPIC_ENUM,
      webhookSubscription: { uri: URI },
    })
  })

  it("reports a refusal as a normalized error, for the connection's metadata", async () => {
    const { instance } = client((sent) =>
      sent.query.includes("FanwiseWebhookSubscribe")
        ? {
            webhookSubscriptionCreate: {
              webhookSubscription: null,
              userErrors: [{ field: ["topic"], message: "Access denied for this topic." }],
            },
          }
        : { webhookSubscriptions: { nodes: [] } },
    )
    await expect(ensureRoutingWebhook(instance, URI)).rejects.toMatchObject({
      normalized: { code: "validation_rejected" },
    })
  })
})
