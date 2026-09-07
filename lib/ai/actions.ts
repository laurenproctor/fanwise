"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { routes } from "@/lib/routes"
import { findAdapter } from "@/lib/channels/registry"
import { isAiConfigured } from "./providers"
import { startGeneration } from "./start"

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

export async function composeListingAction(
  workspaceSlug: string,
  listingId: string,
): Promise<ComposeState> {
  // Refused before a row exists, so a deployment with no model configured does
  // not accumulate pending generations nothing will ever run.
  if (!isAiConfigured()) {
    return { error: "Composing is not configured on this deployment.", notice: null }
  }

  const { supabase, user, workspace } = await requireWorkspace(workspaceSlug)

  const { data: listing, error: readError } = await supabase
    .from("channel_listings")
    .select("id, product_id, channel:channels(key), product:products(slug)")
    .eq("id", listingId)
    .eq("workspace_id", workspace.id)
    .maybeSingle()

  if (readError) throw readError
  if (!listing) return { error: "That listing could not be found.", notice: null }

  const channel = (listing as { channel: { key: string } | null }).channel
  const product = (listing as { product: { slug: string } | null }).product
  const adapter = channel ? findAdapter(channel.key) : null
  if (!adapter || !product) return { error: "That channel is not available.", notice: null }

  const outcome = await startGeneration({
    supabase,
    workspaceId: workspace.id,
    productId: listing.product_id,
    listingId,
    userId: user.id,
  })

  revalidatePath(routes.product(workspaceSlug, product.slug), "layout")

  switch (outcome.kind) {
    case "error":
      return { error: outcome.message, notice: null }
    case "already_running":
      return { error: null, notice: "This listing is already being composed.", composing: true }
    default:
      return {
        error: null,
        notice: `Composing for ${adapter.name}.`,
        composing: true,
      }
  }
}
