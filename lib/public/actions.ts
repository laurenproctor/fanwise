"use server"

import { randomUUID } from "node:crypto"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { routes, publicInternal } from "@/lib/routes"
import { suggestHandle } from "./handles"
import { publicProductPageSchema } from "./schemas"
import { EMPTY_PAGE_STATE, type PublicProductPageState } from "./form-state"

/**
 * Managing the public surface, from inside the application.
 *
 * Authorization is RLS throughout. Every statement here runs as the signed-in
 * user through `createClient()`, so a workspace slug belonging to someone else
 * matches no row — indistinguishable from one that does not exist, which is
 * the point — and the two rename RPCs re-check membership inside the function
 * because `security definer` means their own privileges apply once running.
 *
 * Nothing in this file publishes. Creating a profile leaves it a draft, and
 * creating or editing a product page's overrides never changes whether it is
 * public. The profile builder is the one way anything becomes public
 * (./publish-actions.ts): it decides which product pages a profile shows and
 * in what order, and publishes them with the profile in one transaction.
 */

/**
 * Creates the workspace's public profile, as a draft.
 *
 * The handle is suggested from the workspace name and is the creator's to
 * change before anything is published. A suggestion that collides falls back
 * to a suffixed form rather than failing: arriving at an empty settings page
 * and being told the name of your own studio is taken is a bad first minute.
 */
export async function createPublicProfileAction(
  workspaceSlug: string,
  // Where to land afterwards. Bound alongside the slug, so a form's FormData
  // never arrives in this position.
  destination: "settings" | "builder",
): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/sign-in")

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("slug", workspaceSlug)
    .maybeSingle()
  if (!workspace) redirect(routes.settings(workspaceSlug))

  const base = suggestHandle(workspace.name) || "studio"

  // Up to a handful of attempts, each with a fresh suffix. The unique index and
  // the history trigger are the real arbiters; this loop only decides how many
  // times to ask before giving the creator a field to fill in themselves.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const handle =
      attempt === 0 ? base : `${base}-${randomUUID().slice(0, 4)}`.slice(0, 32).replace(/-+$/, "")

    const { error } = await supabase.from("public_profiles").insert({
      workspace_id: workspace.id,
      handle,
      display_name: workspace.name,
      status: "draft",
    })

    if (!error) break
    // 23505 is the unique index or one of the handle-namespace triggers. Any
    // other error is not a collision and retrying would not help.
    if (error.code !== "23505") {
      console.error("[public] could not create profile", error)
      break
    }
  }

  revalidatePath(routes.publicProfileSettings(workspaceSlug))
  redirect(
    destination === "builder"
      ? routes.publicProfileBuilder(workspaceSlug)
      : routes.publicProfileSettings(workspaceSlug),
  )
}

// ---------------------------------------------------------------------------
// Product pages
// ---------------------------------------------------------------------------

/**
 * Gives a product a public page, as a draft.
 *
 * The slug is seeded from the product's own slug, which is already unique per
 * workspace and already the right shape. It is not the same identifier
 * afterwards: a creator may rename either without touching the other, which is
 * the whole reason the public slug is its own column rather than a join.
 */
export async function createPublicProductPageAction(
  workspaceSlug: string,
  productSlug: string,
): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/sign-in")

  const workspaceId = await workspaceIdFor(supabase, workspaceSlug)
  if (!workspaceId) redirect(routes.workspace(workspaceSlug))

  const [{ data: profile }, { data: product }] = await Promise.all([
    supabase.from("public_profiles").select("id").eq("workspace_id", workspaceId).maybeSingle(),
    supabase
      .from("products")
      .select("id, slug")
      .eq("workspace_id", workspaceId)
      .eq("slug", productSlug)
      .maybeSingle(),
  ])

  // No profile yet means the creator has not claimed a handle. Sending them to
  // settings is more use than an error telling them so.
  if (!profile) redirect(routes.publicProfileSettings(workspaceSlug))
  if (!product) redirect(routes.workspace(workspaceSlug))

  const base = product.slug.toLowerCase()

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug =
      attempt === 0 ? base : `${base}-${randomUUID().slice(0, 4)}`.slice(0, 64).replace(/-+$/, "")

    const { error } = await supabase.from("public_product_pages").insert({
      workspace_id: workspaceId,
      public_profile_id: profile.id,
      product_id: product.id,
      slug,
      status: "draft",
    })

    if (!error) break
    if (error.code !== "23505") {
      console.error("[public] could not create product page", error)
      break
    }
    // A second page for the same product is refused by
    // public_product_pages_product_unique_per_profile and is not a slug
    // collision, so retrying with a suffix would loop to no purpose.
    if (error.message.includes("product_unique_per_profile")) break
  }

  revalidatePath(routes.product(workspaceSlug, productSlug))
  redirect(routes.product(workspaceSlug, productSlug))
}

export async function savePublicProductPageAction(
  workspaceSlug: string,
  productSlug: string,
  _prev: PublicProductPageState,
  formData: FormData,
): Promise<PublicProductPageState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/sign-in")

  const parsed = publicProductPageSchema.safeParse({
    slug: formData.get("slug") ?? "",
    titleOverride: formData.get("titleOverride") ?? "",
    summaryOverride: formData.get("summaryOverride") ?? "",
    descriptionOverride: formData.get("descriptionOverride") ?? "",
    coverAssetId: formData.get("coverAssetId") ?? "",
    seoTitle: formData.get("seoTitle") ?? "",
    seoDescription: formData.get("seoDescription") ?? "",
  })

  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const field = (issue?.path[0] as keyof PublicProductPageState["fieldErrors"]) ?? "slug"
    return {
      error: null,
      fieldErrors: { [field]: issue?.message ?? "Check that field." },
      savedAt: null,
      saved: null,
    }
  }
  const input = parsed.data

  const workspaceId = await workspaceIdFor(supabase, workspaceSlug)
  if (!workspaceId) {
    return { ...EMPTY_PAGE_STATE, error: "That page could not be saved. Try again." }
  }

  // The product first, by its own slug, then its public page. Two reads
  // rather than one filtered through an embed: the public slug and the product
  // slug are independent by design, so there is nothing to join them on except
  // the product id.
  const { data: product } = await supabase
    .from("products")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("slug", productSlug)
    .maybeSingle()

  if (!product) {
    return { ...EMPTY_PAGE_STATE, error: "That page could not be saved. Try again." }
  }

  const { data: target } = await supabase
    .from("public_product_pages")
    .select("id, slug, public_profile_id, public_profiles(handle)")
    .eq("workspace_id", workspaceId)
    .eq("product_id", product.id)
    .maybeSingle()

  if (!target) {
    return { ...EMPTY_PAGE_STATE, error: "That page could not be saved. Try again." }
  }

  const nextSlug = input.slug.trim().toLowerCase()
  if (nextSlug !== target.slug.toLowerCase()) {
    const { error: renameError } = await supabase.rpc("release_public_product_slug", {
      p_public_product_page_id: target.id,
      p_new_slug: nextSlug,
    })
    if (renameError) {
      const taken = renameError.code === "23505" || renameError.code === "23514"
      return {
        error: null,
        fieldErrors: {
          slug: taken
            ? "That address is already used by another product. Choose another."
            : "That address could not be saved. Try again.",
        },
        savedAt: null,
        saved: null,
      }
    }
  }

  const { error: updateError } = await supabase
    .from("public_product_pages")
    .update({
      title_override: input.titleOverride,
      summary_override: input.summaryOverride,
      description_override: input.descriptionOverride,
      cover_asset_id: input.coverAssetId,
      seo_title: input.seoTitle,
      seo_description: input.seoDescription,
    })
    .eq("id", target.id)

  if (updateError) {
    console.error("[public] product page update failed", updateError)
    // 23503 is the cover asset foreign key: an image that is not this
    // workspace's own, which the picker cannot produce but a replayed form can.
    if (updateError.code === "23503") {
      return {
        error: null,
        fieldErrors: { coverAssetId: "Choose one of this product's own images." },
        savedAt: null,
        saved: null,
      }
    }
    return { ...EMPTY_PAGE_STATE, error: "That page could not be saved. Try again." }
  }

  const handle = target.public_profiles?.handle
  if (handle) revalidatePublic(workspaceSlug, handle, handle)
  revalidatePath(routes.product(workspaceSlug, productSlug))

  return { error: null, fieldErrors: {}, savedAt: Date.now(), saved: { slug: nextSlug } }
}

// ---------------------------------------------------------------------------

async function workspaceIdFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceSlug: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("workspaces")
    .select("id")
    .eq("slug", workspaceSlug)
    .maybeSingle()
  return data?.id ?? null
}

/**
 * Invalidates everything a change to the public surface can be seen through.
 *
 * Both handles, because a rename leaves a permanent redirect at the old one
 * and that redirect's own response is cached. The internal rewrite target is
 * revalidated rather than the `/@handle` form, because the rewrite means the
 * cache entry is filed under the internal path; revalidating the address a
 * visitor types would miss it.
 *
 * `layout` rather than `page` so the product pages beneath a profile go too. A
 * profile that unpublishes has to take its whole subtree with it, and this is
 * the cache half of the rule the RLS policies enforce in the database.
 */
function revalidatePublic(workspaceSlug: string, oldHandle: string, newHandle: string): void {
  revalidatePath(routes.publicProfileSettings(workspaceSlug))
  for (const handle of new Set([oldHandle.toLowerCase(), newHandle.toLowerCase()])) {
    revalidatePath(publicInternal(handle), "layout")
  }
}
