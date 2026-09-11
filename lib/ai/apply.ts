import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/supabase/database.types"
import { evaluate, listingToDraft, snapshotPayload } from "@/lib/channels/listings"
import { listingImages } from "@/lib/channels/images"
import type { AdapterSubject, ChannelAdapter, ChannelListing } from "@/lib/channels/types"
import type { ListingField, ListingOutput } from "./output"
import { COMPOSED_AT_KEY } from "./review"

/**
 * Putting model copy onto a listing, from either direction.
 *
 * The runner applies a fresh generation and the review screen restores an
 * earlier one, and the two must land the same way: the same columns, the same
 * `composedAt` stamp that makes Publish wait for a person, and a snapshot that
 * says which it was. One function, so they cannot drift.
 *
 * Takes whichever client the caller has. The runner holds the service role
 * and scopes the workspace itself; a restore runs as the signed-in user
 * through RLS, which is how restoring is authorized.
 */

export type ListingCopyColumns = Partial<{
  title: string | null
  description: string | null
  short_description: string | null
  seo_title: string | null
  seo_description: string | null
  tags: string[]
}>

const blank = (value: string) => (value.trim().length === 0 ? null : value.trim())

/** The columns one output writes. A partial output writes only its keys. */
export function outputToColumns(output: Partial<ListingOutput>): ListingCopyColumns {
  const columns: ListingCopyColumns = {}
  if (output.title !== undefined) columns.title = blank(output.title)
  if (output.description !== undefined) columns.description = blank(output.description)
  if (output.shortDescription !== undefined)
    columns.short_description = blank(output.shortDescription)
  if (output.seoTitle !== undefined) columns.seo_title = blank(output.seoTitle)
  if (output.seoDescription !== undefined) columns.seo_description = blank(output.seoDescription)
  if (output.tags !== undefined) columns.tags = output.tags
  return columns
}

/** The one key a field generation's output carries, or the whole output. */
export function outputFor(
  structured: unknown,
  field: ListingField | null,
): Partial<ListingOutput> | null {
  if (!structured || typeof structured !== "object") return null
  const record = structured as Record<string, unknown>
  if (field === null) return record as Partial<ListingOutput>
  if (!(field in record)) return null
  return { [field]: record[field] } as Partial<ListingOutput>
}

export interface ApplyCopyParams {
  client: SupabaseClient<Database>
  workspaceId: string
  listing: ChannelListing
  channel: { id: string }
  adapter: ChannelAdapter
  subject: AdapterSubject
  columns: ListingCopyColumns & { price?: number; currency?: string; category?: string }
  snapshot: {
    type: "generate" | "restore"
    /** Written under `payload.generation` or `payload.restore`. */
    record: Record<string, unknown>
  }
}

export type ApplyCopyOutcome =
  { ok: true; listing: ChannelListing; at: string } | { ok: false; reason: "update_failed" }

export async function applyCopy(params: ApplyCopyParams): Promise<ApplyCopyOutcome> {
  const { client, workspaceId, listing, channel, adapter, subject, columns, snapshot } = params
  const now = new Date().toISOString()

  const metadata = {
    ...((listing.metadata as Record<string, unknown>) ?? {}),
    [COMPOSED_AT_KEY]: now,
  }

  const { data: updated, error } = await client
    .from("channel_listings")
    .update({ ...columns, generated_at: now, metadata: metadata as never })
    .eq("id", listing.id)
    .eq("workspace_id", workspaceId)
    .select("*")
    .single()

  if (error || !updated) {
    console.error("[ai] could not apply copy to listing", { listingId: listing.id, error })
    return { ok: false, reason: "update_failed" }
  }

  const draft = listingToDraft(updated as ChannelListing)
  const evaluation = evaluate(adapter, draft, subject)

  // Invariant 4. The copy that landed, the verdict it received, and where it
  // came from: a generation, or a person restoring one.
  const { error: snapshotError } = await client.from("listing_snapshots").insert({
    workspace_id: workspaceId,
    channel_listing_id: listing.id,
    product_id: listing.product_id,
    channel_id: channel.id,
    snapshot_type: snapshot.type,
    payload: {
      ...snapshotPayload(draft, evaluation, listingImages(subject)),
      [snapshot.type === "generate" ? "generation" : "restore"]: { ...snapshot.record, at: now },
    } as never,
  })

  if (snapshotError) {
    // A gap in the history, not a broken listing. The copy is on the row.
    console.error("[ai] snapshot insert failed", snapshotError)
  }

  return { ok: true, listing: updated as ChannelListing, at: now }
}
