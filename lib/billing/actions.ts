"use server"

import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { appOrigin } from "@/lib/channels/oauth"
import { routes } from "@/lib/routes"
import { countBillableConnections } from "./connections"
import { normalizeBillingError, type BillingInterval } from "./gateway"
import { gateway } from "./providers"
import { customerKey, isLiveSubscription } from "./rules"

export type BillingRedirect = { error: string; url?: undefined } | { error: null; url: string }

const NOT_CONFIGURED = "Billing is not configured on this deployment yet. Nothing was changed."

/**
 * Every action here re-establishes who the caller is and which workspace
 * they are acting in. "The page rendered the button" is not authorization
 * (docs/security.md rule 7). Both return the provider's URL rather than
 * redirecting to it, for the reason beginAuthorizationAction does: a server
 * action that redirects off-site is one whose failures are invisible.
 */
async function requireWorkspace(workspaceSlug: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/sign-in")

  const { data: workspace, error } = await supabase
    .from("workspaces")
    .select("id, slug, name")
    .eq("slug", workspaceSlug)
    .maybeSingle()

  if (error) throw error
  if (!workspace) redirect("/")

  return { user, workspace }
}

function settingsUrl(workspaceSlug: string, outcome: "subscribed" | "canceled" | "portal"): string {
  const url = new URL(routes.settings(workspaceSlug), appOrigin())
  url.searchParams.set("billing", outcome)
  return url.toString()
}

/**
 * Starts a checkout for the base subscription plus the channels connected
 * now.
 *
 * The customer is created first and its id persisted before the checkout
 * page is built, under an idempotency key derived from the workspace, so two
 * clicks make one customer and a workspace that returns later is the same
 * customer with its history. The row is written through the service role
 * because authenticated holds no insert on it: it is Fanwise's account of an
 * external fact, and it is scoped here to the workspace just established.
 */
export async function startCheckoutAction(
  workspaceSlug: string,
  interval: BillingInterval,
): Promise<BillingRedirect> {
  const provider = gateway()
  if (!provider) return { error: NOT_CONFIGURED }
  if (interval !== "month" && interval !== "year") return { error: "Choose monthly or annual." }

  const { user, workspace } = await requireWorkspace(workspaceSlug)
  const admin = createAdminClient()

  const { data: row, error: rowError } = await admin
    .from("workspace_billing")
    .select("external_customer_id, subscription_status")
    .eq("workspace_id", workspace.id)
    .maybeSingle()
  if (rowError) throw rowError

  if (row && isLiveSubscription(row.subscription_status)) {
    return {
      error: "This workspace already has a subscription. Manage it from the billing portal.",
    }
  }

  try {
    let customerId = row?.external_customer_id ?? null
    if (!customerId) {
      const created = await provider.ensureCustomer({
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        email: user.email ?? null,
        idempotencyKey: customerKey(workspace.id),
      })
      customerId = created.customerId

      const { error: upsertError } = await admin
        .from("workspace_billing")
        .upsert(
          { workspace_id: workspace.id, external_customer_id: customerId },
          { onConflict: "workspace_id" },
        )
      if (upsertError) throw upsertError
    }

    const channelQuantity = await countBillableConnections(admin, workspace.id)

    const session = await provider.createCheckoutSession({
      customerId,
      workspaceId: workspace.id,
      interval,
      channelQuantity,
      successUrl: settingsUrl(workspace.slug, "subscribed"),
      cancelUrl: settingsUrl(workspace.slug, "canceled"),
    })
    return { error: null, url: session.url }
  } catch (error) {
    const normalized = normalizeBillingError(error)
    console.error("[billing] checkout could not start", {
      workspaceId: workspace.id,
      code: normalized.code,
    })
    return { error: normalized.message }
  }
}

/**
 * Opens the provider's portal, where the creator changes their card, switches
 * interval, downloads invoices, or cancels. Fanwise builds none of those
 * screens; it learns what happened from the webhook.
 */
export async function openBillingPortalAction(workspaceSlug: string): Promise<BillingRedirect> {
  const provider = gateway()
  if (!provider) return { error: NOT_CONFIGURED }

  const { workspace } = await requireWorkspace(workspaceSlug)
  const admin = createAdminClient()

  const { data: row, error: rowError } = await admin
    .from("workspace_billing")
    .select("external_customer_id")
    .eq("workspace_id", workspace.id)
    .maybeSingle()
  if (rowError) throw rowError

  if (!row?.external_customer_id) {
    return { error: "There is nothing to manage yet. Subscribe first." }
  }

  try {
    const session = await provider.createPortalSession({
      customerId: row.external_customer_id,
      returnUrl: settingsUrl(workspace.slug, "portal"),
    })
    return { error: null, url: session.url }
  } catch (error) {
    const normalized = normalizeBillingError(error)
    console.error("[billing] portal could not open", {
      workspaceId: workspace.id,
      code: normalized.code,
    })
    return { error: normalized.message }
  }
}
