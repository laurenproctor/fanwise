"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { listProductAssets } from "@/lib/products/queries"
import { buildDraft, draftToColumns, evaluate, snapshotPayload } from "./listings"
import { findAdapter } from "./registry"
import { updateListingSchema } from "./schemas"
import { callbackUrl, createAuthorizationState } from "./oauth"
import type { AdapterSubject, ChannelListingDraft } from "./types"

export interface ActionState {
  error: string | null
}

/**
 * Save state for the listing editor. `savedAt` exists so the UI can confirm a
 * save actually happened, matching the product form: a form that silently
 * accepts changes leaves the creator unsure whether their edit landed.
 */
export interface SaveState {
  error: string | null
  savedAt: number | null
}

const UNIQUE_VIOLATION = "23505"

/**
 * Every action here re-establishes who the caller is and which workspace they
 * are acting in. "The page rendered the button" is not authorization
 * (docs/security.md rule 7).
 */
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

/**
 * Connects a channel.
 *
 * This is the path for a channel with no authorization to perform, which since
 * A5 means the mocks only. A real channel goes through
 * beginAuthorizationAction and the callback route, which write the same
 * connection row plus a sealed credential.
 *
 * At C1 this becomes a billing event in the same transaction as the row, per
 * docs/billing.md rule 1. It is not one yet, and pretending otherwise by
 * writing a placeholder would be building ahead.
 */
export async function connectChannelAction(
  workspaceSlug: string,
  channelKey: string,
): Promise<ActionState> {
  const adapter = findAdapter(channelKey)
  if (!adapter) return { error: "That channel is not available." }

  // A channel Fanwise can authorize against is never connected by writing a
  // row. Doing so would create a connection with no credential behind it, which
  // looks connected everywhere in the UI and fails at the first publish.
  if (adapter.oauth) {
    return { error: `${adapter.name} is connected by authorizing it, not by adding a row.` }
  }

  const { supabase, workspace } = await requireWorkspace(workspaceSlug)

  const { data: channel, error: channelError } = await supabase
    .from("channels")
    .select("id, name, status")
    .eq("key", channelKey)
    .maybeSingle()

  if (channelError) throw channelError
  if (!channel) return { error: "That channel is not available." }
  if (channel.status !== "available") {
    return { error: `${channel.name} is not open for connections yet.` }
  }

  const { error } = await supabase.from("channel_connections").insert({
    workspace_id: workspace.id,
    channel_id: channel.id,
    // A real adapter learns these from the provider during OAuth. The mocks
    // stand in for one account per workspace.
    external_account_id: `mock-account-${workspace.id}`,
    external_account_name: `${channel.name} account`,
    status: "active",
  })

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { error: `${channel.name} is already connected.` }
    }
    console.error("[channels] connect failed", error)
    return { error: "That channel could not be connected. Try again." }
  }

  revalidatePath(`/w/${workspaceSlug}/channels`)
  return { error: null }
}

export type BeginAuthorizationState =
  { error: string; authorizeUrl?: undefined } | { error: null; authorizeUrl: string }

/**
 * Begins an OAuth authorization against a real channel.
 *
 * Returns the provider URL rather than redirecting to it. A server action that
 * redirects off-site is a server action whose failures are invisible: the
 * creator either lands on a marketplace or does not, and "did not" looks
 * identical to a broken button. Returning the URL lets the caller show the
 * error it got instead.
 *
 * The state is written before the URL is built, so there is no window in which
 * a creator holds an authorize link Fanwise cannot later recognise.
 */
export async function beginAuthorizationAction(
  workspaceSlug: string,
  channelKey: string,
  accountHint: string,
): Promise<BeginAuthorizationState> {
  const adapter = findAdapter(channelKey)
  if (!adapter?.oauth) return { error: "That channel cannot be connected yet." }

  const parsed = adapter.oauth.parseAccountHint(accountHint)
  if (!parsed.ok) return { error: parsed.message }

  const { supabase, user, workspace } = await requireWorkspace(workspaceSlug)

  const { data: channel, error: channelError } = await supabase
    .from("channels")
    .select("id, name, status")
    .eq("key", channelKey)
    .maybeSingle()

  if (channelError) throw channelError
  if (!channel) return { error: "That channel is not available." }
  if (channel.status !== "available") {
    return { error: `${channel.name} is not open for connections yet.` }
  }

  try {
    const state = await createAuthorizationState({
      workspaceId: workspace.id,
      channelId: channel.id,
      userId: user.id,
      accountHint: parsed.value,
    })

    return {
      error: null,
      authorizeUrl: adapter.oauth.authorizeUrl({
        state,
        accountHint: parsed.value,
        redirectUri: callbackUrl(channelKey),
      }),
    }
  } catch (error) {
    // Reaches here when the deployment has no client id or secret configured,
    // which is a Fanwise problem and not something the creator can fix by
    // retrying. Said plainly rather than dressed up as a transient failure.
    console.error("[channels] could not begin authorization", error)
    return {
      error: `${channel.name} is not configured on this deployment yet. Nothing was changed.`,
    }
  }
}

/**
 * Disconnects a channel.
 *
 * Listings cascade with the connection, and since A5 that is only safe while
 * none of them describes something a provider still holds. A3 left this as the
 * function that would have to change once real listings existed, and this is
 * that change.
 *
 * The refusal below is deliberately not a warning the creator can click past.
 * Cascading away a listing that carries an external id does not remove the
 * product from the marketplace; it removes Fanwise's only record of it, leaving
 * a live product nothing points at and no way to publish to it again without
 * creating a duplicate. Fanwise forgetting is worse than Fanwise refusing.
 *
 * Snapshots also cascade, and should not. That is recorded as a known
 * limitation rather than fixed here, because the right fix is to retain them
 * against a deleted listing, which changes the foreign key.
 */
export async function disconnectChannelAction(
  workspaceSlug: string,
  connectionId: string,
): Promise<ActionState> {
  const { supabase, workspace } = await requireWorkspace(workspaceSlug)

  const { data: published, error: publishedError } = await supabase
    .from("channel_listings")
    .select("id")
    .eq("channel_connection_id", connectionId)
    .eq("workspace_id", workspace.id)
    .not("external_listing_id", "is", null)

  if (publishedError) throw publishedError

  if (published && published.length > 0) {
    return {
      error:
        published.length === 1
          ? "One product is published to this channel. Remove it from the channel first, or it will stay for sale with nothing in Fanwise pointing at it."
          : `${published.length} products are published to this channel. Remove them from the channel first, or they will stay for sale with nothing in Fanwise pointing at them.`,
    }
  }

  const { error } = await supabase
    .from("channel_connections")
    .delete()
    .eq("id", connectionId)
    .eq("workspace_id", workspace.id)

  if (error) {
    console.error("[channels] disconnect failed", error)
    return { error: "That channel could not be disconnected. Try again." }
  }

  revalidatePath(`/w/${workspaceSlug}/channels`)
  return { error: null }
}

/**
 * Builds a listing for one product on one connected channel.
 *
 * The listing is derived from the canonical product through the adapter, and
 * the snapshot is written in the same call so that the first state of every
 * listing is on the record. A3 builds; A4 lets a human edit what was built.
 */
export async function buildListingAction(
  workspaceSlug: string,
  productId: string,
  connectionId: string,
): Promise<ActionState> {
  const { supabase, workspace } = await requireWorkspace(workspaceSlug)

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("*")
    .eq("id", productId)
    .eq("workspace_id", workspace.id)
    .maybeSingle()

  if (productError) throw productError
  if (!product) return { error: "That product could not be found." }

  const { data: connection, error: connectionError } = await supabase
    .from("channel_connections")
    .select("*, channel:channels(*)")
    .eq("id", connectionId)
    .eq("workspace_id", workspace.id)
    .maybeSingle()

  if (connectionError) throw connectionError
  if (!connection) return { error: "That channel is not connected." }

  const channel = (connection as { channel: { id: string; key: string; name: string } }).channel
  const adapter = findAdapter(channel.key)
  if (!adapter) return { error: "That channel is not available." }

  const assets = await listProductAssets(product.id)
  const subject: AdapterSubject = { product, assets }
  const draft = buildDraft(adapter, subject)
  const evaluation = evaluate(adapter, draft, subject)

  const { data: listing, error: listingError } = await supabase
    .from("channel_listings")
    .upsert(
      {
        workspace_id: workspace.id,
        product_id: product.id,
        channel_id: channel.id,
        channel_connection_id: connection.id,
        status: "draft",
        // Nothing has confirmed anything. A listing only becomes verified when
        // a provider API says so, and an assisted channel never can.
        status_source: "self_reported",
        generated_at: new Date().toISOString(),
        ...draftToColumns(draft),
      },
      { onConflict: "product_id,channel_connection_id" },
    )
    .select("id")
    .single()

  if (listingError || !listing) {
    console.error("[channels] build listing failed", listingError)
    return { error: "That listing could not be built. Try again." }
  }

  const { error: snapshotError } = await supabase.from("listing_snapshots").insert({
    workspace_id: workspace.id,
    channel_listing_id: listing.id,
    product_id: product.id,
    channel_id: channel.id,
    snapshot_type: "build",
    payload: snapshotPayload(draft, evaluation) as never,
  })

  if (snapshotError) {
    // The listing exists and the snapshot does not, which is a gap in the
    // history rather than a broken listing. Surfaced, not swallowed, and not
    // rolled back: losing the listing to save the record of it would be worse.
    console.error("[channels] snapshot insert failed", snapshotError)
  }

  revalidatePath(`/w/${workspaceSlug}/products/${product.slug}`)
  return { error: null }
}

/**
 * Saves a hand-written listing.
 *
 * The creator may save something the channel would reject. That is deliberate:
 * readiness is how they find out what is wrong, and refusing the save would put
 * the answer behind the fix. What the channel thinks is recorded, not enforced.
 *
 * Readiness is recomputed here even though the browser already computed it
 * while typing. The client copy is feedback; this one is the record. A verdict
 * computed only in the browser is a verdict the browser can lie about, and it
 * is the one that reaches the snapshot.
 */
export async function updateListingAction(
  workspaceSlug: string,
  listingId: string,
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  const parsed = updateListingSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    shortDescription: formData.get("shortDescription"),
    category: formData.get("category"),
    price: formData.get("price"),
    currency: formData.get("currency"),
    tags: formData.get("tags"),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the listing.", savedAt: null }
  }

  const { supabase, workspace } = await requireWorkspace(workspaceSlug)

  const { data: existing, error: readError } = await supabase
    .from("channel_listings")
    .select("*, channel:channels(*)")
    .eq("id", listingId)
    .eq("workspace_id", workspace.id)
    .maybeSingle()

  if (readError) throw readError
  if (!existing) return { error: "That listing could not be found.", savedAt: null }

  const channel = (existing as { channel: { id: string; key: string } }).channel
  const adapter = findAdapter(channel.key)
  if (!adapter) return { error: "That channel is not available.", savedAt: null }

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("*")
    .eq("id", existing.product_id)
    .eq("workspace_id", workspace.id)
    .maybeSingle()

  if (productError) throw productError
  if (!product) return { error: "That product could not be found.", savedAt: null }

  const draft: ChannelListingDraft = {
    title: parsed.data.title,
    description: parsed.data.description,
    shortDescription: parsed.data.shortDescription,
    price: parsed.data.price,
    currency: parsed.data.currency,
    category: parsed.data.category,
    tags: parsed.data.tags,
    metadata: (existing.metadata as Record<string, unknown>) ?? {},
  }

  const { error: updateError } = await supabase
    .from("channel_listings")
    .update(draftToColumns(draft))
    .eq("id", listingId)
    .eq("workspace_id", workspace.id)

  if (updateError) {
    console.error("[channels] listing update failed", updateError)
    return { error: "Those changes could not be saved. Try again.", savedAt: null }
  }

  const assets = await listProductAssets(product.id)
  const subject: AdapterSubject = { product, assets }
  const evaluation = evaluate(adapter, draft, subject)

  const { error: snapshotError } = await supabase.from("listing_snapshots").insert({
    workspace_id: workspace.id,
    channel_listing_id: listingId,
    product_id: product.id,
    channel_id: channel.id,
    snapshot_type: "update",
    payload: snapshotPayload(draft, evaluation) as never,
  })

  if (snapshotError) {
    // A gap in the history, not a broken listing. Surfaced, not swallowed, and
    // not rolled back: losing the edit to preserve the record of it is worse.
    console.error("[channels] snapshot insert failed", snapshotError)
  }

  revalidatePath(`/w/${workspaceSlug}/products/${product.slug}`, "layout")
  return { error: null, savedAt: Date.now() }
}

/**
 * Copies one field from the canonical product onto the listing.
 *
 * Listings are independent rows, and pulling is something the creator does to
 * one field on purpose. A live binding to the product would silently overwrite
 * hand-written channel copy the moment the canonical record changed, which is
 * the opposite of what a per-channel listing is for.
 */
export async function pullFromCanonicalAction(
  workspaceSlug: string,
  listingId: string,
  field: "title" | "description" | "shortDescription" | "price",
): Promise<ActionState> {
  const { supabase, workspace } = await requireWorkspace(workspaceSlug)

  const { data: listing, error: readError } = await supabase
    .from("channel_listings")
    .select("id, product_id")
    .eq("id", listingId)
    .eq("workspace_id", workspace.id)
    .maybeSingle()

  if (readError) throw readError
  if (!listing) return { error: "That listing could not be found." }

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("*")
    .eq("id", listing.product_id)
    .eq("workspace_id", workspace.id)
    .maybeSingle()

  if (productError) throw productError
  if (!product) return { error: "That product could not be found." }

  const columns = {
    title: { title: product.canonical_title ?? product.name },
    description: { description: product.canonical_description },
    shortDescription: { short_description: product.short_description },
    price: { price: product.base_price, currency: product.currency },
  }[field]

  const { error } = await supabase
    .from("channel_listings")
    .update(columns)
    .eq("id", listingId)
    .eq("workspace_id", workspace.id)

  if (error) {
    console.error("[channels] pull from canonical failed", error)
    return { error: "That field could not be updated. Try again." }
  }

  revalidatePath(`/w/${workspaceSlug}/products/${product.slug}`, "layout")
  return { error: null }
}
