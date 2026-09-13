"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { jobs } from "@/lib/jobs"
import { routes } from "@/lib/routes"
import { toJson } from "./json"
import { linkLabel } from "./composer"
import { removeStoredSource } from "./source-storage"
import { getImport, listDeliverables } from "./queries"
import { CUSTOM_LICENSE_ID, RIGHTS_ATTESTATION_VERSION, licenseEntry, versionFor } from "./licenses"
import { importReadiness } from "./readiness"
import { deliverablesFor, draftFor, licenseFor, rightsFor, snapshotFor } from "./view"
import { normalizeSourceUrl, validateSourceUrl } from "./url"
import { linkKindFor } from "./start"

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
 * Try the sources that did not read again.
 *
 * Every failed or unavailable source goes back to `pending` and the session
 * with it, under status guards, so two retries are one retry. Sources that were
 * read are left alone: their evidence stands, and if a retried source reads the
 * same words as before, the combined hash matches and no model is called.
 */
export async function retryImportAction(
  workspaceSlug: string,
  importId: string,
): Promise<ImportActionState> {
  const { supabase, workspace } = await requireWorkspace(workspaceSlug)

  const { data, error } = await supabase
    .from("product_imports")
    .update({ status: "pending", error_code: null, error_message: null })
    .eq("id", importId)
    .eq("workspace_id", workspace.id)
    .in("status", ["failed", "unavailable"])
    .select("id")
    .maybeSingle()

  if (error) {
    console.error("[imports] could not queue a retry", { importId, code: error.code })
    return { error: "That could not be retried. Try again." }
  }
  if (!data) return { error: null }

  await supabase
    .from("product_import_sources")
    .update({ status: "pending", error_code: null, error_message: null })
    .eq("import_id", importId)
    .eq("workspace_id", workspace.id)
    .in("status", ["failed", "unavailable"])

  await jobs.enqueue("import_source", { workspaceId: workspace.id, importId })

  revalidatePath(routes.productImport(workspaceSlug, importId))
  return { error: null }
}

/**
 * Try one source again, from the sources list.
 *
 * The session goes back to `pending` too, so the draft is recomposed once the
 * source settles — and composes nothing new if the source reads as it did.
 */
export async function retrySourceAction(
  workspaceSlug: string,
  importId: string,
  sourceId: string,
): Promise<ImportActionState> {
  const { supabase, workspace } = await requireWorkspace(workspaceSlug)

  const { data, error } = await supabase
    .from("product_import_sources")
    .update({ status: "pending", error_code: null, error_message: null })
    .eq("id", sourceId)
    .eq("import_id", importId)
    .eq("workspace_id", workspace.id)
    .eq("status", "failed")
    .select("id")
    .maybeSingle()

  if (error) return { error: "That source could not be retried. Try again." }
  if (!data) return { error: null }

  await supabase
    .from("product_imports")
    .update({ status: "pending", error_code: null, error_message: null })
    .eq("id", importId)
    .eq("workspace_id", workspace.id)
    .in("status", ["ready", "failed", "unavailable"])

  await jobs.enqueue("import_source", { workspaceId: workspace.id, importId, sourceId })

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

  // Pasted and uploaded sources have no use once their import is abandoned.
  // Best effort: an object left behind is private, and wastes only space.
  const paths = [
    record.row.source_path,
    ...record.sources.map((source) => source.storage_path),
  ].filter((path): path is string => Boolean(path))
  for (const path of new Set(paths)) await removeStoredSource(path).catch(() => undefined)
  await supabase
    .from("product_import_sources")
    .update({ status: "removed", error_code: null, error_message: null })
    .eq("import_id", importId)
    .eq("workspace_id", workspace.id)

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

/* ------------------------------------------------------------------ licence */

/**
 * Choosing a licence.
 *
 * **The version is read from the catalogue here, never taken from the browser.**
 * A version is a claim about which wording Fanwise showed, and a client that
 * supplied it could record that a creator accepted terms they never saw.
 *
 * Terms the creator wrote are stored verbatim and versioned `own`, because
 * there is no catalogue entry for them to be out of date with.
 */
export async function setLicenseAction(
  workspaceSlug: string,
  importId: string,
  input: { licenseId: string; customSummary: string | null },
): Promise<ImportActionState> {
  const { supabase, workspace } = await requireWorkspace(workspaceSlug)

  const record = await getImport(supabase, workspace.id, importId)
  if (!record) return { error: "That import could not be found." }

  const custom = input.licenseId === CUSTOM_LICENSE_ID
  const entry = custom ? null : licenseEntry(input.licenseId)
  if (!custom && !entry) return { error: "That is not a licence Fanwise offers." }

  const summary = custom ? (input.customSummary ?? "").trim() : entry!.summary
  if (summary.length === 0) {
    return { error: "Say what a buyer may and may not do with this." }
  }
  if (summary.length > 2000) {
    return { error: "Keep the licence terms under 2000 characters." }
  }

  const { error } = await supabase
    .from("products")
    .update({
      license_id: input.licenseId,
      license_version: versionFor(input.licenseId),
      license_summary: summary,
      license_accepted_at: new Date().toISOString(),
    })
    .eq("id", record.row.product_id)
    .eq("workspace_id", workspace.id)

  if (error) {
    console.error("[imports] could not record the licence", { importId, error })
    return { error: "That licence could not be saved. Try again." }
  }

  revalidatePath(routes.productImport(workspaceSlug, importId))
  return { error: null }
}

/* ---------------------------------------------------------------- ownership */

/**
 * Recording the creator's statement about rights.
 *
 * Three things are written and none of them are optional: who said it, when,
 * and which wording they agreed to. The user id comes from the session, never
 * from the form — a browser saying who confirmed is not evidence of anything.
 *
 * The second disclosure is written in the same call, because it is asked in the
 * same breath. `third_party_declared_at` set with `third_party_components` null
 * is the creator saying there are none, which is a different state from not
 * having been asked and has to stay distinguishable.
 *
 * Fanwise records the statement. It does not check it, and the copy beside the
 * control says so.
 */
export async function confirmOwnershipAction(
  workspaceSlug: string,
  importId: string,
  input: { thirdPartyComponents: string | null },
): Promise<ImportActionState> {
  const { supabase, user, workspace } = await requireWorkspace(workspaceSlug)

  const record = await getImport(supabase, workspace.id, importId)
  if (!record) return { error: "That import could not be found." }

  const components = (input.thirdPartyComponents ?? "").trim()
  if (components.length > 4000) {
    return { error: "Keep the list of third-party components under 4000 characters." }
  }

  const now = new Date().toISOString()
  const { error } = await supabase
    .from("products")
    .update({
      rights_confirmed_at: now,
      rights_confirmed_by: user.id,
      rights_attestation_version: RIGHTS_ATTESTATION_VERSION,
      third_party_declared_at: now,
      third_party_components: components.length > 0 ? components : null,
    })
    .eq("id", record.row.product_id)
    .eq("workspace_id", workspace.id)

  if (error) {
    console.error("[imports] could not record the attestation", { importId, error })
    return { error: "That confirmation could not be saved. Try again." }
  }

  revalidatePath(routes.productImport(workspaceSlug, importId))
  return { error: null }
}

/**
 * Withdrawing the statement.
 *
 * Offered because an attestation a creator cannot take back is one they will
 * hesitate to make. Clearing it clears the version too, which the constraint
 * requires: two of the three columns is a row nobody can interpret.
 */
export async function withdrawOwnershipAction(
  workspaceSlug: string,
  importId: string,
): Promise<ImportActionState> {
  const { supabase, workspace } = await requireWorkspace(workspaceSlug)

  const record = await getImport(supabase, workspace.id, importId)
  if (!record) return { error: "That import could not be found." }

  const { error } = await supabase
    .from("products")
    .update({
      rights_confirmed_at: null,
      rights_confirmed_by: null,
      rights_attestation_version: null,
    })
    .eq("id", record.row.product_id)
    .eq("workspace_id", workspace.id)

  if (error) return { error: "That could not be withdrawn. Try again." }

  revalidatePath(routes.productImport(workspaceSlug, importId))
  return { error: null }
}

/* ------------------------------------------------------------- buyer files */

/**
 * Removing a buyer file.
 *
 * Refuses to remove the last ready deliverable, which is what makes "replace"
 * safe: a creator uploads the new file first, and the old one cannot be taken
 * away until the new one has been measured and found to be real. A replacement
 * that fails therefore leaves the original exactly where it was, without
 * anything having to remember to put it back.
 */
export async function removeDeliverableAction(
  workspaceSlug: string,
  importId: string,
  assetId: string,
): Promise<ImportActionState> {
  const { supabase, workspace } = await requireWorkspace(workspaceSlug)

  const record = await getImport(supabase, workspace.id, importId)
  if (!record) return { error: "That import could not be found." }

  const files = await listDeliverables(supabase, workspace.id, record.row.product_id)
  const target = files.find((file) => file.id === assetId)
  if (!target) return { error: "That file could not be found." }

  const otherReady = files.some((file) => file.id !== assetId && file.asset_state === "ready")
  if (target.asset_state === "ready" && !otherReady) {
    return {
      error: "That is the only file buyers would receive. Upload its replacement first.",
    }
  }

  const { deleteAssetAction } = await import("@/lib/products/actions")
  const result = await deleteAssetAction(workspaceSlug, assetId)
  if (result.error) return { error: result.error }

  revalidatePath(routes.productImport(workspaceSlug, importId))
  return { error: null }
}

/* --------------------------------------------------------- source replacement */

/**
 * Pointing the same import at a different link.
 *
 * Not a discard. The product, the creator's edits, the uploaded files, the
 * licence and the attestation all stay exactly where they are; what changes is
 * the page the evidence comes from. The previous reading is kept so the screen
 * can show what is different before a creator accepts any of it — and because
 * suggestions never reach `products` without a save, a re-read cannot overwrite
 * anything they have already settled.
 */
export async function replaceSourceAction(
  workspaceSlug: string,
  importId: string,
  rawUrl: string,
): Promise<ImportActionState> {
  const { supabase, workspace } = await requireWorkspace(workspaceSlug)

  const checked = validateSourceUrl(rawUrl)
  if (!checked.ok) return { error: checked.message }

  const record = await getImport(supabase, workspace.id, importId)
  if (!record) return { error: "That import could not be found." }
  // An import with no link has no link to swap.
  const linkSource = record.sources.find((source) => source.source_type === "public_url")
  if (!record.row.source_url || !linkSource) {
    return { error: "This import was not made from a link, so there is no link to replace." }
  }

  const normalizedUrl = normalizeSourceUrl(checked.url)
  if (normalizedUrl === record.row.normalized_url) {
    return { error: "That is the link this import already uses." }
  }

  const { error } = await supabase
    .from("product_imports")
    .update({
      source_url: checked.url,
      normalized_url: normalizedUrl,
      provider: linkKindFor(new URL(checked.url)),
      status: "pending",
      error_code: null,
      error_message: null,
      resolved_url: null,
      // Kept for the change preview; the runner moves the current reading here.
      previous_evidence: record.row.evidence,
      previous_content_hash: record.row.content_hash,
    })
    .eq("id", importId)
    .eq("workspace_id", workspace.id)

  if (error) {
    // The one URL per workspace index. Another import already owns this link.
    if (error.code === "23505") {
      return { error: "You are already importing that link somewhere else." }
    }
    console.error("[imports] could not replace the source", { importId, error })
    return { error: "That link could not be swapped in. Try again." }
  }

  await supabase
    .from("product_import_sources")
    .update({
      source_url: checked.url,
      normalized_url: normalizedUrl,
      display_name: linkLabel(checked.url),
      status: "pending",
      evidence: {},
      content_hash: null,
      error_code: null,
      error_message: null,
    })
    .eq("id", linkSource.id)
    .eq("workspace_id", workspace.id)

  await jobs.enqueue("import_source", { workspaceId: workspace.id, importId })

  revalidatePath(routes.productImport(workspaceSlug, importId))
  return { error: null }
}

/* -------------------------------------------------------------- the handoff */

export type ReviewOutcome =
  | { kind: "ready"; href: string }
  | { kind: "blocked"; reason: string }
  | { kind: "error"; message: string }

/**
 * Reaching the marketplace drafts.
 *
 * **The gate is recomputed here from what is persisted**, not from what the
 * screen believed. A browser holding an unsaved licence is a browser that can
 * show 100%; only the database can say whether the five steps are actually
 * done, and this is the last place to ask before a creator is handed to the
 * publishing flow.
 *
 * There is no new flow on the other side. The product page is where channel
 * drafts have always been built, reviewed and published, and this returns its
 * address. Adding a second marketplace surface for imported products would be
 * two places to fix every time a channel changes.
 */
export async function reviewMarketplaceDraftsAction(
  workspaceSlug: string,
  importId: string,
): Promise<ReviewOutcome> {
  const { supabase, workspace } = await requireWorkspace(workspaceSlug)

  const record = await getImport(supabase, workspace.id, importId)
  if (!record) return { kind: "error", message: "That import could not be found." }

  const assets = await listDeliverables(supabase, workspace.id, record.row.product_id)
  const readiness = importReadiness({
    snapshot: snapshotFor(record),
    draft: draftFor(record),
    deliverables: deliverablesFor(assets),
    externalDelivery: null,
    license: licenseFor(record),
    rights: rightsFor(record),
  })

  if (!readiness.ready) {
    return { kind: "blocked", reason: readiness.blockedReason ?? "Some steps are not done." }
  }

  return { kind: "ready", href: routes.product(workspaceSlug, record.product.slug) }
}
