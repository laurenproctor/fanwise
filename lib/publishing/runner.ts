import { createAdminClient } from "@/lib/supabase/admin"
import { createIngestUrl } from "@/lib/products/storage"
import { evaluate, listingToDraft, snapshotPayload } from "@/lib/channels/listings"
import { findAdapter } from "@/lib/channels/registry"
import { normalizeUnknown } from "@/lib/channels/errors"
import type {
  AdapterSubject,
  ChannelAdapter,
  ChannelConnection,
  ChannelListing,
  PublishContext,
  PublishResult,
} from "@/lib/channels/types"
import type { Product, ProductAsset } from "@/lib/products/types"
import { sentFingerprint } from "./idempotency"
import type { PublicationKind } from "./idempotency"
import { imagesFingerprint } from "@/lib/channels/images"

/**
 * Performing one external write, exactly once.
 *
 * This runs in a background job holding the service role, so RLS is not doing
 * the tenant filtering here and every query below scopes `workspace_id` itself,
 * per docs/security.md rule 4. The workspace comes from the job row, which was
 * written by an authorized member through RLS; nothing here trusts an argument.
 *
 * The order of the guards is fixed by docs/architecture.md and is the whole
 * point of the file:
 *
 *   1. an existing external_listing_id
 *   2. an existing successful publication job
 *   3. the idempotency key itself
 *
 * Check 3 already happened, in the database, when the job row was inserted:
 * the key is unique, so a second click never produced a second job. Checks 1
 * and 2 happen here, because between the click and the job actually running,
 * the world may have moved. Together they are why publishing twice creates one
 * product.
 */

export interface RunPublicationPayload {
  workspaceId: string
  publicationJobId: string
}

interface LoadedJob {
  id: string
  kind: PublicationKind
  channel_listing_id: string
  attempt_count: number
}

/** The adapter method a job kind maps to. Absent means the channel cannot. */
function methodFor(
  adapter: ChannelAdapter,
  kind: PublicationKind,
): ((context: PublishContext) => Promise<PublishResult>) | undefined {
  switch (kind) {
    case "publish":
      return adapter.publish?.bind(adapter)
    case "update":
      return adapter.update?.bind(adapter)
    case "activate":
      return adapter.activate?.bind(adapter)
  }
}

export async function runPublication(payload: RunPublicationPayload): Promise<void> {
  const { workspaceId, publicationJobId } = payload
  const admin = createAdminClient()

  /**
   * Claim the job by compare-and-swap.
   *
   * `status in ('pending','failed')` is the condition, so exactly one worker
   * transitions it to running and a retry of a failed job reuses its row rather
   * than starting a second one. If no row comes back, someone else has it or it
   * has already succeeded, and the correct action is to do nothing at all: a
   * second worker "helpfully" proceeding is how one click becomes two products.
   */
  const { data: claimed, error: claimError } = await admin
    .from("publication_jobs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", publicationJobId)
    .eq("workspace_id", workspaceId)
    .in("status", ["pending", "failed"])
    .select("id, kind, channel_listing_id, attempt_count")
    .maybeSingle()

  if (claimError) {
    console.error("[publishing] could not claim job", { publicationJobId, error: claimError })
    return
  }
  if (!claimed) return

  const job = claimed as LoadedJob
  // Incremented after the claim rather than inside it, so the count reflects
  // attempts that actually ran. Postgres has no `set x = x + 1 returning` through
  // this client, and an attempt count that is off by one is a worse diagnostic
  // than one extra statement is a cost.
  await admin
    .from("publication_jobs")
    .update({ attempt_count: job.attempt_count + 1 })
    .eq("id", job.id)
    .eq("workspace_id", workspaceId)

  try {
    await execute(admin, workspaceId, job)
  } catch (error) {
    // Nothing below execute() is allowed to escape: an unhandled rejection in a
    // background job leaves the row `running` forever, and a job stuck in
    // running is one that can never be retried.
    console.error("[publishing] job failed outside normalization", {
      publicationJobId,
      error,
    })
    await admin
      .from("publication_jobs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        normalized_error_code: "unknown",
        normalized_error_message: "Something went wrong before the channel was contacted.",
      })
      .eq("id", job.id)
      .eq("workspace_id", workspaceId)
  }
}

async function execute(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  job: LoadedJob,
): Promise<void> {
  const finish = (fields: Record<string, unknown>) =>
    admin
      .from("publication_jobs")
      .update({ completed_at: new Date().toISOString(), ...fields })
      .eq("id", job.id)
      .eq("workspace_id", workspaceId)

  const { data: listingRow, error: listingError } = await admin
    .from("channel_listings")
    .select("*, channel:channels(*)")
    .eq("id", job.channel_listing_id)
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  if (listingError || !listingRow) {
    await finish({
      status: "failed",
      normalized_error_code: "not_found",
      normalized_error_message: "That listing no longer exists.",
    })
    return
  }

  const { channel, ...listing } = listingRow as ChannelListing & {
    channel: { id: string; key: string; name: string }
  }

  const adapter = findAdapter(channel.key)
  const method = adapter ? methodFor(adapter, job.kind) : undefined
  if (!adapter || !method) {
    await finish({
      status: "failed",
      normalized_error_code: "unknown",
      normalized_error_message: "That channel can no longer perform this action.",
    })
    return
  }

  /**
   * Guard 1. The provider already holds an object for this listing, so a
   * `publish` has nothing to create. This is the check that survives the cases
   * the unique key cannot see: a job row deleted by a cascade, a listing
   * published under an older key, a database restored from a moment before the
   * job row but after the provider call.
   */
  if (job.kind === "publish" && listing.external_listing_id) {
    await finish({
      status: "succeeded",
      provider_response: {
        skipped: "already_published",
        externalListingId: listing.external_listing_id,
      },
    })
    return
  }

  /** Guard 2. An earlier job already did this exact operation. */
  const { data: earlier } = await admin
    .from("publication_jobs")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("channel_listing_id", job.channel_listing_id)
    .eq("kind", job.kind)
    .eq("status", "succeeded")
    .neq("id", job.id)
    .limit(1)

  if (earlier && earlier.length > 0 && job.kind === "publish") {
    await finish({
      status: "succeeded",
      provider_response: { skipped: "already_succeeded", earlierJobId: earlier[0]?.id },
    })
    return
  }

  const { data: connection, error: connectionError } = await admin
    .from("channel_connections")
    .select("*")
    .eq("id", listing.channel_connection_id)
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  if (connectionError || !connection) {
    await finish({
      status: "failed",
      normalized_error_code: "credentials_invalid",
      normalized_error_message: "That channel is no longer connected. Reconnect it and try again.",
    })
    return
  }

  const { data: product, error: productError } = await admin
    .from("products")
    .select("*")
    .eq("id", listing.product_id)
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  if (productError || !product) {
    await finish({
      status: "failed",
      normalized_error_code: "not_found",
      normalized_error_message: "That product no longer exists.",
    })
    return
  }

  const { data: assetRows } = await admin
    .from("product_assets")
    .select("*")
    .eq("product_id", listing.product_id)
    .eq("workspace_id", workspaceId)
    .order("sort_order", { ascending: true })

  const subject: AdapterSubject = {
    product: product as Product,
    assets: (assetRows ?? []) as ProductAsset[],
    connectionMetadata: (connection.metadata as Record<string, unknown>) ?? {},
  }

  const context: PublishContext = {
    listing,
    connection: connection as ChannelConnection,
    subject,
    // Minted per asset, only when an adapter asks. A link that is never
    // requested is never created, so a channel that cannot take images never
    // causes a signed URL for one to exist.
    assetUrl: (asset) => createIngestUrl(asset.storage_path),
  }

  let result: PublishResult
  try {
    result = await method(context)
  } catch (error) {
    const normalized = normalizeUnknown(error, adapter.name)

    // A failed publish leaves nothing on the provider, so the listing goes back
    // to failed. A failed update or activate does not: the product is still
    // there and still published, and marking the listing failed would tell the
    // creator their live product had gone away.
    if (job.kind === "publish") {
      await admin
        .from("channel_listings")
        .update({ status: "failed" })
        .eq("id", listing.id)
        .eq("workspace_id", workspaceId)
    }

    await finish({
      status: "failed",
      normalized_error_code: normalized.code,
      normalized_error_message: normalized.message,
      provider_response: (normalized.raw ?? null) as never,
    })
    return
  }

  await recordSuccess({ admin, workspaceId, listing, channel, adapter, job, result, subject })

  await finish({
    status: "succeeded",
    provider_response: (result.providerResponse ?? null) as never,
  })
}

async function recordSuccess(params: {
  admin: ReturnType<typeof createAdminClient>
  workspaceId: string
  listing: ChannelListing
  channel: { id: string; key: string; name: string }
  adapter: ChannelAdapter
  job: LoadedJob
  result: PublishResult
  subject: AdapterSubject
}): Promise<void> {
  const { admin, workspaceId, listing, channel, adapter, job, result, subject } = params
  const now = new Date().toISOString()

  const metadata = {
    ...((listing.metadata as Record<string, unknown>) ?? {}),
    // Read back by the adapter's update() so an edit does not silently take a
    // live product off sale, or put a draft one on it.
    externalState: result.externalState,
  }

  /*
   * What this write actually sent, so the UI can tell whether anything is left
   * to send. Computed from the same draft the adapter was handed and the same
   * image list it would have used, which is what makes it comparable to the
   * fingerprint recomputed when the panel renders.
   *
   * Written for every kind, not only update. A publish sends content too, and
   * a listing whose fingerprint were recorded only on update would offer
   * "Publish changes" the moment it was first published, with nothing changed.
   */
  const draftSent = listingToDraft({ ...listing, metadata: metadata as never })

  await admin
    .from("channel_listings")
    .update({
      external_listing_id: result.externalListingId,
      external_url: result.externalUrl,
      status: "published",
      last_sent_fingerprint: sentFingerprint(draftSent, imagesFingerprint(subject)),
      // A provider API confirmed this. The database trigger refuses `verified`
      // on an assisted channel, so this line can only ever be reached by a
      // channel that genuinely confirmed something.
      status_source: "verified",
      published_at: listing.published_at ?? now,
      last_synced_at: now,
      metadata: metadata as never,
    })
    .eq("id", listing.id)
    .eq("workspace_id", workspaceId)

  /**
   * Create the manual step rows the channel declares.
   *
   * Only after a successful publication, because a step is work outstanding on
   * something that exists. Ignoring a conflict makes this safe to repeat: a
   * retry must not reopen a step the creator has already completed.
   */
  if (job.kind === "publish" && adapter.manualSteps.length > 0) {
    await admin.from("listing_manual_steps").upsert(
      adapter.manualSteps.map((step) => ({
        workspace_id: workspaceId,
        channel_listing_id: listing.id,
        step_key: step.key,
      })),
      { onConflict: "channel_listing_id,step_key", ignoreDuplicates: true },
    )
  }

  // Invariant 4: every publication produces an immutable snapshot. Written
  // after the listing update so it records the state that actually landed,
  // including the external id the provider just handed back.
  // Evaluated against the real product and its real assets. A snapshot is
  // history, and a readiness verdict computed against a placeholder subject
  // would be a false one recorded in a table that can never be corrected.
  const evaluation = evaluate(adapter, draftSent, subject)

  const { error: snapshotError } = await admin.from("listing_snapshots").insert({
    workspace_id: workspaceId,
    channel_listing_id: listing.id,
    product_id: listing.product_id,
    channel_id: channel.id,
    snapshot_type: job.kind === "update" ? "update" : "publish",
    payload: {
      ...snapshotPayload(draftSent, evaluation),
      publication: {
        kind: job.kind,
        externalListingId: result.externalListingId,
        externalUrl: result.externalUrl,
        externalState: result.externalState,
        at: now,
      },
    } as never,
  })

  if (snapshotError) {
    // A gap in the history, not a broken publication. The product is live on the
    // channel either way, and rolling that back to preserve the record of it
    // would be the wrong trade.
    console.error("[publishing] snapshot insert failed", snapshotError)
  }
}
