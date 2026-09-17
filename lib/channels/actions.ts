"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { routes } from "@/lib/routes"
import { listProductAssets } from "@/lib/products/queries"
import { buildDraft, draftToColumns, evaluate, rebuildColumns, snapshotPayload } from "./listings"
import { listingImages } from "./images"
import { findAdapter } from "./registry"
import { updateListingSchema } from "./schemas"
import { prepareHandoffImages } from "./handoff-renditions"
import { parseChoices } from "./choices"
import { recordEvent } from "@/lib/publishing/events"
import { callbackUrl, createAuthorizationState, grantUrl } from "./oauth"
import { codeChallenge, generateCodeVerifier } from "./pkce"
import type { AdapterSubject, ChannelListingDraft } from "./types"
import { resolvedDraft } from "./listings"
import { requestBillingSync } from "@/lib/billing/request-sync"
import { DELIVERY_SETUP_CONFIRMED_KEY } from "@/lib/delivery/setup"

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
 * This is the path for a channel with no authorization to perform: the mocks,
 * and since B9 an assisted channel that holds no credential and is connected
 * by naming the account the creator will submit to. A real API channel goes
 * through beginAuthorizationAction and the callback route, which write the
 * same connection row plus a sealed credential.
 *
 * Since C1 the insert is a billing event in the same transaction as the row,
 * per docs/billing.md rule 1: a trigger on channel_connections writes the
 * ledger row, so this function cannot forget to. What it does after the write
 * is ask the sync job to carry the ledger to the provider.
 */
export async function connectChannelAction(
  workspaceSlug: string,
  channelKey: string,
  accountHint = "",
): Promise<ActionState> {
  const adapter = findAdapter(channelKey)
  if (!adapter) return { error: "That channel is not available." }

  // A channel that names an account is connected to that account and no
  // other, so the name is parsed before anything is written, as an OAuth
  // account hint is: what is stored becomes the connection's identity.
  let account: { id: string; name: string } | null = null
  if (adapter.accountHint) {
    const parsed = adapter.accountHint.parse(accountHint)
    if (!parsed.ok) return { error: parsed.message }
    account = { id: parsed.value, name: parsed.name }
  }

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
    // stand in for one account per workspace; an assisted channel records
    // the account the creator named.
    external_account_id: account?.id ?? `mock-account-${workspace.id}`,
    external_account_name: account?.name ?? `${channel.name} account`,
    status: "active",
  })

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { error: `${channel.name} is already connected.` }
    }
    console.error("[channels] connect failed", error)
    return { error: "That channel could not be connected. Try again." }
  }

  await requestBillingSync(workspace.id)

  revalidatePath(routes.channels(workspaceSlug))
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
    // A PKCE verifier is minted here and written with the state, so the
    // challenge in the URL and the verifier at the exchange are one pair and
    // the browser carries neither secret.
    const codeVerifier = adapter.oauth.pkce ? generateCodeVerifier() : undefined
    const state = await createAuthorizationState({
      workspaceId: workspace.id,
      channelId: channel.id,
      userId: user.id,
      accountHint: parsed.value,
      ...(codeVerifier ? { codeVerifier } : {}),
    })

    return {
      error: null,
      authorizeUrl: adapter.oauth.authorizeUrl({
        state,
        accountHint: parsed.value,
        redirectUri: callbackUrl(channelKey),
        grantUri: grantUrl(channelKey),
        ...(codeVerifier ? { codeChallenge: codeChallenge(codeVerifier) } : {}),
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
 * Records, or withdraws, a creator's confirmation that a channel's one-time
 * delivery setup is done (ADR 0013).
 *
 * A claim, not a verification: the setup lives in the shop's own admin, which
 * no API Fanwise holds can read. It is stated as the creator's, per account,
 * and it is what the channel's readiness rule reads before a product may go on
 * sale there.
 */
export async function setDeliverySetupAction(
  workspaceSlug: string,
  connectionId: string,
  confirmed: boolean,
): Promise<ActionState> {
  const { supabase, workspace } = await requireWorkspace(workspaceSlug)

  const { data: connection, error: readError } = await supabase
    .from("channel_connections")
    .select("id, metadata, channel:channels(key)")
    .eq("id", connectionId)
    .eq("workspace_id", workspace.id)
    .maybeSingle()

  if (readError) throw readError
  if (!connection) return { error: "That connection could not be found." }

  const channelKey = (connection as unknown as { channel: { key: string } | null }).channel?.key
  const adapter = channelKey ? findAdapter(channelKey) : undefined
  if (!adapter?.deliverySetup) return { error: "This channel has no delivery setup." }

  const metadata = { ...((connection.metadata as Record<string, unknown>) ?? {}) }
  if (confirmed) metadata[DELIVERY_SETUP_CONFIRMED_KEY] = new Date().toISOString()
  else delete metadata[DELIVERY_SETUP_CONFIRMED_KEY]

  const { error } = await supabase
    .from("channel_connections")
    .update({ metadata: metadata as never })
    .eq("id", connectionId)
    .eq("workspace_id", workspace.id)

  if (error) {
    console.error("[channels] could not record delivery setup", error)
    return { error: "That could not be saved. Try again." }
  }

  // Readiness on every product reads this, so every product page is stale.
  revalidatePath(`/${workspaceSlug}`, "layout")
  return { error: null }
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

  /*
   * Tell the provider first, for a channel whose tokens never expire: after
   * the row goes nothing else could. Best effort, and read through RLS so the
   * key belongs to this workspace before anything is revoked with it.
   */
  const { data: connection } = await supabase
    .from("channel_connections")
    .select("channel:channels(key)")
    .eq("id", connectionId)
    .eq("workspace_id", workspace.id)
    .maybeSingle()
  const revoke = findAdapter(connection?.channel?.key ?? "")?.oauth?.revoke
  if (revoke) {
    await revoke({ workspaceId: workspace.id, connectionId }).catch((revokeError: unknown) => {
      console.error("[channels] revoke failed, disconnecting anyway", revokeError)
    })
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

  // The delete wrote the ledger row through the trigger; this carries it.
  await requestBillingSync(workspace.id)

  revalidatePath(routes.channels(workspaceSlug))
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
  const subject: AdapterSubject = {
    product,
    assets,
    // The shop's currency lives on the connection. Without it the Etsy currency
    // rule reads as if no shop were connected, in every build snapshot.
    connectionMetadata: (connection.metadata as Record<string, unknown>) ?? {},
  }
  const draft = buildDraft(adapter, subject)
  const evaluation = evaluate(adapter, draft, subject)

  /*
   * Insert, and fall back to updating only what a rebuild is allowed to touch.
   *
   * This was one upsert, and the payload it wrote on conflict included `status`,
   * `status_source` and `metadata`. Rebuilding a published listing therefore
   * reset it to draft and self_reported while leaving external_listing_id and
   * published_at in place, and blanked the metadata the runner had written.
   *
   * The status was the visible half. The metadata was the dangerous half:
   * `metadata.externalState` is what the Shopify adapter reads to decide
   * whether an update sends ACTIVE or DRAFT, so losing it turns the next edit
   * into an instruction to take a live product off sale. Rebuilding is a
   * regeneration of the *draft*, and it has no business having an opinion about
   * what the channel is currently holding.
   *
   * Insert-then-update rather than read-then-write, so two concurrent rebuilds
   * resolve on the unique constraint instead of racing.
   */
  const generatedAt = new Date().toISOString()

  const insert = await supabase
    .from("channel_listings")
    .insert({
      workspace_id: workspace.id,
      product_id: product.id,
      channel_id: channel.id,
      channel_connection_id: connection.id,
      status: "draft",
      // Nothing has confirmed anything. A listing only becomes verified when
      // a provider API says so, and an assisted channel never can. Written on
      // the first build only: after that, publication decides it.
      status_source: "self_reported",
      generated_at: generatedAt,
      ...draftToColumns(draft),
    })
    .select("id")
    .single()

  let listing = insert.data

  if (insert.error) {
    if (insert.error.code !== UNIQUE_VIOLATION) {
      console.error("[channels] build listing failed", insert.error)
      return { error: "That listing could not be built. Try again." }
    }

    // The listing already exists, so this is a regeneration. Read what
    // publication recorded, and hand it back unchanged alongside the new draft.
    const { data: existing } = await supabase
      .from("channel_listings")
      .select("id, metadata")
      .eq("workspace_id", workspace.id)
      .eq("product_id", product.id)
      .eq("channel_connection_id", connection.id)
      .maybeSingle()

    if (!existing) {
      console.error("[channels] build listing conflicted with a row it cannot read")
      return { error: "That listing could not be built. Try again." }
    }

    const { data: updated, error: updateError } = await supabase
      .from("channel_listings")
      .update(
        rebuildColumns(
          draft,
          existing.metadata,
          generatedAt,
          (adapter.choices ?? []).map((choice) => choice.key),
        ),
      )
      .eq("id", existing.id)
      .eq("workspace_id", workspace.id)
      .select("id")
      .single()

    if (updateError || !updated) {
      console.error("[channels] build listing failed", updateError)
      return { error: "That listing could not be built. Try again." }
    }
    listing = updated
  }

  if (!listing) {
    console.error("[channels] build listing produced no row")
    return { error: "That listing could not be built. Try again." }
  }

  const { error: snapshotError } = await supabase.from("listing_snapshots").insert({
    workspace_id: workspace.id,
    channel_listing_id: listing.id,
    product_id: product.id,
    channel_id: channel.id,
    snapshot_type: "build",
    payload: snapshotPayload(draft, evaluation, listingImages(subject)) as never,
  })

  if (snapshotError) {
    // The listing exists and the snapshot does not, which is a gap in the
    // history rather than a broken listing. Surfaced, not swallowed, and not
    // rolled back: losing the listing to save the record of it would be worse.
    console.error("[channels] snapshot insert failed", snapshotError)
  }

  // An assisted channel's handoff hands over renditions in the channel's own
  // shapes. Asked for here, at build, so they are ready by the time the
  // creator reaches the handoff; cached by the engine, so a rebuild re-asks
  // for nothing that already exists.
  await prepareHandoffImages(adapter, workspace.id, subject)

  revalidatePath(routes.product(workspaceSlug, product.slug))
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
    seoTitle: formData.get("seoTitle"),
    seoDescription: formData.get("seoDescription"),
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
    .select("*, channel:channels(*), connection:channel_connections(metadata)")
    .eq("id", listingId)
    .eq("workspace_id", workspace.id)
    .maybeSingle()

  if (readError) throw readError
  if (!existing) return { error: "That listing could not be found.", savedAt: null }

  const channel = (existing as { channel: { id: string; key: string } }).channel
  const connectionMetadata =
    ((existing as { connection: { metadata: unknown } | null }).connection?.metadata as
      Record<string, unknown> | undefined) ?? {}
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
    seoTitle: parsed.data.seoTitle,
    seoDescription: parsed.data.seoDescription,
    price: parsed.data.price,
    // An inherited price is quoted in the product's currency, and the row
    // keeps that so it reads the same with or without resolution.
    currency:
      parsed.data.price === null ? product.currency : (parsed.data.currency ?? product.currency),
    category: parsed.data.category,
    tags: parsed.data.tags,
    metadata: (existing.metadata as Record<string, unknown>) ?? {},
  }

  /*
   * A save is not an approval. At B1 it was, for want of a review screen; B2
   * gave approval its own action (lib/ai/approve.ts), so a creator can save
   * an edit to composed copy and still be asked to read the whole before it
   * ships. `approved_at` is untouched here.
   */
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
  const subject: AdapterSubject = { product, assets, connectionMetadata }
  const evaluation = evaluate(adapter, draft, subject)

  const { error: snapshotError } = await supabase.from("listing_snapshots").insert({
    workspace_id: workspace.id,
    channel_listing_id: listingId,
    product_id: product.id,
    channel_id: channel.id,
    snapshot_type: "update",
    payload: snapshotPayload(draft, evaluation, listingImages(subject)) as never,
  })

  if (snapshotError) {
    // A gap in the history, not a broken listing. Surfaced, not swallowed, and
    // not rolled back: losing the edit to preserve the record of it is worse.
    console.error("[channels] snapshot insert failed", snapshotError)
  }

  revalidatePath(routes.product(workspaceSlug, product.slug), "layout")
  return { error: null, savedAt: Date.now() }
}

/**
 * Saves the choices a channel's form asks for beyond the listing fields.
 *
 * Validated against the adapter's declaration rather than trusted: the keys
 * that reach `metadata` are the ones the adapter named, with values from the
 * options it listed. Everything else in `metadata`, publication's own keys
 * above all, is left exactly as it was.
 */
export async function updateListingChoicesAction(
  workspaceSlug: string,
  listingId: string,
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  const { supabase, workspace } = await requireWorkspace(workspaceSlug)

  const { data: existing, error: readError } = await supabase
    .from("channel_listings")
    .select("*, channel:channels(*), connection:channel_connections(metadata)")
    .eq("id", listingId)
    .eq("workspace_id", workspace.id)
    .maybeSingle()

  if (readError) throw readError
  if (!existing) return { error: "That listing could not be found.", savedAt: null }

  const channel = (existing as { channel: { id: string; key: string } }).channel
  const adapter = findAdapter(channel.key)
  if (!adapter?.choices || adapter.choices.length === 0) {
    return { error: "This channel asks for nothing beyond the listing.", savedAt: null }
  }

  const parsed = parseChoices(adapter.choices, formData)
  if (!parsed.ok) return { error: parsed.message, savedAt: null }

  const metadata = {
    ...((existing.metadata as Record<string, unknown>) ?? {}),
    ...parsed.values,
  }

  const { error: updateError } = await supabase
    .from("channel_listings")
    .update({ metadata: metadata as never })
    .eq("id", listingId)
    .eq("workspace_id", workspace.id)

  if (updateError) {
    console.error("[channels] listing choices update failed", updateError)
    return { error: "Those changes could not be saved. Try again.", savedAt: null }
  }

  const { data: product } = await supabase
    .from("products")
    .select("*")
    .eq("id", existing.product_id)
    .eq("workspace_id", workspace.id)
    .maybeSingle()

  if (product) {
    const assets = await listProductAssets(product.id)
    const connectionMetadata =
      ((existing as { connection: { metadata: unknown } | null }).connection?.metadata as
        Record<string, unknown> | undefined) ?? {}
    const subject: AdapterSubject = { product, assets, connectionMetadata }
    const draft = resolvedDraft({ ...existing, metadata: metadata as never }, product, adapter)
    const evaluation = evaluate(adapter, draft, subject)

    const { error: snapshotError } = await supabase.from("listing_snapshots").insert({
      workspace_id: workspace.id,
      channel_listing_id: listingId,
      product_id: product.id,
      channel_id: channel.id,
      snapshot_type: "update",
      payload: snapshotPayload(draft, evaluation, listingImages(subject)) as never,
    })
    if (snapshotError) console.error("[channels] snapshot insert failed", snapshotError)

    // A choice can change which renditions the handoff wants.
    await prepareHandoffImages(adapter, workspace.id, subject)
    revalidatePath(routes.product(workspaceSlug, product.slug), "layout")
  }

  return { error: null, savedAt: Date.now() }
}

export interface SubmissionState {
  error: string | null
  externalUrl: string | null
}

/**
 * Records that a creator submitted a listing to an assisted channel by hand,
 * and the address they got back.
 *
 * The only way a listing on such a channel reaches `published`, and every
 * word of it is the creator's: `status_source` stays `self_reported`, the
 * trigger on the table would refuse anything else, and the card says so. The
 * URL is parsed by the adapter, whose id keeps one project from being claimed
 * by two products through the same unique index a real publish relies on.
 *
 * A listing already marked may be marked again with a corrected address. It
 * is a report, not a write to a provider, and a typo in it should cost one
 * paste rather than a support email.
 */
export async function markSubmittedAction(
  workspaceSlug: string,
  listingId: string,
  _prev: SubmissionState,
  formData: FormData,
): Promise<SubmissionState> {
  const raw = formData.get("url")
  const { supabase, user, workspace } = await requireWorkspace(workspaceSlug)

  const { data: existing, error: readError } = await supabase
    .from("channel_listings")
    .select("*, channel:channels(*), connection:channel_connections(metadata)")
    .eq("id", listingId)
    .eq("workspace_id", workspace.id)
    .maybeSingle()

  if (readError) throw readError
  if (!existing) return { error: "That listing could not be found.", externalUrl: null }

  const channel = (existing as { channel: { id: string; key: string; name: string } }).channel
  const adapter = findAdapter(channel.key)
  if (!adapter?.submission || adapter.integrationType !== "assisted") {
    return {
      error: "This channel is published through Fanwise, not marked by hand.",
      externalUrl: null,
    }
  }
  // Belt and braces with the trigger: a row that reads as confirmed by a
  // provider is never overwritten with a person's word.
  if (existing.status_source !== "self_reported") {
    return {
      error: "This listing's status was confirmed by the channel and cannot be marked by hand.",
      externalUrl: null,
    }
  }

  const parsed = adapter.submission.parseUrl(typeof raw === "string" ? raw : "")
  if (!parsed.ok) return { error: parsed.message, externalUrl: null }

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("*")
    .eq("id", existing.product_id)
    .eq("workspace_id", workspace.id)
    .maybeSingle()
  if (productError) throw productError
  if (!product) return { error: "That product could not be found.", externalUrl: null }

  const publishedAt = new Date().toISOString()
  const metadata = (existing.metadata as Record<string, unknown>) ?? {}

  const { error: updateError } = await supabase
    .from("channel_listings")
    .update({
      status: "published",
      status_source: "self_reported",
      external_listing_id: parsed.externalListingId,
      external_url: parsed.externalUrl,
      // The project page is the buyer's address too: an asset lives on it.
      public_url: parsed.externalUrl,
      published_at: existing.published_at ?? publishedAt,
      metadata: { ...metadata, submittedAt: publishedAt } as never,
    })
    .eq("id", listingId)
    .eq("workspace_id", workspace.id)

  if (updateError) {
    if (updateError.code === UNIQUE_VIOLATION) {
      return {
        error: `Another product in this workspace already points at that ${channel.name} project.`,
        externalUrl: null,
      }
    }
    console.error("[channels] mark submitted failed", updateError)
    return { error: "That could not be saved. Try again.", externalUrl: null }
  }

  const assets = await listProductAssets(product.id)
  const connectionMetadata =
    ((existing as { connection: { metadata: unknown } | null }).connection?.metadata as
      Record<string, unknown> | undefined) ?? {}
  const subject: AdapterSubject = { product, assets, connectionMetadata }
  const draft = resolvedDraft(existing, product, adapter)
  const evaluation = evaluate(adapter, draft, subject)

  const { error: snapshotError } = await supabase.from("listing_snapshots").insert({
    workspace_id: workspace.id,
    channel_listing_id: listingId,
    product_id: product.id,
    channel_id: channel.id,
    snapshot_type: "publish",
    payload: {
      ...snapshotPayload(draft, evaluation, listingImages(subject)),
      submission: {
        externalUrl: parsed.externalUrl,
        externalListingId: parsed.externalListingId,
        statusSource: "self_reported",
        handoffMode: metadata.handoffMode ?? null,
      },
    } as never,
  })
  if (snapshotError) console.error("[channels] snapshot insert failed", snapshotError)

  await recordEvent(supabase, {
    workspaceId: workspace.id,
    type: "listing_marked_submitted",
    productId: product.id,
    listingId,
    actorUserId: user.id,
    payload: {
      channelName: channel.name,
      externalUrl: parsed.externalUrl,
      handoffMode: metadata.handoffMode ?? null,
    },
  })

  revalidatePath(routes.product(workspaceSlug, product.slug), "layout")
  return { error: null, externalUrl: parsed.externalUrl }
}
