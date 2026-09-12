"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { jobs } from "@/lib/jobs"
import { routes } from "@/lib/routes"
import { toJson } from "./json"
import { startImport } from "./start"
import { getImport } from "./queries"

/**
 * Everything the import screen can ask the server to do.
 *
 * Every action re-establishes who the caller is and which workspace they are
 * acting in before it touches anything. "The page rendered the button" is not
 * authorization (docs/security.md rule 7), and these are the actions that
 * create products, spend a model call and write a rights attestation.
 *
 * Nothing here reads a page. That is the job's work, behind the outbound
 * boundary, off the interactive request (rule 7 again): a creator pressing
 * Analyze gets a row and a redirect, and the reading happens where it can take
 * fifteen seconds without holding a request open.
 */

export interface ImportActionState {
  error: string | null
}

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
 * Paste a link, get an import.
 *
 * Redirects on success, including when the link was already imported: the
 * destination is the import that exists, not a second one. See `startImport`
 * for why the database rather than this function is what makes that true.
 */
export async function startImportAction(
  workspaceSlug: string,
  _prev: ImportActionState,
  formData: FormData,
): Promise<ImportActionState> {
  const { supabase, user, workspace } = await requireWorkspace(workspaceSlug)

  const outcome = await startImport({
    supabase,
    workspaceId: workspace.id,
    userId: user.id,
    rawUrl: String(formData.get("sourceUrl") ?? ""),
  })

  if (outcome.kind === "invalid" || outcome.kind === "error") {
    return { error: outcome.message }
  }

  revalidatePath(routes.workspace(workspaceSlug))
  redirect(routes.productImport(workspaceSlug, outcome.importId))
}

/** Read the same link again. Only from a state where that could answer differently. */
export async function retryImportAction(
  workspaceSlug: string,
  importId: string,
): Promise<ImportActionState> {
  const { supabase, workspace } = await requireWorkspace(workspaceSlug)

  /*
    Moved to `pending` under a status guard, so two retries are one retry: the
    second update matches nothing and enqueues nothing. `ready` is excluded
    because re-reading a finished import is a refresh, which is a different
    action with different rules about what it may overwrite.
  */
  const { data, error } = await supabase
    .from("product_imports")
    .update({ status: "pending", error_code: null, error_message: null })
    .eq("id", importId)
    .eq("workspace_id", workspace.id)
    .in("status", ["failed", "unavailable"])
    .select("id")
    .maybeSingle()

  if (error) {
    console.error("[imports] could not queue a retry", { importId, error })
    return { error: "That could not be retried. Try again." }
  }
  if (!data) return { error: null }

  await jobs.enqueue(
    "import_source",
    { workspaceId: workspace.id, importId },
    { idempotencyKey: `${importId}:${Date.now()}` },
  )

  revalidatePath(routes.productImport(workspaceSlug, importId))
  return { error: null }
}

/**
 * Abandon an import.
 *
 * Sets `discarded` rather than deleting, which keeps the record of what was
 * attempted and frees the URL for a fresh import through the partial unique
 * index. The product goes with it: a draft nobody finished, created by a paste,
 * is not something to leave in a catalog.
 */
export async function discardImportAction(
  workspaceSlug: string,
  importId: string,
): Promise<ImportActionState> {
  const { supabase, workspace } = await requireWorkspace(workspaceSlug)

  const record = await getImport(supabase, workspace.id, importId)
  if (!record) return { error: null }

  const { error } = await supabase
    .from("product_imports")
    .update({ status: "discarded" })
    .eq("id", importId)
    .eq("workspace_id", workspace.id)

  if (error) {
    console.error("[imports] could not discard", { importId, error })
    return { error: "That could not be discarded. Try again." }
  }

  // The import row cascades with the product, so the product is deleted last
  // and the discarded status above is what survives if this fails.
  await supabase
    .from("products")
    .delete()
    .eq("id", record.row.product_id)
    .eq("workspace_id", workspace.id)

  revalidatePath(routes.workspace(workspaceSlug))
  redirect(routes.workspace(workspaceSlug))
}

export interface SaveDraftInput {
  title: string
  productType: string
  price: string
  currency: string
  description: string
  /** Which fields the creator has settled, with the marker they settled from. */
  accepted: Record<string, { origin: string }>
  licenseSummary: string | null
  confirmRights: boolean
}

/**
 * Saving the listing draft onto the canonical product.
 *
 * **This is the only path by which an imported or suggested value reaches
 * `products`,** and it runs because a person pressed Save. That is architecture
 * invariant 5's requirement in one sentence: a model's proposal becomes a fact
 * Fanwise is willing to restate elsewhere only after somebody looked at it.
 *
 * `accepted` is written alongside, and the runner never touches it, so a later
 * re-read of the page cannot argue with a decision made here.
 */
export async function saveImportDraftAction(
  workspaceSlug: string,
  importId: string,
  input: SaveDraftInput,
): Promise<ImportActionState> {
  const { supabase, user, workspace } = await requireWorkspace(workspaceSlug)

  const record = await getImport(supabase, workspace.id, importId)
  if (!record) return { error: "That import could not be found." }

  const { updateProductSchema } = await import("@/lib/products/schemas")
  const parsed = updateProductSchema.safeParse({
    name: input.title,
    productType: input.productType,
    canonicalTitle: input.title,
    canonicalDescription: input.description,
    shortDescription: "",
    brandName: "",
    basePrice: input.price,
    currency: input.currency,
    version: "",
    supportUrl: "",
    documentationUrl: "",
    licenseSummary: input.licenseSummary ?? "",
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the listing details." }
  }

  const rights = input.confirmRights
    ? { rights_confirmed_at: new Date().toISOString(), rights_confirmed_by: user.id }
    : {}

  const { error: productError } = await supabase
    .from("products")
    .update({
      name: parsed.data.name,
      product_type: parsed.data.productType,
      canonical_title: parsed.data.canonicalTitle ?? null,
      canonical_description: parsed.data.canonicalDescription ?? null,
      base_price: parsed.data.basePrice ?? null,
      currency: parsed.data.currency,
      license_summary: parsed.data.licenseSummary ?? null,
      ...rights,
    })
    .eq("id", record.row.product_id)
    .eq("workspace_id", workspace.id)

  if (productError) {
    console.error("[imports] could not save the draft", { importId, error: productError })
    return { error: "That could not be saved. Try again." }
  }

  const { error: importError } = await supabase
    .from("product_imports")
    .update({ accepted: toJson({ ...(record.row.accepted as object), ...input.accepted }) })
    .eq("id", importId)
    .eq("workspace_id", workspace.id)

  if (importError) {
    console.error("[imports] could not record what was accepted", { importId, error: importError })
    return { error: "That could not be saved. Try again." }
  }

  revalidatePath(routes.productImport(workspaceSlug, importId))
  return { error: null }
}
