import { createHmac, timingSafeEqual } from "node:crypto"
import { z } from "zod"
import { isDeliverySetupConfirmed } from "@/lib/delivery/setup"
import { ChannelError, normalized } from "@/lib/channels/errors"
import type {
  ChannelWebhookEvent,
  ChannelWebhooks,
  WebhookContext,
  WebhookHandleResult,
} from "@/lib/channels/types"
import type { ShopifyClient } from "./client"
import { shopifyConfig, staleScopes } from "./config"
import { clientForConnection } from "./connection"
import { emptyPayload, fail } from "./errors"

/**
 * Marking a digital order fulfilled (ADR 0014).
 *
 * A Shopify product Fanwise publishes needs no shipping, so an order for one
 * sits in the admin as "Unfulfilled" until somebody clicks. The download
 * reached the buyer in the order email the moment they paid (ADR 0013), so the
 * click is bookkeeping, and this file does it.
 *
 * The trigger is the routing-complete webhook, which fires once per order when
 * Shopify has grouped its lines into fulfillment orders. It is not an orders
 * topic, so it needs none of Shopify's protected-customer-data approval, and
 * its payload is an id. Everything else is read back from the provider when
 * the job runs, and the read names line items, products and a status, never a
 * buyer.
 *
 * What gets fulfilled is exactly the lines that are Fanwise's: needing no
 * shipping, and whose product is a listing published through this
 * connection. A mug in the same order is left for the creator. And only on a
 * paid order — the email snippet gates on the same word — so a bank transfer
 * still pending is left alone too, the way ADR 0013 already treats its link.
 */

export const ROUTING_COMPLETE_TOPIC = "fulfillment_orders/order_routing_complete"
export const ROUTING_COMPLETE_TOPIC_ENUM = "FULFILLMENT_ORDERS_ORDER_ROUTING_COMPLETE"

const HMAC_HEADER = "x-shopify-hmac-sha256"
const TOPIC_HEADER = "x-shopify-topic"
const SHOP_HEADER = "x-shopify-shop-domain"
const DELIVERY_ID_HEADER = "x-shopify-webhook-id"

/**
 * docs/security.md rule 5. The signature is a base64 HMAC-SHA256 over the raw
 * body with the app's client secret, compared in constant time. Verified
 * before any header other than the signature is read for anything.
 */
export function verifyWebhookHmac(
  rawBody: string,
  header: string | null,
  clientSecret: string,
): boolean {
  if (!header) return false
  const expected = createHmac("sha256", clientSecret).update(rawBody, "utf8").digest()
  const given = Buffer.from(header, "base64")
  if (given.length !== expected.length) return false
  return timingSafeEqual(given, expected)
}

const routingPayloadSchema = z.object({
  fulfillment_order: z.object({ id: z.string().min(1) }),
})

/**
 * The delivery as an event, or null for a topic this adapter does not act on.
 *
 * A body that is not the shape the topic promises throws rather than
 * returning null, because "not for us" and "for us and unreadable" are
 * different facts, and the route records the second.
 */
export function parseWebhook(rawBody: string, headers: Headers): ChannelWebhookEvent | null {
  const topic = headers.get(TOPIC_HEADER)
  if (topic !== ROUTING_COMPLETE_TOPIC) return null

  const id = headers.get(DELIVERY_ID_HEADER)
  const shop = headers.get(SHOP_HEADER)
  if (!id || !shop) {
    fail(
      normalized("unknown", "Shopify sent a delivery without its id or shop headers.", {
        hasId: Boolean(id),
        hasShop: Boolean(shop),
      }),
    )
  }

  let raw: unknown
  try {
    raw = JSON.parse(rawBody)
  } catch {
    fail(normalized("unknown", "Shopify sent a delivery that was not JSON.", null))
  }
  const parsed = routingPayloadSchema.safeParse(raw)
  if (!parsed.success) {
    fail(
      normalized("unknown", "Shopify sent a delivery in a shape Fanwise does not recognize.", {
        issues: parsed.error.issues,
      }),
    )
  }

  return {
    id,
    topic,
    externalAccountId: shop.toLowerCase(),
    externalObjectId: parsed.data.fulfillment_order.id,
  }
}

/* ------------------------------------------------------------------------ */
/* The fulfillment order, read back                                          */
/* ------------------------------------------------------------------------ */

const FULFILLMENT_ORDER = `
  query FanwiseFulfillmentOrder($id: ID!) {
    fulfillmentOrder(id: $id) {
      id
      status
      order {
        id
        displayFinancialStatus
      }
      lineItems(first: 100) {
        nodes {
          id
          remainingQuantity
          lineItem {
            id
            requiresShipping
            product {
              id
            }
          }
        }
      }
    }
  }
`

const fulfillmentOrderLineSchema = z.object({
  id: z.string(),
  remainingQuantity: z.number().int(),
  lineItem: z
    .object({
      id: z.string(),
      requiresShipping: z.boolean(),
      product: z.object({ id: z.string() }).nullable(),
    })
    .nullable(),
})

export const fulfillmentOrderSchema = z.object({
  fulfillmentOrder: z
    .object({
      id: z.string(),
      status: z.string(),
      order: z.object({
        id: z.string(),
        displayFinancialStatus: z.string(),
      }),
      lineItems: z.object({ nodes: z.array(fulfillmentOrderLineSchema) }),
    })
    .nullable(),
})

export type FulfillmentOrderState = NonNullable<
  z.infer<typeof fulfillmentOrderSchema>["fulfillmentOrder"]
>

/** The statuses a fulfillment can still be created against. */
const FULFILLABLE = new Set(["OPEN", "IN_PROGRESS"])

/**
 * The lines Fanwise is answerable for and nothing else.
 *
 * Three tests, all of which must hold: something is left to fulfil, the line
 * needs no shipping, and its product is one this connection published. The
 * second alone would catch a gift card or a digital product the creator made
 * by hand in the admin, and marking those fulfilled would be Fanwise claiming
 * a delivery it did not make.
 */
export function fanwiseDigitalLines(
  order: FulfillmentOrderState,
  externalListingIds: ReadonlySet<string>,
): Array<{ id: string; quantity: number }> {
  return order.lineItems.nodes
    .filter((node) => node.remainingQuantity > 0)
    .filter((node) => node.lineItem !== null && node.lineItem.requiresShipping === false)
    .filter((node) => {
      const productId = node.lineItem?.product?.id
      return productId !== undefined && externalListingIds.has(productId)
    })
    .map((node) => ({ id: node.id, quantity: node.remainingQuantity }))
}

/* ------------------------------------------------------------------------ */
/* The fulfillment                                                           */
/* ------------------------------------------------------------------------ */

const FULFILLMENT_CREATE = `
  mutation FanwiseFulfillmentCreate($fulfillment: FulfillmentInput!, $message: String) {
    fulfillmentCreate(fulfillment: $fulfillment, message: $message) {
      fulfillment {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`

const fulfillmentCreateSchema = z.object({
  fulfillmentCreate: z.object({
    fulfillment: z.object({ id: z.string(), status: z.string() }).nullable(),
    userErrors: z.array(z.object({ field: z.array(z.string()).nullish(), message: z.string() })),
  }),
})

/**
 * Neither a shipment nor a notification. `notifyCustomer` is false because
 * the shop's "your order is on its way" email is written for a parcel, and
 * the buyer already holds the download from the order confirmation.
 */
export const FULFILLMENT_MESSAGE = "Delivered by download link, through Fanwise."

async function handleRoutingComplete(
  event: ChannelWebhookEvent,
  context: WebhookContext,
): Promise<WebhookHandleResult> {
  const { connection } = context
  const metadata = (connection.metadata as Record<string, unknown> | null) ?? undefined

  // The founder's rule: nothing is marked fulfilled unless the shop's email
  // prints the link, because that confirmation is what makes the order a
  // delivered one.
  if (!isDeliverySetupConfirmed(metadata)) {
    return { action: "skipped", reason: "delivery_setup_unconfirmed" }
  }
  // Skipped rather than thrown: a connection short of a scope is a state the
  // Channels page already explains, and a receipt should not carry a failure
  // for it.
  if (staleScopes(connection.scopes ?? []).length > 0) {
    return { action: "skipped", reason: "reauthorization_needed" }
  }

  const { client } = await clientForConnection(connection)
  const { fulfillmentOrder } = await client.request({
    query: FULFILLMENT_ORDER,
    variables: { id: event.externalObjectId },
    schema: fulfillmentOrderSchema,
  })

  if (!fulfillmentOrder) return { action: "skipped", reason: "object_gone" }
  if (!FULFILLABLE.has(fulfillmentOrder.status)) return { action: "skipped", reason: "not_open" }
  if (fulfillmentOrder.order.displayFinancialStatus !== "PAID") {
    return { action: "skipped", reason: "not_paid" }
  }

  const listingIds = new Set(await context.externalListingIds())
  const lines = fanwiseDigitalLines(fulfillmentOrder, listingIds)
  if (lines.length === 0) return { action: "skipped", reason: "no_digital_lines" }

  const result = await client.request({
    query: FULFILLMENT_CREATE,
    variables: {
      fulfillment: {
        lineItemsByFulfillmentOrder: [
          {
            fulfillmentOrderId: fulfillmentOrder.id,
            fulfillmentOrderLineItems: lines,
          },
        ],
        notifyCustomer: false,
      },
      message: FULFILLMENT_MESSAGE,
    },
    schema: fulfillmentCreateSchema,
  })

  const { fulfillment, userErrors } = result.fulfillmentCreate
  if (userErrors.length > 0) {
    const detail = userErrors[0]!.message.trim().replace(/\.$/, "")
    fail(
      normalized(
        "validation_rejected",
        `Shopify declined to mark the order fulfilled: ${detail}.`,
        userErrors,
      ),
    )
  }
  if (!fulfillment) fail(emptyPayload())

  return {
    action: "fulfilled",
    externalFulfillmentId: fulfillment.id,
    lineItemIds: lines.map((line) => line.id),
  }
}

export const shopifyWebhooks: ChannelWebhooks = {
  verify(rawBody, headers) {
    return verifyWebhookHmac(rawBody, headers.get(HMAC_HEADER), shopifyConfig().clientSecret)
  },
  parse: parseWebhook,
  handle: handleRoutingComplete,
}

/* ------------------------------------------------------------------------ */
/* The subscription, at authorization time                                   */
/* ------------------------------------------------------------------------ */

const SUBSCRIPTIONS = `
  query FanwiseWebhookSubscriptions($topics: [WebhookSubscriptionTopic!]) {
    webhookSubscriptions(first: 25, topics: $topics) {
      nodes {
        id
        topic
        uri
      }
    }
  }
`

const subscriptionsSchema = z.object({
  webhookSubscriptions: z.object({
    nodes: z.array(z.object({ id: z.string(), topic: z.string(), uri: z.string() })),
  }),
})

const SUBSCRIBE = `
  mutation FanwiseWebhookSubscribe(
    $topic: WebhookSubscriptionTopic!
    $webhookSubscription: WebhookSubscriptionInput!
  ) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
      webhookSubscription {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`

const subscribeSchema = z.object({
  webhookSubscriptionCreate: z.object({
    webhookSubscription: z.object({ id: z.string() }).nullable(),
    userErrors: z.array(z.object({ field: z.array(z.string()).nullish(), message: z.string() })),
  }),
})

/**
 * One subscription per shop, pointed at this deployment. Idempotent: an
 * existing subscription with the same address is reused, so a reconnect does
 * not stack a second delivery of every event. Shopify deletes a subscription
 * after eight consecutive failed deliveries, which is one more reason this
 * runs on every authorization rather than once.
 */
export async function ensureRoutingWebhook(client: ShopifyClient, uri: string): Promise<string> {
  const existing = await client.request({
    query: SUBSCRIPTIONS,
    variables: { topics: [ROUTING_COMPLETE_TOPIC_ENUM] },
    schema: subscriptionsSchema,
  })
  const match = existing.webhookSubscriptions.nodes.find((node) => node.uri === uri)
  if (match) return match.id

  const created = await client.request({
    query: SUBSCRIBE,
    variables: {
      topic: ROUTING_COMPLETE_TOPIC_ENUM,
      webhookSubscription: { uri },
    },
    schema: subscribeSchema,
  })
  const { webhookSubscription, userErrors } = created.webhookSubscriptionCreate
  if (userErrors.length > 0) {
    const detail = userErrors[0]!.message.trim().replace(/\.$/, "")
    throw new ChannelError(
      normalized(
        "validation_rejected",
        `Shopify would not let Fanwise subscribe to order events: ${detail}.`,
        userErrors,
      ),
    )
  }
  if (!webhookSubscription) fail(emptyPayload())
  return webhookSubscription.id
}
