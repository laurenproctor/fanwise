import { createHash, randomBytes } from "node:crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import { open, seal } from "@/lib/credentials"
import { appOrigin } from "@/lib/channels/oauth"
import { publicMediaRoutes } from "@/lib/public/media-routes"

/**
 * Download links a storefront serves to its buyers (ADR 0012).
 *
 * A storefront that delivers a file by URL stores that URL once and hands it to
 * every buyer for as long as the product sells. A signed storage link expires
 * long before then, and a permanent one could never be withdrawn. So the
 * storefront is given a Fanwise address holding a random token, and each
 * request to it is checked afresh (`resolveDeliveryToken`) before it is sent on
 * to a download link that lives five minutes.
 *
 * What this protects and what it does not, stated plainly: the address is a
 * bearer capability. A buyer who shares it shares the file, exactly as they
 * could share the file itself. What it adds over a storage link is that it can
 * be withdrawn — revoke it and the next request is a 404 — and that it stops
 * working on its own when the listing is unpublished or the file is removed.
 *
 * Server only. Every read and write here uses the service role, because the
 * table has no grant to anyone else.
 */

const TOKEN_BYTES = 32
/** base64url of 32 bytes: 43 characters, no padding. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export const DELIVERABLE_TYPES = ["deliverable", "archive"] as const

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex")
}

/**
 * The seal is bound to the link's tenant, listing and file, so a sealed token
 * copied onto another row opens into nothing.
 */
function contextFor(workspaceId: string, listingId: string, assetId: string): string {
  return `delivery_link:${workspaceId}:${listingId}:${assetId}`
}

export function deliveryAddress(token: string): string {
  return `${appOrigin()}${publicMediaRoutes.delivery(token)}`
}

/**
 * The address for one file on one listing, the same one every time.
 *
 * Reused rather than minted per publish. The storefront keys each buyer's
 * download on the address it holds, and a new address on every edit would
 * mean every past buyer's link changed underneath them — harmless while the
 * old one still worked, and a support problem the moment it did not.
 */
export async function deliveryUrlFor(params: {
  workspaceId: string
  listingId: string
  assetId: string
}): Promise<string> {
  const { workspaceId, listingId, assetId } = params
  const admin = createAdminClient()
  const context = contextFor(workspaceId, listingId, assetId)

  const existing = await activeLink(admin, params)
  if (existing) {
    return deliveryAddress(
      open({ ciphertext: existing.encrypted_token, keyVersion: existing.key_version }, context),
    )
  }

  const token = randomBytes(TOKEN_BYTES).toString("base64url")
  const sealed = seal(token, context)
  const { error } = await admin.from("delivery_links").insert({
    workspace_id: workspaceId,
    channel_listing_id: listingId,
    product_asset_id: assetId,
    token_hash: hashToken(token),
    encrypted_token: sealed.ciphertext,
    key_version: sealed.keyVersion,
  })

  if (error) {
    // Two publishes racing for the same file: the partial unique index lets
    // exactly one link be active, and the loser uses the winner's.
    if (error.code === "23505") {
      const winner = await activeLink(admin, params)
      if (winner) {
        return deliveryAddress(
          open({ ciphertext: winner.encrypted_token, keyVersion: winner.key_version }, context),
        )
      }
    }
    // The message is the database's, never the token's.
    throw new Error(`could not create a delivery link: ${error.message}`)
  }

  return deliveryAddress(token)
}

async function activeLink(
  admin: ReturnType<typeof createAdminClient>,
  params: { workspaceId: string; listingId: string; assetId: string },
) {
  const { data, error } = await admin
    .from("delivery_links")
    .select("encrypted_token, key_version")
    .eq("workspace_id", params.workspaceId)
    .eq("channel_listing_id", params.listingId)
    .eq("product_asset_id", params.assetId)
    .is("revoked_at", null)
    .maybeSingle()
  if (error) throw new Error(`could not read a delivery link: ${error.message}`)
  return data
}

/** Withdraws every live link on a listing. The next request to any of them is a 404. */
export async function revokeDeliveryLinks(params: {
  workspaceId: string
  listingId: string
}): Promise<number> {
  const { data, error } = await createAdminClient()
    .from("delivery_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("workspace_id", params.workspaceId)
    .eq("channel_listing_id", params.listingId)
    .is("revoked_at", null)
    .select("id")
  if (error) throw new Error(`could not revoke delivery links: ${error.message}`)
  return data?.length ?? 0
}

export interface ResolvedDelivery {
  linkId: string
  storagePath: string
  filename: string
}

/**
 * What a token may download right now, or null.
 *
 * Every condition is re-derived on every request, so nothing a creator does
 * afterwards has to reach out and invalidate anything:
 *
 *   - the token matches a link that is not revoked;
 *   - the listing is still published on its channel;
 *   - the file still exists, is ready, is a deliverable, and belongs to the
 *     product the listing sells.
 *
 * Null for every failure alike, so a response cannot tell a stranger which of
 * them it was.
 */
export async function resolveDeliveryToken(token: string): Promise<ResolvedDelivery | null> {
  if (!TOKEN_PATTERN.test(token)) return null

  const admin = createAdminClient()
  const { data: link } = await admin
    .from("delivery_links")
    .select("id, workspace_id, channel_listing_id, product_asset_id, revoked_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle()
  if (!link || link.revoked_at !== null) return null

  const [{ data: listing }, { data: asset }] = await Promise.all([
    admin
      .from("channel_listings")
      .select("product_id, status, external_listing_id")
      .eq("id", link.channel_listing_id)
      .eq("workspace_id", link.workspace_id)
      .maybeSingle(),
    admin
      .from("product_assets")
      .select("product_id, storage_path, filename, asset_state, asset_type")
      .eq("id", link.product_asset_id)
      .eq("workspace_id", link.workspace_id)
      .maybeSingle(),
  ])

  if (!listing || listing.status !== "published" || !listing.external_listing_id) return null
  if (!asset || asset.product_id !== listing.product_id) return null
  if (asset.asset_state !== "ready") return null
  if (!(DELIVERABLE_TYPES as readonly string[]).includes(asset.asset_type)) return null

  return { linkId: link.id, storagePath: asset.storage_path, filename: asset.filename }
}

/** Best effort: a download is not refused because a timestamp could not be written. */
export async function recordDeliveryUse(linkId: string): Promise<void> {
  await createAdminClient()
    .from("delivery_links")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", linkId)
}

/** Exported for tests: the shape a token must have before a query is spent on it. */
export function isWellFormedToken(token: string): boolean {
  return TOKEN_PATTERN.test(token)
}
