import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { routes } from "@/lib/routes"
import { removeObjects } from "./storage"
import { deleteDraftResultSchema, type DraftDeletionOutcome } from "./draft-deletion"

/**
 * Permanently deleting a product draft. The one implementation.
 *
 * Called by the product page's Delete draft action and by the import screen's
 * discard, which used to delete the product itself: straight at the table,
 * with the result ignored, a redirect either way, and the product's own files
 * left in storage. Both now come through here, and neither redirects unless
 * this says the product is gone.
 *
 * Deliberately not a "use server" module. Every export of one is a public
 * endpoint, and this takes no confirmation; the actions that call it are the
 * endpoints, and each checks its own.
 *
 * The order is the point:
 *
 *   1. Who is asking, again. The page rendering a button is not authorization
 *      (docs/security.md rule 7).
 *   2. The product, read through RLS within the workspace the URL names. An id
 *      from elsewhere reads as not found, exactly as a missing one does.
 *   3. `delete_product_draft()`, which locks, re-checks ownership and every
 *      blocker, and deletes in one transaction. Its answer is parsed before
 *      anything acts on it.
 *   4. Storage, only after that transaction has committed. Removing objects
 *      first would leave visible rows pointing at nothing whenever the
 *      database then refused. A failure here is logged and does not undo the
 *      deletion: what is left is private bytes no row points at.
 *   5. Revalidation.
 */

const productIdSchema = z.uuid()

export async function deleteProductDraft(input: {
  workspaceSlug: string
  productId: string
}): Promise<DraftDeletionOutcome> {
  const productId = productIdSchema.safeParse(input.productId)
  if (!productId.success) return { kind: "not_found" }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/sign-in")

  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("id, slug")
    .eq("slug", input.workspaceSlug)
    .maybeSingle()

  if (workspaceError) {
    console.error("[products] draft deletion could not read the workspace", {
      code: workspaceError.code,
    })
    return { kind: "failed" }
  }
  if (!workspace) return { kind: "not_found" }

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id, slug")
    .eq("id", productId.data)
    .eq("workspace_id", workspace.id)
    .maybeSingle()

  if (productError) {
    console.error("[products] draft deletion could not read the product", {
      productId: productId.data,
      code: productError.code,
    })
    return { kind: "failed" }
  }
  if (!product) return { kind: "not_found" }

  const { data, error } = await supabase.rpc("delete_product_draft", {
    p_product_id: product.id,
  })

  if (error) {
    // Rule 8: the original stays in the log, the creator gets a sentence.
    console.error("[products] draft deletion failed", { productId: product.id, error })
    return { kind: "failed" }
  }

  const parsed = deleteDraftResultSchema.safeParse(data)
  if (!parsed.success) {
    console.error("[products] draft deletion returned an unexpected shape", {
      productId: product.id,
      issues: parsed.error.issues,
    })
    return { kind: "failed" }
  }

  const result = parsed.data
  if (result.outcome === "not_found") return { kind: "not_found" }
  if (result.outcome === "blocked") return { kind: "blocked", blocker: result.blocker }

  // Committed. Everything from here is cleanup, and none of it can make the
  // product come back.
  await removeAfterCommit(product.id, "product assets", result.asset_paths)
  await removeAfterCommit(product.id, "import sources", result.import_source_paths)

  /*
    The layout revalidation covers the catalog and everything under the
    workspace, including the product's own page and the profile builder whose
    draft arrangement the database just rewrote. The named paths are said
    anyway so the intent is readable here. No public route is revalidated
    because none can have changed: a product with a public page is never
    deletable, and a profile only lists products that have one.
  */
  revalidatePath(routes.workspace(workspace.slug), "layout")
  revalidatePath(routes.product(workspace.slug, product.slug))
  revalidatePath(routes.profile(workspace.slug))
  revalidatePath(routes.publicProfileBuilderProducts(workspace.slug))

  return { kind: "deleted", workspaceSlug: workspace.slug }
}

/**
 * Both lists live in the product-assets bucket, which `removeObjects` names;
 * they are removed as two calls so a log line says which kind was left behind.
 */
async function removeAfterCommit(productId: string, kind: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  try {
    await removeObjects(paths)
  } catch (cause) {
    console.error("[products] deleted a draft but not all of its stored objects", {
      productId,
      kind,
      count: paths.length,
      error: cause,
    })
  }
}
