import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/supabase/database.types"

/**
 * The count that is the source of truth for the channel item's quantity.
 *
 * Every connection row counts while it exists, whatever its status. An
 * expired or revoked connection is still a connection the creator has not
 * removed; the channels page says so, and the way to stop being billed for it
 * is to disconnect it, which is the billing event.
 *
 * Takes a client rather than making one, so the settings page can ask as the
 * signed-in user under RLS and the sync job can ask as the service role with
 * the workspace it has already established.
 */
export async function countBillableConnections(
  client: SupabaseClient<Database>,
  workspaceId: string,
): Promise<number> {
  const { data, error } = await client
    .from("channel_connections")
    .select("id, channel:channels(billable)")
    .eq("workspace_id", workspaceId)

  if (error) throw error

  return (data ?? []).filter((row) => {
    const channel = (row as { channel: { billable: boolean } | null }).channel
    return channel?.billable === true
  }).length
}
