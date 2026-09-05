import { createClient } from "@/lib/supabase/server"
import { listProductAssets } from "@/lib/products/queries"
import { findAdapter } from "./registry"
import { evaluate, listingToDraft } from "./listings"
import type { Evaluation } from "./listings"
import type {
  AdapterSubject,
  Channel,
  ChannelAdapter,
  ChannelConnection,
  ChannelListing,
} from "./types"
import type { Product } from "@/lib/products/types"

/**
 * Reads run as the signed-in user, so RLS does the tenant filtering. None of
 * these can return another workspace's row even if a caller forgets to scope.
 *
 * channels is the exception and deliberately so: it is a global catalog, not
 * tenant data, and every signed-in user sees the same list.
 */

export async function listChannels(): Promise<Channel[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("channels")
    .select("*")
    .order("integration_type", { ascending: true })
    .order("name", { ascending: true })

  if (error) throw error
  return data ?? []
}

export interface ConnectionWithChannel {
  connection: ChannelConnection
  channel: Channel
  adapter: ChannelAdapter | null
}

export async function listConnections(workspaceId: string): Promise<ConnectionWithChannel[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("channel_connections")
    .select("*, channel:channels(*)")
    .eq("workspace_id", workspaceId)
    .order("connected_at", { ascending: true })

  if (error) throw error

  return (data ?? []).map((row) => {
    const { channel, ...connection } = row as ChannelConnection & { channel: Channel }
    return {
      connection,
      channel,
      // A channel row whose adapter has been removed from the registry degrades
      // to "not offered" rather than throwing. The consistency test makes this
      // unreachable in a healthy build; it stays because a page that lists
      // channels should not be the thing that breaks when one is retired.
      adapter: findAdapter(channel.key),
    }
  })
}

export interface ListingView {
  listing: ChannelListing
  channel: Channel
  connection: ChannelConnection | null
  adapter: ChannelAdapter | null
  evaluation: Evaluation | null
}

/**
 * Every listing for one product, each judged against its own channel's rules.
 *
 * The evaluation is computed here rather than stored. Requirements change when
 * an adapter changes, and a persisted readiness score would go stale silently:
 * the listing would keep claiming it was publishable under rules that no longer
 * exist.
 */
export async function listProductListings(
  product: Product,
  workspaceId: string,
): Promise<ListingView[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("channel_listings")
    .select("*, channel:channels(*), connection:channel_connections(*)")
    .eq("product_id", product.id)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true })

  if (error) throw error
  if (!data || data.length === 0) return []

  const assets = await listProductAssets(product.id)

  return data.map((row) => {
    const { channel, connection, ...listing } = row as ChannelListing & {
      channel: Channel
      connection: ChannelConnection | null
    }
    const adapter = findAdapter(channel.key)

    // The subject is built per listing rather than once, because a rule may
    // legitimately depend on the account a listing is bound to. Currency is the
    // first such rule: the same product on two storefronts selling in two
    // currencies is ready for one and not the other.
    const subject: AdapterSubject = {
      product,
      assets,
      connectionMetadata: (connection?.metadata as Record<string, unknown>) ?? {},
    }

    return {
      listing,
      channel,
      connection,
      adapter,
      evaluation: adapter ? evaluate(adapter, listingToDraft(listing), subject) : null,
    }
  })
}

export async function listSnapshots(channelListingId: string, limit = 20) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("listing_snapshots")
    .select("*")
    .eq("channel_listing_id", channelListingId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) throw error
  return data ?? []
}

/**
 * How many listings each connection holds that exist on the channel.
 *
 * "Published" here means `external_listing_id is not null` rather than a status
 * value, and that is the same test `disconnectChannelAction` applies. The two
 * have to agree: a page that decides with a different rule than the action it
 * is describing will eventually offer a button the server refuses, which is the
 * bug this was written for.
 */
export async function countPublishedByConnection(
  workspaceId: string,
): Promise<Map<string, number>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("channel_listings")
    .select("channel_connection_id")
    .eq("workspace_id", workspaceId)
    .not("external_listing_id", "is", null)

  if (error) throw error

  const counts = new Map<string, number>()
  for (const row of data ?? []) {
    const id = row.channel_connection_id
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}
