import { createHash, randomBytes } from "node:crypto"
import { buildDeliverableLinkUrl, isWellFormedToken } from "@/lib/channels/deliverable-link"
import { isStale, open, seal } from "@/lib/credentials"
import { clientEnv } from "@/lib/env"
import type { createAdminClient } from "@/lib/supabase/admin"

/**
 * Durable fetch addresses for deliverables, for channels that store a URL.
 *
 * Some channels keep a download as a URL and fetch the bytes themselves whenever
 * a buyer downloads, which can be long after the publish that supplied it. Every
 * other link Fanwise mints expires within the hour, so this is the one durable
 * capability. The migration that creates its table explains the storage:
 * `supabase/migrations/20260913070000_deliverable_links.sql`. The URL's shape
 * is in lib/channels/deliverable-link.ts.
 *
 * Three rules, each load-bearing:
 *
 *   1. **Stable.** One listing and one asset have one live address, and every
 *      write is handed the same one. A store ties buyers' download permissions
 *      to its download entries, and churning the address churns those.
 *   2. **Never readable from the table alone.** Looked up by SHA-256, kept
 *      sealed with the credentials keyring and bound to its listing and asset.
 *   3. **Re-derived on every request.** Not revoked, the asset still a buyer
 *      file, and still ready, checked when the store asks rather than when the
 *      address was made.
 *
 * Service role only: the table grants no policy to anyone signed in. Nothing
 * here may be imported into an adapter, a component, or anything the browser
 * bundles. The runner injects a closure over `ensureDeliverableLink` into
 * PublishContext, the same way it injects `assetUrl`.
 */

type Admin = ReturnType<typeof createAdminClient>

const TOKEN_BYTES = 32

/** The only asset types an address may serve. Matches the channel requirements. */
export const DELIVERABLE_TYPES = ["deliverable", "archive"] as const

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex")
}

function sealContext(listingId: string, assetId: string): string {
  return `listing_deliverable_link:${listingId}:${assetId}`
}

type AssetRef = { id: string; filename: string }

/**
 * The listing's address for this asset, made the first time it is asked for.
 *
 * Read, then insert, then read again on a conflict. The partial unique index is
 * what settles two writes racing here: exactly one insert lands, and the other
 * reads what it wrote, so both return the same address.
 */
export async function ensureDeliverableLink(params: {
  admin: Admin
  workspaceId: string
  listingId: string
  asset: AssetRef
}): Promise<string> {
  const { admin, workspaceId, listingId, asset } = params
  const origin = clientEnv().NEXT_PUBLIC_APP_URL
  const context = sealContext(listingId, asset.id)

  const existing = await readLiveToken(admin, workspaceId, listingId, asset.id, context)
  if (existing) return buildDeliverableLinkUrl(origin, asset.filename, existing)

  const token = randomBytes(TOKEN_BYTES).toString("base64url")
  const sealed = seal(token, context)

  const { error } = await admin.from("listing_deliverable_links").insert({
    workspace_id: workspaceId,
    channel_listing_id: listingId,
    asset_id: asset.id,
    token_hash: hashToken(token),
    token_sealed: sealed.ciphertext,
    key_version: sealed.keyVersion,
  })

  if (error) {
    // 23505: another write made this listing's address first. Use theirs.
    if (error.code === "23505") {
      const winner = await readLiveToken(admin, workspaceId, listingId, asset.id, context)
      if (winner) return buildDeliverableLinkUrl(origin, asset.filename, winner)
    }
    throw new Error(`could not create a deliverable address: ${error.message}`)
  }

  return buildDeliverableLinkUrl(origin, asset.filename, token)
}

async function readLiveToken(
  admin: Admin,
  workspaceId: string,
  listingId: string,
  assetId: string,
  context: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from("listing_deliverable_links")
    .select("id, token_sealed, key_version")
    .eq("workspace_id", workspaceId)
    .eq("channel_listing_id", listingId)
    .eq("asset_id", assetId)
    .is("revoked_at", null)
    .maybeSingle()

  if (error) throw new Error(`could not read a deliverable address: ${error.message}`)
  if (!data) return null

  const token = open({ ciphertext: data.token_sealed, keyVersion: data.key_version }, context)

  // Re-sealed on read under the active key, as connection secrets are (ADR
  // 0003), so an old key can be retired without breaking an address a store
  // already holds. Best effort: the token itself does not change.
  if (isStale(data.key_version)) {
    const resealed = seal(token, context)
    await admin
      .from("listing_deliverable_links")
      .update({ token_sealed: resealed.ciphertext, key_version: resealed.keyVersion })
      .eq("id", data.id)
  }

  return token
}

export type ResolvedDeliverable = { storagePath: string; filename: string }

/**
 * What a token may serve, or null.
 *
 * Null covers every refusal alike (malformed, unknown, revoked, an asset that is
 * no longer a buyer file or no longer ready) so the route answers each of them
 * identically and a caller learns nothing about which tokens once existed.
 */
export async function resolveDeliverableLink(
  admin: Admin,
  token: string,
): Promise<ResolvedDeliverable | null> {
  if (!isWellFormedToken(token)) return null

  const { data: link } = await admin
    .from("listing_deliverable_links")
    .select("id, asset_id, workspace_id, revoked_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle()

  if (!link || link.revoked_at !== null) return null

  const { data: asset } = await admin
    .from("product_assets")
    .select("storage_path, filename, asset_type, asset_state")
    .eq("id", link.asset_id)
    .eq("workspace_id", link.workspace_id)
    .maybeSingle()

  if (!asset) return null
  if (!(DELIVERABLE_TYPES as readonly string[]).includes(asset.asset_type)) return null
  if (asset.asset_state !== "ready") return null

  // Bookkeeping, and never a reason to refuse a buyer their file.
  await admin
    .from("listing_deliverable_links")
    .update({ last_downloaded_at: new Date().toISOString() })
    .eq("id", link.id)

  return { storagePath: asset.storage_path, filename: asset.filename }
}
