import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/supabase/database.types"
import { findAdapter } from "@/lib/channels/registry"
import type { AdapterSubject, ChannelListing } from "@/lib/channels/types"
import type { Product, ProductAsset } from "@/lib/products/types"
import { applyCopy, outputFor, outputToColumns } from "./apply"
import { listingFieldSchema } from "./output"

/**
 * Restoring an earlier generation. Step B2.
 *
 * Runs as the signed-in user, through RLS: a member who cannot update the
 * listing is a member who may not restore onto it, and that is the database's
 * judgement. No model is called and nothing is validated again — the copy
 * being restored passed the validator when it was produced, against the facts
 * as they stood then, and the row still says which facts by hash.
 *
 * Restored copy is model copy. It stamps `composedAt` like a fresh generation
 * and Publish waits for approval the same way. A person choosing an earlier
 * draft has not yet said it is the one to ship.
 */

export type RestoreOutcome =
  { kind: "restored"; listingId: string; field: string | null } | { kind: "error"; message: string }

export async function restoreGeneration(params: {
  supabase: SupabaseClient<Database>
  workspaceId: string
  generationId: string
}): Promise<RestoreOutcome> {
  const { supabase, workspaceId, generationId } = params

  const { data: generation, error: generationError } = await supabase
    .from("ai_generations")
    .select("id, status, generation_type, field, structured_output, channel_listing_id, product_id")
    .eq("id", generationId)
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  if (generationError) throw generationError
  if (!generation) return { kind: "error", message: "That generation could not be found." }
  if (generation.status !== "succeeded" || !generation.structured_output) {
    return { kind: "error", message: "Only a generation that was accepted can be restored." }
  }

  const field =
    generation.generation_type === "field" ? listingFieldSchema.parse(generation.field) : null
  const output = outputFor(generation.structured_output, field)
  if (!output) return { kind: "error", message: "That generation holds nothing to restore." }

  const { data: listingRow, error: listingError } = await supabase
    .from("channel_listings")
    .select("*, channel:channels(id, key)")
    .eq("id", generation.channel_listing_id)
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  if (listingError) throw listingError
  if (!listingRow) return { kind: "error", message: "That listing could not be found." }

  const { channel, ...listing } = listingRow as ChannelListing & {
    channel: { id: string; key: string }
  }
  const adapter = findAdapter(channel.key)
  if (!adapter) return { kind: "error", message: "That channel is not available." }

  const { data: product } = await supabase
    .from("products")
    .select("*")
    .eq("id", generation.product_id)
    .eq("workspace_id", workspaceId)
    .maybeSingle()
  if (!product) return { kind: "error", message: "That product could not be found." }

  const { data: assets } = await supabase
    .from("product_assets")
    .select("*")
    .eq("product_id", generation.product_id)
    .eq("workspace_id", workspaceId)
    .order("sort_order", { ascending: true })

  const subject: AdapterSubject = {
    product: product as Product,
    assets: (assets ?? []) as ProductAsset[],
  }

  const applied = await applyCopy({
    client: supabase,
    workspaceId,
    listing,
    channel,
    adapter,
    subject,
    columns: outputToColumns(output),
    snapshot: { type: "restore", record: { generationId, field } },
  })

  if (!applied.ok) return { kind: "error", message: "That could not be restored. Try again." }
  return { kind: "restored", listingId: listing.id, field }
}
