import { createClient } from "@/lib/supabase/server"
import { createAvatarUrl } from "./avatars"
import type { PublicPageStatus, PublicProductPageRow, PublicProfileRow } from "./types"

/**
 * Reading the public surface from inside the application, as a member.
 *
 * The mirror of `./queries.ts`, and the two are kept apart on purpose. That
 * file is the public read path and must never see a draft; this one is the
 * management read path and exists to see drafts. Sharing a module between them
 * would mean one function whose visibility depends on which client happened to
 * be passed in, and the first refactor that dropped an argument would make a
 * public page start rendering unpublished work.
 *
 * Everything here goes through `createClient()`, so RLS scopes it to the
 * caller's own workspaces. There is no workspace-id check written in this
 * file, because a row from another workspace does not come back to be checked.
 */

export interface ProfileForSettings {
  profile: PublicProfileRow
  /** Minted per render. Null when the object is gone, which falls back to initials. */
  avatarUrl: string | null
  publishedCount: number
  draftCount: number
}

export async function getProfileForSettings(
  workspaceId: string,
): Promise<ProfileForSettings | null> {
  const supabase = await createClient()

  const { data: profile } = await supabase
    .from("public_profiles")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  if (!profile) return null

  const [{ data: pages }, avatarUrl] = await Promise.all([
    supabase.from("public_product_pages").select("status").eq("public_profile_id", profile.id),
    profile.avatar_path ? createAvatarUrl(profile.avatar_path) : Promise.resolve(null),
  ])

  return {
    profile,
    avatarUrl,
    publishedCount: (pages ?? []).filter((p) => p.status === "published").length,
    draftCount: (pages ?? []).filter((p) => p.status === "draft").length,
  }
}

export interface ProductPageForEditor {
  page: PublicProductPageRow | null
  /** Null when the workspace has no public profile yet, which the UI must say. */
  handle: string | null
  profileStatus: PublicPageStatus | null
  /** The product's own gallery images, for the cover picker. */
  images: Array<{ id: string; filename: string; assetType: string }>
}

/**
 * Everything the product editor's Public page section needs, in one read.
 *
 * The profile is fetched even when no page exists, because the section has to
 * distinguish three states a creator experiences very differently: there is no
 * public profile yet, there is one but this product is not on it, and this
 * product has a page. Collapsing the first two into "not published" sends
 * somebody looking for a button that is not there.
 */
export async function getProductPageForEditor(
  workspaceId: string,
  productId: string,
): Promise<ProductPageForEditor> {
  const supabase = await createClient()

  const [{ data: profile }, { data: page }, { data: assets }] = await Promise.all([
    supabase
      .from("public_profiles")
      .select("id, handle, status")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    supabase
      .from("public_product_pages")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("product_id", productId)
      .maybeSingle(),
    supabase
      .from("product_assets")
      .select("id, filename, asset_type, sort_order, asset_state, mime_type")
      .eq("product_id", productId)
      .eq("asset_state", "ready")
      .order("sort_order", { ascending: true }),
  ])

  return {
    page: page ?? null,
    handle: profile?.handle ?? null,
    profileStatus: profile?.status ?? null,
    images: (assets ?? [])
      .filter((a) => GALLERY_TYPES.has(a.asset_type) && a.mime_type?.startsWith("image/"))
      .map((a) => ({ id: a.id, filename: a.filename, assetType: a.asset_type })),
  }
}

/** Matches the gallery set the public page renders. Deliverables never appear. */
const GALLERY_TYPES = new Set([
  "cover_image",
  "preview_image",
  "specimen",
  "screenshot",
  "promotional",
])
