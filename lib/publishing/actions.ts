"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { evaluate, listingToDraft } from "@/lib/channels/listings"
import { findAdapter } from "@/lib/channels/registry"
import type { AdapterSubject, Channel, ChannelListing } from "@/lib/channels/types"
import type { Product, ProductAsset } from "@/lib/products/types"
import { mergeManualSteps, readyToActivate } from "./manual-steps"
import { startPublication } from "./start"

/**
 * Publishing, from the creator's side.
 *
 * Every action re-establishes the caller and the workspace. "The page rendered
 * the button" is not authorization (docs/security.md rule 7), and it is
 * especially not authorization for the one action in the product that spends
 * someone else's money and puts their name on a storefront.
 */

export interface PublishState {
  error: string | null
  notice: string | null
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

/** Everything the publish path needs, loaded once and scoped to the workspace. */
async function loadListing(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  listingId: string,
) {
  const { data, error } = await supabase
    .from("channel_listings")
    .select("*, channel:channels(*), connection:channel_connections(*)")
    .eq("id", listingId)
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const { channel, connection, ...listing } = data as ChannelListing & {
    channel: Channel
    connection: { metadata: unknown; status: string } | null
  }

  const { data: product } = await supabase
    .from("products")
    .select("*")
    .eq("id", listing.product_id)
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  if (!product) return null

  const { data: assets } = await supabase
    .from("product_assets")
    .select("*")
    .eq("product_id", listing.product_id)
    .eq("workspace_id", workspaceId)

  const subject: AdapterSubject = {
    product: product as Product,
    assets: (assets ?? []) as ProductAsset[],
    connectionMetadata: (connection?.metadata as Record<string, unknown>) ?? {},
  }

  return { listing, channel, connection, product: product as Product, subject }
}

/**
 * Publishes one listing to one channel.
 *
 * Three refusals before anything is queued, in increasing order of how much it
 * would cost to get them wrong: a channel that cannot publish, a connection
 * that is not usable, and a listing the channel would reject. The third is the
 * important one. Readiness is recomputed here rather than trusted from the page
 * that rendered the button, because the button was rendered from a snapshot of
 * the world that may be minutes old, and publishing a listing that fails its
 * own requirements is how a creator finds out about a rule from a marketplace
 * rejection email instead of from Fanwise.
 */
export async function publishListingAction(
  workspaceSlug: string,
  listingId: string,
): Promise<PublishState> {
  const { supabase, workspace } = await requireWorkspace(workspaceSlug)

  const loaded = await loadListing(supabase, workspace.id, listingId)
  if (!loaded) return { error: "That listing could not be found.", notice: null }

  const { listing, channel, connection, product, subject } = loaded

  const adapter = findAdapter(channel.key)
  if (!adapter) return { error: "That channel is not available.", notice: null }

  // The UI does not offer this on a channel that cannot do it, and the server
  // refuses it anyway. An assisted channel has no publish method at all, so
  // this is the line that turns a crafted request into a message rather than a
  // TypeError.
  if (!adapter.capabilities.automaticPublish || !adapter.publish) {
    return {
      error: `${adapter.name} cannot be published to automatically. You submit this listing yourself.`,
      notice: null,
    }
  }

  if (!connection || connection.status !== "active") {
    return {
      error: `${adapter.name} is not connected. Reconnect it and try again.`,
      notice: null,
    }
  }

  const draft = listingToDraft(listing)
  const { readiness } = evaluate(adapter, draft, subject)
  if (!readiness.ready) {
    const first = readiness.blocking[0]
    return {
      error:
        readiness.blocking.length === 1
          ? `This listing is not ready: ${first?.message ?? first?.label}`
          : `This listing has ${readiness.blocking.length} things to fix before it can be published.`,
      notice: null,
    }
  }

  const outcome = await startPublication({
    supabase,
    workspaceId: workspace.id,
    listingId,
    kind: "publish",
    draft,
  })

  if (outcome.kind === "error") return { error: outcome.message, notice: null }

  if (outcome.kind === "started" || outcome.kind === "retried") {
    // Only now, and only after the job row exists. A listing marked publishing
    // with no job behind it is a listing stuck on a spinner forever.
    await supabase
      .from("channel_listings")
      .update({ status: "publishing" })
      .eq("id", listingId)
      .eq("workspace_id", workspace.id)
  }

  revalidatePath(`/w/${workspaceSlug}/products/${product.slug}`, "layout")

  switch (outcome.kind) {
    case "already_done":
      return { error: null, notice: `This listing is already published to ${adapter.name}.` }
    case "already_running":
      return { error: null, notice: "This listing is already being published." }
    case "retried":
      return { error: null, notice: `Trying ${adapter.name} again.` }
    default:
      return { error: null, notice: `Publishing to ${adapter.name}.` }
  }
}

/**
 * Records that a human did something the channel's API cannot do.
 *
 * ADR 0001's file step is the only instance at A5. Completing the last step
 * that gates activation is what takes the provider object live, so this is a
 * two-part action: a claim by a person, and then an external write that trusts
 * the claim. It is trusted because there is nothing to verify it against, which
 * is exactly why the product was created as a draft rather than live.
 */
export async function completeManualStepAction(
  workspaceSlug: string,
  listingId: string,
  stepKey: string,
): Promise<PublishState> {
  const { supabase, user, workspace } = await requireWorkspace(workspaceSlug)

  const loaded = await loadListing(supabase, workspace.id, listingId)
  if (!loaded) return { error: "That listing could not be found.", notice: null }

  const { listing, channel, product } = loaded

  const adapter = findAdapter(channel.key)
  if (!adapter) return { error: "That channel is not available.", notice: null }

  const spec = adapter.manualSteps.find((step) => step.key === stepKey)
  if (!spec) return { error: "That step does not exist on this channel.", notice: null }

  // A step is work outstanding on something that exists. Completing one against
  // a listing that was never published would activate nothing and record a
  // claim about a product the channel has never seen.
  if (listing.status !== "published" || !listing.external_listing_id) {
    return { error: "Publish this listing before completing its steps.", notice: null }
  }

  const { error: upsertError } = await supabase.from("listing_manual_steps").upsert(
    {
      workspace_id: workspace.id,
      channel_listing_id: listingId,
      step_key: stepKey,
      completed_at: new Date().toISOString(),
      completed_by: user.id,
    },
    { onConflict: "channel_listing_id,step_key" },
  )

  if (upsertError) {
    console.error("[publishing] could not complete manual step", upsertError)
    return { error: "That could not be saved. Try again.", notice: null }
  }

  const { data: rows } = await supabase
    .from("listing_manual_steps")
    .select("*")
    .eq("channel_listing_id", listingId)
    .eq("workspace_id", workspace.id)

  const states = mergeManualSteps(adapter.manualSteps, rows ?? [])
  revalidatePath(`/w/${workspaceSlug}/products/${product.slug}`, "layout")

  if (!readyToActivate(states) || !adapter.activate) {
    return { error: null, notice: "Step marked done." }
  }

  const outcome = await startPublication({
    supabase,
    workspaceId: workspace.id,
    listingId,
    kind: "activate",
    draft: listingToDraft(listing),
  })

  if (outcome.kind === "error") {
    return {
      error: `That step was saved, but ${adapter.name} could not be told to take the product live. Try again.`,
      notice: null,
    }
  }

  return { error: null, notice: `Taking the product live on ${adapter.name}.` }
}
