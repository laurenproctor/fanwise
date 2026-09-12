import { createClient } from "@/lib/supabase/server"
import { listProducts } from "@/lib/products/queries"
import { awaitingReview } from "@/lib/ai/review"
import { listingImageSlots } from "@/lib/channels/images"
import { evaluate, listingToDraft } from "@/lib/channels/listings"
import { findAdapter } from "@/lib/channels/registry"
import { hasUnsentChanges } from "@/lib/publishing/changes"
import { liveness, mergeManualSteps, type ManualStepRow } from "@/lib/publishing/manual-steps"
import type {
  AdapterSubject,
  Channel,
  ChannelConnection,
  ChannelListing,
} from "@/lib/channels/types"
import type { Product, ProductAsset } from "@/lib/products/types"
import type { CatalogListingFacts, CatalogFacts } from "./summary"

/**
 * Everything the catalog screen needs, for every product, in five reads.
 *
 * The product page loads one product's listings, steps and jobs and is right to
 * — it draws a card per channel and needs the detail. The catalog needs one
 * line per product, and asking the product page's questions once per row is the
 * N+1 that would make a twelve-product catalog forty-nine round trips. So each
 * table is read once for the whole workspace and grouped in memory.
 *
 * Every read runs as the signed-in user, so RLS does the tenant filtering; the
 * explicit `workspace_id` filters are there to make the intent legible to the
 * next reader, not to be the security boundary. Nothing here can return another
 * workspace's row even if a filter were dropped.
 *
 * What is deliberately not read: `publication_jobs`. The catalog reports a
 * failed publication from the listing's own status, which is what the runner
 * sets when it gives up, and the job's error message belongs on the card that
 * can show it in full rather than truncated into a table cell.
 */

/** One product, with the facts the catalog ranks and renders it on. */
export interface CatalogEntry {
  product: Product
  facts: CatalogFacts
  /** Every channel this product is live on, in the order the listings load. */
  liveChannelNames: string[]
  /**
   * The image the row shows, or null for a product with none ready.
   *
   * The first channel image slot, which is the cover, chosen by the same
   * comparator the adapters send images in. The row and the storefront
   * therefore lead with the same picture, rather than the catalog picking
   * whichever asset happened to sort first.
   */
  thumbnail: { assetId: string; filename: string } | null
}

export async function loadCatalog(workspaceId: string): Promise<CatalogEntry[]> {
  const products = await listProducts(workspaceId)
  // A workspace with no products asks no further questions. This is also what
  // keeps the first-run screen free: the page decides on this array's length.
  if (products.length === 0) return []

  const supabase = await createClient()

  const [assetRows, listingRows, stepRows, connectionRows] = await Promise.all([
    supabase
      .from("product_assets")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("channel_listings")
      .select("*, channel:channels(*)")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true }),
    supabase.from("listing_manual_steps").select("*").eq("workspace_id", workspaceId),
    supabase.from("channel_connections").select("*").eq("workspace_id", workspaceId),
  ])

  if (assetRows.error) throw assetRows.error
  if (listingRows.error) throw listingRows.error
  if (stepRows.error) throw stepRows.error
  if (connectionRows.error) throw connectionRows.error

  const assetsByProduct = groupBy(assetRows.data ?? [], (asset) => asset.product_id)
  const stepsByListing = groupBy(
    (stepRows.data ?? []) as ManualStepRow[],
    (step) => step.channel_listing_id,
  )
  const connectionsById = new Map(
    ((connectionRows.data ?? []) as ChannelConnection[]).map((row) => [row.id, row]),
  )

  const listingsByProduct = groupBy(
    (listingRows.data ?? []) as Array<ChannelListing & { channel: Channel }>,
    (listing) => listing.product_id,
  )

  return products.map((product) => {
    const assets = assetsByProduct.get(product.id) ?? []
    const listings = listingsByProduct.get(product.id) ?? []

    const facts: CatalogFacts = {
      listings: listings.flatMap((row) =>
        factsFor(row, product, assets, connectionsById, stepsByListing),
      ),
      assets: {
        preparing: assets.filter((asset) => asset.asset_state === "pending").length,
        failed: assets.filter((asset) => asset.asset_state === "failed").length,
      },
    }

    const cover = listingImageSlots(assets).find((asset) => asset.asset_state === "ready") ?? null

    return {
      product,
      facts,
      liveChannelNames: facts.listings
        .filter((listing) => listing.liveness === "live")
        .map((listing) => listing.channelName),
      thumbnail: cover ? { assetId: cover.id, filename: cover.filename } : null,
    }
  })
}

/**
 * One listing row, reduced to the facts `summarise()` ranks on.
 *
 * Readiness and unsent changes are computed here rather than read, for the
 * reason `listProductListings` gives: a stored readiness score is stale the
 * moment a requirement or the listing moves, and would have the catalog
 * offering Publish for a listing the channel would now reject.
 *
 * Returns nothing at all for a listing whose adapter has left the registry.
 * Nothing knows how to translate to that channel any more, so there is no
 * honest thing to say about it — the same degradation `listConnections` makes.
 */
function factsFor(
  row: ChannelListing & { channel: Channel },
  product: Product,
  assets: ProductAsset[],
  connectionsById: Map<string, ChannelConnection>,
  stepsByListing: Map<string, ManualStepRow[]>,
): CatalogListingFacts[] {
  const { channel, ...listing } = row
  const adapter = findAdapter(channel.key)
  if (!adapter) return []

  const connection = connectionsById.get(listing.channel_connection_id) ?? null

  // Built per listing rather than once per product, because a rule may depend
  // on the account the listing is bound to — currency is the first such rule.
  const subject: AdapterSubject = {
    product,
    assets,
    connectionMetadata: (connection?.metadata as Record<string, unknown>) ?? {},
  }

  const draft = listingToDraft(listing)
  const steps = mergeManualSteps(adapter.manualSteps, stepsByListing.get(listing.id) ?? [])

  return [
    {
      channelName: channel.name,
      liveness: liveness(listing, steps),
      ready: evaluate(adapter, draft, subject).readiness.ready,
      awaitingReview: awaitingReview(listing),
      unsentChanges: hasUnsentChanges(listing, draft, subject),
      canUpdate: adapter.capabilities.automaticUpdate && adapter.update !== undefined,
      canPublish: adapter.capabilities.automaticPublish && adapter.publish !== undefined,
    },
  ]
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const row of rows) {
    const id = key(row)
    const list = out.get(id) ?? []
    list.push(row)
    out.set(id, list)
  }
  return out
}
