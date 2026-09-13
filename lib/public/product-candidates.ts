import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/supabase/database.types"
import { loadCatalog } from "@/lib/catalog/queries"
import { PRODUCT_TYPE_LABELS, type ProductType } from "@/lib/products/types"
import { routes } from "@/lib/routes"
import { candidatesFrom, type ProductCandidate } from "./product-arrangement"

/**
 * The products a workspace's profile builder may arrange.
 *
 * Read with the catalog's own loader, so "live on a connected shop" means
 * exactly what the catalog screen shows, computed by the same `liveness()`
 * rule rather than a second opinion kept here. Every read is RLS-scoped to the
 * signed-in member; another workspace's products never come back.
 *
 * Images are members-only preview routes. The builder is private, and these
 * URLs are never rendered on the public page, which serves its own.
 */
export async function loadProductCandidates(
  supabase: SupabaseClient<Database>,
  ctx: { workspaceId: string; profile: { id: string } },
  workspaceSlug: string,
): Promise<ProductCandidate[]> {
  const [catalog, pages] = await Promise.all([
    loadCatalog(ctx.workspaceId),
    supabase
      .from("public_product_pages")
      .select("product_id, title_override, cover_asset_id, display_order")
      .eq("public_profile_id", ctx.profile.id),
  ])

  return candidatesFrom(catalog, pages.data ?? [], {
    typeLabel: (type) => PRODUCT_TYPE_LABELS[type as ProductType] ?? type,
    imageUrl: (assetId) => routes.assetPreview(workspaceSlug, assetId),
  })
}
