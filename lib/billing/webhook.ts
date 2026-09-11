import { createAdminClient } from "@/lib/supabase/admin"
import { jobs } from "@/lib/jobs"
import type { BillingGateway, SubscriptionSnapshot, WebhookEvent } from "./gateway"

/**
 * What a provider event does to Fanwise's record.
 *
 * Runs as the service role, from the webhook route, and scopes the workspace
 * itself: the subscription names its workspace in metadata the checkout
 * wrote, and a subscription that names none is attributed by customer. One
 * that matches neither is Fanwise's to ignore, because nothing here is
 * allowed to create a workspace's billing row from a stranger's event.
 *
 * Every write here is a mirror of what the provider just said. The one piece
 * of state that is Fanwise's own is period_peak_quantity, which resets when
 * the period rolls, because the units paid for last period are not paid for
 * this one.
 */

export interface WebhookOutcome {
  handled: boolean
  workspaceId: string | null
}

export async function processWebhookEvent(
  event: WebhookEvent,
  deps: { gateway: BillingGateway },
): Promise<WebhookOutcome> {
  switch (event.type) {
    case "subscription_changed":
    case "subscription_deleted":
      return applySubscription(event.subscription)
    case "checkout_completed": {
      // The subscription's own event usually lands first and carries
      // everything. This is the belt to that brace: if the subscription event
      // was missed, the checkout still lands.
      if (!event.subscriptionId) return { handled: false, workspaceId: null }
      const subscription = await deps.gateway.retrieveSubscription(event.subscriptionId)
      return applySubscription(subscription)
    }
    case "ignored":
      return { handled: false, workspaceId: null }
  }
}

async function applySubscription(subscription: SubscriptionSnapshot): Promise<WebhookOutcome> {
  const admin = createAdminClient()

  const workspaceId = await attributeWorkspace(admin, subscription)
  if (!workspaceId) {
    console.warn("[billing] subscription for no known workspace", {
      subscriptionId: subscription.id,
    })
    return { handled: false, workspaceId: null }
  }

  const { data: existing, error: readError } = await admin
    .from("workspace_billing")
    .select("external_subscription_id, current_period_start, period_peak_quantity")
    .eq("workspace_id", workspaceId)
    .maybeSingle()
  if (readError) throw readError

  // A newer subscription replaces an older one; an older one's late webhook
  // must not overwrite the newer. The ids are opaque, so "newer" is "the one
  // the row already names, or the row names none".
  if (
    existing?.external_subscription_id &&
    existing.external_subscription_id !== subscription.id &&
    subscription.status === "canceled"
  ) {
    return { handled: false, workspaceId }
  }

  // Compared as instants, not strings: the database hands back a timestamp
  // in its own notation and the provider in ISO 8601.
  const periodRolled =
    !existing ||
    existing.external_subscription_id !== subscription.id ||
    instant(existing.current_period_start) !== instant(subscription.currentPeriodStart)
  const peak = periodRolled
    ? subscription.channelQuantity
    : Math.max(existing.period_peak_quantity, subscription.channelQuantity)

  const { error: writeError } = await admin.from("workspace_billing").upsert(
    {
      workspace_id: workspaceId,
      external_customer_id: subscription.customerId || null,
      external_subscription_id: subscription.id,
      subscription_status: subscription.status,
      billing_interval: subscription.interval,
      base_item_id: subscription.baseItemId,
      channel_item_id: subscription.channelItemId,
      channel_quantity: subscription.channelQuantity,
      period_peak_quantity: peak,
      current_period_start: subscription.currentPeriodStart,
      current_period_end: subscription.currentPeriodEnd,
      cancel_at_period_end: subscription.cancelAtPeriodEnd,
    },
    { onConflict: "workspace_id" },
  )
  if (writeError) throw writeError

  // Whatever the ledger holds pending now has a subscription to land on, or
  // has just lost one. Either way the sync job decides.
  await jobs.enqueue("sync_billing", { workspaceId })

  return { handled: true, workspaceId }
}

function instant(value: string | null): number | null {
  return value ? new Date(value).getTime() : null
}

async function attributeWorkspace(
  admin: ReturnType<typeof createAdminClient>,
  subscription: SubscriptionSnapshot,
): Promise<string | null> {
  if (subscription.workspaceId) {
    const { data } = await admin
      .from("workspaces")
      .select("id")
      .eq("id", subscription.workspaceId)
      .maybeSingle()
    if (data) return data.id
  }
  if (subscription.customerId) {
    const { data } = await admin
      .from("workspace_billing")
      .select("workspace_id")
      .eq("external_customer_id", subscription.customerId)
      .maybeSingle()
    if (data) return data.workspace_id
  }
  return null
}
