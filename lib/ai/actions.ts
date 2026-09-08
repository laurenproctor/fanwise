"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { routes } from "@/lib/routes"
import { findAdapter } from "@/lib/channels/registry"
import { isAiConfigured } from "./providers"
import { startGeneration } from "./start"
import { restoreGeneration } from "./restore"
import { listingFieldSchema, LISTING_FIELD_LABELS } from "./output"

/**
 * Composing, from the creator's side.
 *
 * Re-establishes the caller and the workspace, like every action in the
 * product. "The page rendered the button" is not authorization
 * (docs/security.md rule 7), and this button spends money.
 */

export interface ComposeState {
  error: string | null
  notice: string | null
  /** True when a generation is now in flight and the page should watch it. */
  composing?: boolean
}

async function requireWorkspace(workspaceSlug: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/sign-in")

  const { data: workspace, error } = await supabase
    .from("workspaces")
    .select("id, slug")
    .eq("slug", workspaceSlug)
    .maybeSingle()

  if (error) throw error
  if (!workspace) redirect("/")

  return { supabase, user, workspace }
}

/** The listing, its channel's adapter and its product slug, or a message. */
async function loadForAction(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  listingId: string,
) {
  const { data: listing, error } = await supabase
    .from("channel_listings")
    .select("id, product_id, channel:channels(key), product:products(slug)")
    .eq("id", listingId)
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  if (error) throw error
  if (!listing) return { error: "That listing could not be found." as const }

  const channel = (listing as { channel: { key: string } | null }).channel
  const product = (listing as { product: { slug: string } | null }).product
  const adapter = channel ? findAdapter(channel.key) : null
  if (!adapter || !product) return { error: "That channel is not available." as const }

  return { error: null, listing, adapter, productSlug: product.slug }
}

export async function composeListingAction(
  workspaceSlug: string,
  listingId: string,
): Promise<ComposeState> {
  return regenerate(workspaceSlug, listingId, undefined)
}

/**
 * Regenerates one field. Step B2.
 *
 * The same path as composing the whole listing, narrowed: one generation row
 * with the field on it, one job, the same validator on the one value that
 * comes back. The field name arrives from the browser and is parsed before it
 * reaches a row.
 */
export async function regenerateFieldAction(
  workspaceSlug: string,
  listingId: string,
  field: string,
): Promise<ComposeState> {
  const parsed = listingFieldSchema.safeParse(field)
  if (!parsed.success) return { error: "That field cannot be regenerated.", notice: null }
  return regenerate(workspaceSlug, listingId, parsed.data)
}

async function regenerate(
  workspaceSlug: string,
  listingId: string,
  field: ReturnType<typeof listingFieldSchema.parse> | undefined,
): Promise<ComposeState> {
  // Refused before a row exists, so a deployment with no model configured does
  // not accumulate pending generations nothing will ever run.
  if (!isAiConfigured()) {
    return { error: "Composing is not configured on this deployment.", notice: null }
  }

  const { supabase, user, workspace } = await requireWorkspace(workspaceSlug)

  const loaded = await loadForAction(supabase, workspace.id, listingId)
  if (loaded.error) return { error: loaded.error, notice: null }
  const { listing, adapter, productSlug } = loaded

  const outcome = await startGeneration({
    supabase,
    workspaceId: workspace.id,
    productId: listing.product_id,
    listingId,
    userId: user.id,
    ...(field === undefined ? {} : { field }),
  })

  revalidatePath(routes.product(workspaceSlug, productSlug), "layout")

  const what = field === undefined ? "listing" : LISTING_FIELD_LABELS[field].toLowerCase()

  switch (outcome.kind) {
    case "error":
      return { error: outcome.message, notice: null }
    case "already_running":
      return { error: null, notice: "This listing is already being composed.", composing: true }
    default:
      return {
        error: null,
        notice:
          field === undefined
            ? `Composing for ${adapter.name}.`
            : `Composing a new ${what} for ${adapter.name}.`,
        composing: true,
      }
  }
}

export interface ReviewState {
  error: string | null
  notice: string | null
}

/**
 * Puts an earlier generation's copy back on the listing. Step B2.
 *
 * No model, no job: the copy already exists on the generation row and passed
 * the validator when it was made. Runs as the signed-in user through RLS, and
 * the restored copy waits for approval like a fresh generation would.
 */
export async function restoreGenerationAction(
  workspaceSlug: string,
  listingId: string,
  generationId: string,
): Promise<ReviewState> {
  const { supabase, workspace } = await requireWorkspace(workspaceSlug)

  const loaded = await loadForAction(supabase, workspace.id, listingId)
  if (loaded.error) return { error: loaded.error, notice: null }

  const outcome = await restoreGeneration({ supabase, workspaceId: workspace.id, generationId })
  if (outcome.kind === "error") return { error: outcome.message, notice: null }
  if (outcome.listingId !== listingId) {
    return { error: "That generation belongs to another listing.", notice: null }
  }

  revalidatePath(routes.product(workspaceSlug, loaded.productSlug), "layout")
  return {
    error: null,
    notice:
      outcome.field === null
        ? "Restored. Read it before you publish."
        : `Restored the ${LISTING_FIELD_LABELS[listingFieldSchema.parse(outcome.field)].toLowerCase()}. Read it before you publish.`,
  }
}
