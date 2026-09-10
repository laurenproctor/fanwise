import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  RLS_DENIED,
  adminClient,
  anonClient,
  createActor,
  destroyActor,
  type Actor,
} from "./harness"
import type {
  BillingGateway,
  SetChannelQuantityParams,
  SubscriptionSnapshot,
} from "@/lib/billing/gateway"
import { BillingGatewayError } from "@/lib/billing/gateway"
import { syncBilling } from "@/lib/billing/sync"
import { processWebhookEvent } from "@/lib/billing/webhook"

/**
 * C1 at the database.
 *
 * Three things are proved here that no unit test can:
 *
 *   1. docs/billing.md rule 1. A connection row and its billing event are one
 *      transaction, because the trigger writes the event. Inserting a
 *      connection produces a pending ledger row with the key on it; deleting
 *      one produces the disconnection; deleting the workspace produces
 *      nothing and does not fail.
 *   2. Tenancy on the three new tables, in the denial shapes docs/security.md
 *      lists. The ledger and the billing row are readable by members and
 *      writable by nobody in the browser; the webhook receipts by nobody at
 *      all.
 *   3. The sync job against the real ledger, with the provider replaced by a
 *      script: the quantity it sets, the proration it chooses, the key it
 *      carries, and what it writes back on success and on each kind of
 *      failure.
 */

let alice: Actor
let bob: Actor
let billableChannelId: string
let freeChannelId: string | null

async function connect(actor: Actor, channelId: string, account: string): Promise<string> {
  const { data, error } = await actor.client
    .from("channel_connections")
    .insert({
      workspace_id: actor.workspaceId,
      channel_id: channelId,
      external_account_id: account,
    })
    .select("id")
    .single()
  if (error) throw new Error(`could not connect: ${error.message}`)
  return data.id
}

async function disconnect(actor: Actor, connectionId: string): Promise<void> {
  const { error } = await actor.client.from("channel_connections").delete().eq("id", connectionId)
  if (error) throw new Error(`could not disconnect: ${error.message}`)
}

async function ledger(actor: Actor) {
  const { data, error } = await actor.client
    .from("billing_events")
    .select("*")
    .eq("workspace_id", actor.workspaceId)
    .order("created_at", { ascending: true })
  if (error) throw error
  return data ?? []
}

async function clearLedger(workspaceId: string): Promise<void> {
  const admin = adminClient()
  await admin.from("billing_events").delete().eq("workspace_id", workspaceId)
}

/** A gateway that records what it was asked and answers from a script. */
function scriptedGateway(
  answer: (
    params: SetChannelQuantityParams,
  ) => Promise<{ channelItemId: string | null; quantity: number }>,
) {
  const calls: SetChannelQuantityParams[] = []
  const gateway: BillingGateway = {
    signatureHeader: "x-signature",
    ensureCustomer: async () => ({ customerId: "cus_scripted" }),
    createCheckoutSession: async () => ({ url: "https://example.test/checkout" }),
    createPortalSession: async () => ({ url: "https://example.test/portal" }),
    retrieveSubscription: async () => {
      throw new Error("not scripted")
    },
    setChannelQuantity: async (params) => {
      calls.push(params)
      const result = await answer(params)
      return { ...result, raw: { scripted: true } }
    },
    parseWebhook: () => {
      throw new Error("not scripted")
    },
  }
  return { gateway, calls }
}

async function subscribe(workspaceId: string, overrides: Record<string, unknown> = {}) {
  const admin = adminClient()
  const { error } = await admin.from("workspace_billing").upsert(
    {
      workspace_id: workspaceId,
      external_customer_id: `cus_${workspaceId}`,
      external_subscription_id: `sub_${workspaceId}`,
      subscription_status: "active",
      billing_interval: "month",
      base_item_id: "si_base",
      channel_item_id: null,
      channel_quantity: 0,
      period_peak_quantity: 0,
      current_period_start: "2026-09-01T00:00:00.000Z",
      current_period_end: "2026-10-01T00:00:00.000Z",
      ...overrides,
    },
    { onConflict: "workspace_id" },
  )
  if (error) throw new Error(`could not subscribe: ${error.message}`)
}

async function billingRow(workspaceId: string) {
  const { data, error } = await adminClient()
    .from("workspace_billing")
    .select("*")
    .eq("workspace_id", workspaceId)
    .single()
  if (error) throw error
  return data
}

beforeAll(async () => {
  const admin = adminClient()
  const { data: channels, error } = await admin.from("channels").select("id, key, billable")
  if (error) throw new Error(`could not read channels: ${error.message}`)

  // Chosen by the billable column rather than by name, because which mock
  // bills is the seed's decision and this suite is about what follows from it.
  billableChannelId = channels.find((c) => c.billable && c.key.startsWith("mock_"))!.id
  freeChannelId = channels.find((c) => !c.billable)?.id ?? null

  alice = await createActor("bill-alice")
  bob = await createActor("bill-bob")
})

afterAll(async () => {
  if (alice) await destroyActor(alice)
  if (bob) await destroyActor(bob)
})

describe("a connection and its billing event are one transaction", () => {
  it("writes a pending connection event with the key on it", async () => {
    await clearLedger(alice.workspaceId)
    const connectionId = await connect(alice, billableChannelId, "alice-shop-1")

    const events = await ledger(alice)
    expect(events).toHaveLength(1)
    const event = events[0]!
    expect(event.kind).toBe("channel_connected")
    expect(event.status).toBe("pending")
    expect(event.billable).toBe(true)
    expect(event.channel_connection_id).toBe(connectionId)
    expect(event.channel_id).toBe(billableChannelId)
    expect(event.idempotency_key).toBe(`billing_event:${event.id}`)
    expect(event.attempt_count).toBe(0)
  })

  it("writes the disconnection when the row is deleted", async () => {
    const connectionId = (await ledger(alice))[0]!.channel_connection_id
    await disconnect(alice, connectionId)

    const events = await ledger(alice)
    expect(events.map((e) => e.kind)).toEqual(["channel_connected", "channel_disconnected"])
    expect(events[1]!.channel_connection_id).toBe(connectionId)
  })

  it("captures billable from the channel, so an included channel is recorded free", async () => {
    if (!freeChannelId) return
    const connectionId = await connect(alice, freeChannelId, "alice-own-store")
    const event = (await ledger(alice)).find((e) => e.channel_connection_id === connectionId)
    expect(event?.billable).toBe(false)
    await disconnect(alice, connectionId)
  })

  it("does not fire on a reconnect that lands on the same row", async () => {
    await clearLedger(alice.workspaceId)
    const admin = adminClient()
    const first = await admin
      .from("channel_connections")
      .upsert(
        {
          workspace_id: alice.workspaceId,
          channel_id: billableChannelId,
          external_account_id: "alice-shop-2",
        },
        { onConflict: "workspace_id,channel_id,external_account_id" },
      )
      .select("id")
      .single()
    const second = await admin
      .from("channel_connections")
      .upsert(
        {
          workspace_id: alice.workspaceId,
          channel_id: billableChannelId,
          external_account_id: "alice-shop-2",
          external_account_name: "renamed",
        },
        { onConflict: "workspace_id,channel_id,external_account_id" },
      )
      .select("id")
      .single()
    expect(second.data?.id).toBe(first.data?.id)

    const events = await ledger(alice)
    expect(events.filter((e) => e.kind === "channel_connected")).toHaveLength(1)
    await admin.from("channel_connections").delete().eq("id", first.data!.id)
  })

  it("lets a workspace with connections be deleted", async () => {
    const doomed = await createActor("bill-doomed")
    await connect(doomed, billableChannelId, "doomed-shop")
    const { error } = await adminClient().from("workspaces").delete().eq("id", doomed.workspaceId)
    expect(error).toBeNull()

    const { data } = await adminClient()
      .from("billing_events")
      .select("id")
      .eq("workspace_id", doomed.workspaceId)
    expect(data).toEqual([])
    await adminClient().auth.admin.deleteUser(doomed.userId)
  })
})

describe("tenancy", () => {
  let aliceEventId: string

  beforeAll(async () => {
    await clearLedger(alice.workspaceId)
    const connectionId = await connect(alice, billableChannelId, "alice-shop-3")
    aliceEventId = (await ledger(alice))[0]!.id
    await disconnect(alice, connectionId)
    await subscribe(alice.workspaceId)
  })

  it("bob cannot see alice's ledger", async () => {
    const { data, error } = await bob.client.from("billing_events").select("*")
    expect(error).toBeNull()
    expect(data?.some((e) => e.workspace_id === alice.workspaceId)).toBe(false)
  })

  it("nobody in the browser writes the ledger, not even to their own workspace", async () => {
    const insert = await alice.client.from("billing_events").insert({
      workspace_id: alice.workspaceId,
      channel_connection_id: aliceEventId,
      channel_id: billableChannelId,
      kind: "channel_connected",
      billable: true,
      idempotency_key: "forged",
    })
    expect(insert.error?.code).toBe(RLS_DENIED)

    const update = await alice.client
      .from("billing_events")
      .update({ status: "applied" })
      .eq("id", aliceEventId)
    expect(update.error?.code).toBe(RLS_DENIED)

    const { data } = await adminClient()
      .from("billing_events")
      .select("status")
      .eq("id", aliceEventId)
      .single()
    expect(data?.status).toBe("pending")
  })

  it("alice reads her billing row and bob cannot", async () => {
    const mine = await alice.client.from("workspace_billing").select("*")
    expect(mine.error).toBeNull()
    expect(mine.data).toHaveLength(1)
    expect(mine.data?.[0]?.workspace_id).toBe(alice.workspaceId)

    const theirs = await bob.client
      .from("workspace_billing")
      .select("*")
      .eq("workspace_id", alice.workspaceId)
    expect(theirs.error).toBeNull()
    expect(theirs.data).toEqual([])
  })

  it("nobody in the browser writes a billing row", async () => {
    const insert = await bob.client
      .from("workspace_billing")
      .insert({ workspace_id: bob.workspaceId, external_customer_id: "cus_forged" })
    expect(insert.error?.code).toBe(RLS_DENIED)

    const update = await alice.client
      .from("workspace_billing")
      .update({ subscription_status: "canceled" })
      .eq("workspace_id", alice.workspaceId)
    expect(update.error?.code).toBe(RLS_DENIED)

    expect((await billingRow(alice.workspaceId)).subscription_status).toBe("active")
  })

  it("webhook receipts are unreachable from the browser and from anon", async () => {
    const signedIn = await alice.client.from("billing_webhook_events").select("*")
    expect(signedIn.error?.code).toBe(RLS_DENIED)
    const anon = await anonClient().from("billing_webhook_events").select("*")
    expect(anon.error?.code).toBe(RLS_DENIED)
    const ledgerAnon = await anonClient().from("billing_events").select("*")
    expect(ledgerAnon.error?.code).toBe(RLS_DENIED)
  })
})

describe("the sync job", () => {
  beforeAll(async () => {
    await clearLedger(alice.workspaceId)
    await adminClient().from("channel_connections").delete().eq("workspace_id", alice.workspaceId)
    await subscribe(alice.workspaceId)
  })

  it("leaves billable events pending while there is no subscription", async () => {
    await subscribe(bob.workspaceId, { subscription_status: "canceled" })
    const connectionId = await connect(bob, billableChannelId, "bob-shop-1")
    const { gateway, calls } = scriptedGateway(async () => {
      throw new Error("should not be called")
    })
    await syncBilling({ workspaceId: bob.workspaceId }, { gateway })
    expect(calls).toHaveLength(0)
    expect((await ledger(bob)).map((e) => e.status)).toEqual(["pending"])
    await disconnect(bob, connectionId)
    await clearLedger(bob.workspaceId)
  })

  it("prorates the first unit, carries the key, and records the item", async () => {
    await connect(alice, billableChannelId, "alice-shop-a")
    const { gateway, calls } = scriptedGateway(async (params) => ({
      channelItemId: "si_channel_new",
      quantity: params.quantity,
    }))

    await syncBilling({ workspaceId: alice.workspaceId }, { gateway })

    const events = await ledger(alice)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      subscriptionId: `sub_${alice.workspaceId}`,
      channelItemId: null,
      interval: "month",
      quantity: 1,
      proration: "prorate",
      idempotencyKey: `${events[0]!.idempotency_key}:a1`,
    })
    expect(events[0]!.status).toBe("applied")
    expect(events[0]!.attempt_count).toBe(1)
    expect(events[0]!.applied_at).not.toBeNull()

    const row = await billingRow(alice.workspaceId)
    expect(row.channel_quantity).toBe(1)
    expect(row.channel_item_id).toBe("si_channel_new")
    expect(row.period_peak_quantity).toBe(1)
  })

  it("collapses a burst into one call and marks the rest applied as no-ops", async () => {
    await connect(alice, billableChannelId, "alice-shop-b")
    await connect(alice, billableChannelId, "alice-shop-c")
    const { gateway, calls } = scriptedGateway(async (params) => ({
      channelItemId: "si_channel_new",
      quantity: params.quantity,
    }))

    await syncBilling({ workspaceId: alice.workspaceId }, { gateway })

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      channelItemId: "si_channel_new",
      quantity: 3,
      proration: "prorate",
    })
    const events = await ledger(alice)
    expect(events.map((e) => e.status)).toEqual(["applied", "applied", "applied"])
    expect(events[2]!.provider_response).toMatchObject({ noop: true, quantity: 3 })
    expect((await billingRow(alice.workspaceId)).period_peak_quantity).toBe(3)
  })

  it("never credits a decrement, and removes the item at zero", async () => {
    const { data: connections } = await adminClient()
      .from("channel_connections")
      .select("id")
      .eq("workspace_id", alice.workspaceId)
    for (const connection of connections ?? []) await disconnect(alice, connection.id)

    const { gateway, calls } = scriptedGateway(async (params) => ({
      channelItemId: params.quantity === 0 ? null : params.channelItemId,
      quantity: params.quantity,
    }))
    await syncBilling({ workspaceId: alice.workspaceId }, { gateway })

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      quantity: 0,
      proration: "none",
      channelItemId: "si_channel_new",
    })
    const row = await billingRow(alice.workspaceId)
    expect(row.channel_quantity).toBe(0)
    expect(row.channel_item_id).toBeNull()
    // The peak is what was paid for this period, and it survives the decrement.
    expect(row.period_peak_quantity).toBe(3)
  })

  it("does not prorate a reconnection up to the quantity already paid this period", async () => {
    await connect(alice, billableChannelId, "alice-shop-d")
    await connect(alice, billableChannelId, "alice-shop-e")
    const { gateway, calls } = scriptedGateway(async (params) => ({
      channelItemId: "si_channel_again",
      quantity: params.quantity,
    }))
    await syncBilling({ workspaceId: alice.workspaceId }, { gateway })

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ channelItemId: null, quantity: 2, proration: "none" })
  })

  it("marks an included channel skipped without calling the provider", async () => {
    if (!freeChannelId) return
    const connectionId = await connect(alice, freeChannelId, "alice-own-store-2")
    const { gateway, calls } = scriptedGateway(async () => {
      throw new Error("should not be called")
    })
    await syncBilling({ workspaceId: alice.workspaceId }, { gateway })
    expect(calls).toHaveLength(0)
    const event = (await ledger(alice)).find((e) => e.channel_connection_id === connectionId)
    expect(event?.status).toBe("skipped")
    await disconnect(alice, connectionId)
    await syncBilling({ workspaceId: alice.workspaceId }, { gateway })
  })

  it("keeps a transient failure pending, rethrows, and gives the retry a new key", async () => {
    await connect(alice, billableChannelId, "alice-shop-f")
    const failing = scriptedGateway(async () => {
      throw new BillingGatewayError("provider_unavailable", "down")
    })
    await expect(
      syncBilling({ workspaceId: alice.workspaceId }, { gateway: failing.gateway }),
    ).rejects.toBeInstanceOf(BillingGatewayError)

    const event = (await ledger(alice)).find(
      (e) => e.status !== "applied" && e.status !== "skipped",
    )!
    expect(event.status).toBe("pending")
    expect(event.attempt_count).toBe(1)
    expect(event.normalized_error_code).toBe("provider_unavailable")
    expect(failing.calls[0]!.idempotencyKey).toBe(`${event.idempotency_key}:a1`)

    const recovering = scriptedGateway(async (params) => ({
      channelItemId: "si_channel_again",
      quantity: params.quantity,
    }))
    await syncBilling({ workspaceId: alice.workspaceId }, { gateway: recovering.gateway })
    expect(recovering.calls[0]!.idempotencyKey).toBe(`${event.idempotency_key}:a2`)
    const after = (await ledger(alice)).find((e) => e.id === event.id)!
    expect(after.status).toBe("applied")
    expect(after.normalized_error_code).toBeNull()
  })

  it("records a permanent refusal as failed and stops", async () => {
    await connect(alice, billableChannelId, "alice-shop-g")
    const { gateway, calls } = scriptedGateway(async () => {
      throw new BillingGatewayError("invalid_request", "refused", { statusCode: 400 })
    })
    await syncBilling({ workspaceId: alice.workspaceId }, { gateway })
    expect(calls).toHaveLength(1)
    const event = (await ledger(alice)).at(-1)!
    expect(event.status).toBe("failed")
    expect(event.normalized_error_message).toBe("refused")
    expect(event.provider_response).toMatchObject({ statusCode: 400 })
  })
})

describe("a subscription webhook", () => {
  const snapshot = (overrides: Partial<SubscriptionSnapshot>): SubscriptionSnapshot => ({
    id: `sub_${bob.workspaceId}`,
    customerId: `cus_${bob.workspaceId}`,
    workspaceId: bob.workspaceId,
    status: "active",
    interval: "month",
    baseItemId: "si_base",
    channelItemId: "si_channel",
    channelQuantity: 2,
    currentPeriodStart: "2026-09-01T00:00:00.000Z",
    currentPeriodEnd: "2026-10-01T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    ...overrides,
  })
  const gateway = scriptedGateway(async () => {
    throw new Error("not used")
  }).gateway

  beforeAll(async () => {
    await adminClient().from("workspace_billing").delete().eq("workspace_id", bob.workspaceId)
  })

  it("mirrors the subscription onto the workspace it names", async () => {
    const outcome = await processWebhookEvent(
      { id: "evt_1", type: "subscription_changed", subscription: snapshot({}) },
      { gateway },
    )
    expect(outcome).toEqual({ handled: true, workspaceId: bob.workspaceId })
    const row = await billingRow(bob.workspaceId)
    expect(row.subscription_status).toBe("active")
    expect(row.channel_quantity).toBe(2)
    expect(row.period_peak_quantity).toBe(2)
    expect(row.channel_item_id).toBe("si_channel")
  })

  it("keeps the peak within a period and resets it when the period rolls", async () => {
    await processWebhookEvent(
      { id: "evt_2", type: "subscription_changed", subscription: snapshot({ channelQuantity: 1 }) },
      { gateway },
    )
    expect((await billingRow(bob.workspaceId)).period_peak_quantity).toBe(2)

    await processWebhookEvent(
      {
        id: "evt_3",
        type: "subscription_changed",
        subscription: snapshot({
          channelQuantity: 1,
          currentPeriodStart: "2026-10-01T00:00:00.000Z",
          currentPeriodEnd: "2026-11-01T00:00:00.000Z",
        }),
      },
      { gateway },
    )
    expect((await billingRow(bob.workspaceId)).period_peak_quantity).toBe(1)
  })

  it("attributes by customer when the subscription names no workspace", async () => {
    const outcome = await processWebhookEvent(
      {
        id: "evt_4",
        type: "subscription_changed",
        subscription: snapshot({ workspaceId: null, cancelAtPeriodEnd: true }),
      },
      { gateway },
    )
    expect(outcome.workspaceId).toBe(bob.workspaceId)
    expect((await billingRow(bob.workspaceId)).cancel_at_period_end).toBe(true)
  })

  it("ignores a subscription for nobody rather than inventing a row", async () => {
    const outcome = await processWebhookEvent(
      {
        id: "evt_5",
        type: "subscription_changed",
        subscription: snapshot({
          id: "sub_stranger",
          customerId: "cus_stranger",
          workspaceId: null,
        }),
      },
      { gateway },
    )
    expect(outcome).toEqual({ handled: false, workspaceId: null })
  })

  it("records a deletion as canceled", async () => {
    await processWebhookEvent(
      { id: "evt_6", type: "subscription_deleted", subscription: snapshot({ status: "canceled" }) },
      { gateway },
    )
    expect((await billingRow(bob.workspaceId)).subscription_status).toBe("canceled")
  })
})
