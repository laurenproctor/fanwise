import { createClient } from "@/lib/supabase/server"
import { eligibilityFromBlocker, type DraftDeletionEligibility } from "./draft-deletion"
import type { Product, ProductAsset } from "./types"

/**
 * Reads run as the signed-in user, so RLS does the tenant filtering. None of
 * these can return another workspace's row even if a caller forgets to scope.
 */

export async function listProducts(workspaceId: string): Promise<Product[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })

  if (error) throw error
  return data ?? []
}

/**
 * Returns null rather than throwing for a product the user cannot see, so a
 * caller cannot distinguish "does not exist" from "not yours".
 */
export async function getProductBySlug(workspaceId: string, slug: string): Promise<Product | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("slug", slug)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function listProductAssets(productId: string): Promise<ProductAsset[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("product_assets")
    .select("*")
    .eq("product_id", productId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })

  if (error) throw error
  return data ?? []
}

export async function getAsset(assetId: string): Promise<ProductAsset | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("product_assets")
    .select("*")
    .eq("id", assetId)
    .maybeSingle()

  if (error) throw error
  return data
}

/**
 * Whether the product page should offer Delete draft, and if not, why.
 *
 * Asks the database the same question `delete_product_draft()` asks under
 * lock, rather than re-deriving it from what the page happened to load, so the
 * offer and the outcome come from one definition. It is still only an offer:
 * the deletion checks again. A read that fails hides the section, because a
 * control that might not work is worse than one that is not there.
 */
export async function getDraftDeletionEligibility(
  productId: string,
): Promise<DraftDeletionEligibility> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("product_draft_deletion_blocker", {
    p_product_id: productId,
  })

  if (error) {
    console.error("[products] could not read draft deletion eligibility", {
      productId,
      code: error.code,
    })
    return { kind: "hidden" }
  }
  return eligibilityFromBlocker(data)
}

/** Groups derivatives under the source they came from, for the asset list. */
export function groupDerivatives(assets: ProductAsset[]): {
  sources: ProductAsset[]
  derivativesBySource: Map<string, ProductAsset[]>
} {
  const sources = assets.filter((a) => a.derived_from === null)
  const derivativesBySource = new Map<string, ProductAsset[]>()

  for (const asset of assets) {
    if (!asset.derived_from) continue
    const list = derivativesBySource.get(asset.derived_from) ?? []
    list.push(asset)
    derivativesBySource.set(asset.derived_from, list)
  }

  return { sources, derivativesBySource }
}
