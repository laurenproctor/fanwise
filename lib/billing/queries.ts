import { createClient } from "@/lib/supabase/server"
import type { Database } from "@/lib/supabase/database.types"
import { countBillableConnections } from "./connections"
import { gateway } from "./providers"
import { billingState, type BillingState } from "./state"

export type WorkspaceBillingRow = Database["public"]["Tables"]["workspace_billing"]["Row"]
export type BillingEventRow = Database["public"]["Tables"]["billing_events"]["Row"]

/**
 * Reads run as the signed-in user, so RLS does the tenant filtering. The
 * billing row and the ledger are both readable by members and writable by
 * nobody in the browser, which is what lets these be plain selects.
 */

export interface BillingOverview {
  state: BillingState
  billableConnections: number
  hasCustomer: boolean
}

export async function getBillingOverview(workspace: {
  id: string
  created_at: string
}): Promise<BillingOverview> {
  const supabase = await createClient()

  const [{ data: row, error }, billableConnections] = await Promise.all([
    supabase.from("workspace_billing").select("*").eq("workspace_id", workspace.id).maybeSingle(),
    countBillableConnections(supabase, workspace.id),
  ])
  if (error) throw error

  return {
    state: billingState({
      configured: gateway() !== null,
      row,
      workspaceCreatedAt: workspace.created_at,
    }),
    billableConnections,
    hasCustomer: !!row?.external_customer_id,
  }
}

export interface LedgerEntry {
  id: string
  kind: BillingEventRow["kind"]
  status: BillingEventRow["status"]
  billable: boolean
  channelName: string
  createdAt: string
  message: string | null
}

/** The most recent ledger rows, newest first, with the channel named. */
export async function listBillingLedger(workspaceId: string, limit = 10): Promise<LedgerEntry[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("billing_events")
    .select(
      "id, kind, status, billable, created_at, normalized_error_message, channel:channels(name)",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) throw error

  return (data ?? []).map((row) => {
    const channel = (row as { channel: { name: string } | null }).channel
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      billable: row.billable,
      channelName: channel?.name ?? "A channel",
      createdAt: row.created_at,
      message: row.normalized_error_message,
    }
  })
}
