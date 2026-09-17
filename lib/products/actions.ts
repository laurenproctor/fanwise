"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import {
  RESERVED_PRODUCT_SLUGS,
  avoidReserved,
  ensureMinimumLength,
  randomSuffix,
  slugify,
  withSuffix,
} from "@/lib/slug"
import { routes } from "@/lib/routes"
import { jobs } from "@/lib/jobs"
import { deleteAssetCascade } from "./assets"
import { altTextSchema, readAltText } from "./image-metadata"
import { toJson } from "@/lib/imports/json"
import { createUploadUrl, buildStoragePath, removeObjects } from "./storage"
import { sanitizeFilename } from "./storage"
import { createProductSchema, updateProductSchema, uploadIntentSchema } from "./schemas"
import { emptyMetadataFor } from "./metadata"
import { planImageOrder } from "./image-order"
import { deleteProductDraft } from "./delete-draft"
import {
  DRAFT_DELETION_MESSAGES,
  deleteConfirmationSchema,
  draftDeletionErrorMessage,
} from "./draft-deletion"

export interface ActionState {
  error: string | null
}

/**
 * Save state for the product form. `savedAt` exists so the UI can confirm a
 * save actually happened: a form that silently accepts changes leaves the
 * creator unsure whether their edit landed.
 */
export interface SaveState {
  error: string | null
  savedAt: number | null
}

const MAX_SLUG_ATTEMPTS = 5
const UNIQUE_VIOLATION = "23505"

/**
 * Every action here re-establishes who the caller is and which workspace they
 * are acting in. "The page rendered the button" is not authorization
 * (docs/security.md rule 7).
 */
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

export async function createProductAction(
  workspaceSlug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = createProductSchema.safeParse({
    name: formData.get("name"),
    productType: formData.get("productType"),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the product details." }
  }

  const { supabase, workspace } = await requireWorkspace(workspaceSlug)
  // A product slug shares its segment with the workspace's own pages, so the
  // same rule applies one level down.
  const base = avoidReserved(
    ensureMinimumLength(slugify(parsed.data.name), randomSuffix()),
    RESERVED_PRODUCT_SLUGS,
    randomSuffix(),
  )
  let slug = base

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
    const { data, error } = await supabase
      .from("products")
      .insert({
        workspace_id: workspace.id,
        name: parsed.data.name,
        slug,
        product_type: parsed.data.productType,
        metadata: emptyMetadataFor(parsed.data.productType),
      })
      .select("slug")
      .single()

    if (!error && data) {
      revalidatePath(routes.workspace(workspaceSlug))
      redirect(routes.product(workspaceSlug, data.slug))
    }

    if (error?.code !== UNIQUE_VIOLATION) {
      console.error("[products] create failed", error)
      return { error: "That product could not be created. Try again." }
    }

    slug = withSuffix(base, randomSuffix())
  }

  return { error: "That name is taken in this workspace. Try a different one." }
}

export async function updateProductAction(
  workspaceSlug: string,
  productId: string,
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  const parsed = updateProductSchema.safeParse({
    name: formData.get("name"),
    productType: formData.get("productType"),
    canonicalTitle: formData.get("canonicalTitle"),
    canonicalDescription: formData.get("canonicalDescription"),
    shortDescription: formData.get("shortDescription"),
    brandName: formData.get("brandName"),
    basePrice: formData.get("basePrice"),
    currency: formData.get("currency"),
    version: formData.get("version"),
    supportUrl: formData.get("supportUrl"),
    documentationUrl: formData.get("documentationUrl"),
    licenseSummary: formData.get("licenseSummary"),
  })
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Check the product details.",
      savedAt: null,
    }
  }

  const { supabase, workspace } = await requireWorkspace(workspaceSlug)
  const { error } = await supabase
    .from("products")
    .update({
      name: parsed.data.name,
      product_type: parsed.data.productType,
      canonical_title: parsed.data.canonicalTitle ?? null,
      canonical_description: parsed.data.canonicalDescription ?? null,
      short_description: parsed.data.shortDescription ?? null,
      brand_name: parsed.data.brandName ?? null,
      base_price: parsed.data.basePrice ?? null,
      currency: parsed.data.currency,
      version: parsed.data.version ?? null,
      support_url: parsed.data.supportUrl ?? null,
      documentation_url: parsed.data.documentationUrl ?? null,
      license_summary: parsed.data.licenseSummary ?? null,
    })
    .eq("id", productId)
    .eq("workspace_id", workspace.id)

  if (error) {
    console.error("[products] update failed", error)
    return { error: "Those changes could not be saved. Try again.", savedAt: null }
  }

  revalidatePath(routes.workspace(workspaceSlug), "layout")
  return { error: null, savedAt: Date.now() }
}

export interface UploadIntent {
  assetId: string
  signedUrl: string
  token: string
  path: string
}

/**
 * Mints a signed upload URL.
 *
 * This function is the authorization boundary for uploads. A signed upload URL
 * is a bearer capability that bypasses storage RLS, so the path is built here
 * from ids already checked against the caller's membership. The client never
 * supplies a path and cannot point the capability at another workspace.
 */
export async function createUploadIntent(
  workspaceSlug: string,
  input: unknown,
): Promise<{ intent: UploadIntent } | { error: string }> {
  const parsed = uploadIntentSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "That file cannot be uploaded." }
  }

  const { supabase, workspace } = await requireWorkspace(workspaceSlug)

  // Confirm the product is in this workspace before minting anything. RLS
  // already scopes this read, and the explicit workspace filter makes the
  // intent obvious to the next reader.
  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id")
    .eq("id", parsed.data.productId)
    .eq("workspace_id", workspace.id)
    .maybeSingle()

  if (productError) throw productError
  if (!product) return { error: "That product could not be found." }

  const assetId = crypto.randomUUID()
  const filename = sanitizeFilename(parsed.data.filename)
  const storagePath = buildStoragePath({
    workspaceId: workspace.id,
    productId: product.id,
    assetId,
    filename,
  })

  const { error: insertError } = await supabase.from("product_assets").insert({
    id: assetId,
    workspace_id: workspace.id,
    product_id: product.id,
    asset_type: parsed.data.assetType,
    asset_state: "pending",
    storage_path: storagePath,
    filename,
  })

  if (insertError) {
    console.error("[assets] could not record the upload", insertError)
    return { error: "That upload could not be started. Try again." }
  }

  try {
    const upload = await createUploadUrl(storagePath)
    return { intent: { assetId, ...upload } }
  } catch (cause) {
    console.error("[assets] could not mint an upload URL", cause)
    return { error: "That upload could not be started. Try again." }
  }
}

/** Called once the browser has finished pushing bytes to storage. */
export async function finalizeUploadAction(
  workspaceSlug: string,
  assetId: string,
): Promise<ActionState> {
  const { workspace } = await requireWorkspace(workspaceSlug)

  await jobs.enqueue("finalize_asset", { workspaceId: workspace.id, assetId })

  revalidatePath(routes.workspace(workspaceSlug))
  return { error: null }
}

/**
 * Writes the order of a product's images, and with it which one is the cover.
 *
 * Position is the model. The first image in the list is the cover and the rest
 * are previews, so there is no separate cover picker to disagree with the
 * order. That is why this writes `asset_type` as well as `sort_order`, and why
 * the ordering migration had to narrow A2's immutability trigger to permit the
 * cover_image <-> preview_image transition.
 *
 * The writes go: every asset down to preview with its new position, then the
 * first one up to cover. Demoting before promoting means a concurrent reader
 * can see zero covers but never two. Zero is harmless, because the channel
 * comparator falls back to sort_order and that is already correct by then; two
 * would make the storefront's lead image a coin toss.
 *
 * Not a transaction, which is a real limitation rather than an oversight: the
 * client has no transaction API, and an interrupted run leaves an order that is
 * partly written. It is recoverable by dragging again, nothing external has
 * been told anything, and the alternative is an RPC this step does not need.
 */
export async function reorderProductImagesAction(
  workspaceSlug: string,
  productId: string,
  assetIds: string[],
): Promise<ActionState> {
  const { supabase, workspace } = await requireWorkspace(workspaceSlug)

  if (assetIds.length === 0) return { error: null }

  // Read through RLS before deciding anything. Scoping the select to this
  // workspace and product is the authorization step: an id belonging to someone
  // else simply does not come back, and the planner then refuses the whole
  // order rather than applying the part that happened to resolve.
  const { data: assets, error: readError } = await supabase
    .from("product_assets")
    .select("id, asset_type")
    .eq("product_id", productId)
    .eq("workspace_id", workspace.id)
    .in("id", assetIds)

  if (readError) {
    console.error("[assets] could not read images for reorder", readError)
    return { error: "Those images could not be reordered. Try again." }
  }

  const plan = planImageOrder(assetIds, assets ?? [])
  if (!plan.ok) {
    return {
      error:
        plan.reason === "not_reorderable"
          ? "Only cover and preview images can be reordered."
          : "Those images have changed. Reload the page and try again.",
    }
  }

  // Demote everything to preview with its new position, then promote the first.
  // Demoting before promoting means a concurrent reader can see zero covers but
  // never two: zero is harmless, because the channel comparator falls back to
  // sort_order and that is already correct by this point, while two would make
  // a storefront's lead image a coin toss.
  //
  // Not a transaction, which is a real limitation rather than an oversight. The
  // client has no transaction API, and an interrupted run leaves an order that
  // is partly written: recoverable by dragging again, with nothing external
  // told anything in the meantime.
  for (const write of plan.writes) {
    const { error } = await supabase
      .from("product_assets")
      .update({ sort_order: write.sortOrder, asset_type: "preview_image" })
      .eq("id", write.id)
      .eq("workspace_id", workspace.id)

    if (error) {
      console.error("[assets] could not write image order", error)
      return { error: "Those images could not be reordered. Try again." }
    }
  }

  const cover = plan.writes.find((write) => write.assetType === "cover_image")
  if (cover) {
    const { error: coverError } = await supabase
      .from("product_assets")
      .update({ asset_type: "cover_image" })
      .eq("id", cover.id)
      .eq("workspace_id", workspace.id)

    if (coverError) {
      console.error("[assets] could not set the cover image", coverError)
      return { error: "That order was saved, but the cover image could not be set. Try again." }
    }
  }

  revalidatePath(routes.workspace(workspaceSlug), "layout")
  return { error: null }
}

/**
 * Delete draft, from the product page.
 *
 * The typed confirmation is checked here, again, because the dialog's disabled
 * button is a convenience and a form can be posted without it. Everything else
 * — who is asking, whether the product may go, the storage cleanup — is
 * `deleteProductDraft`, shared with the import screen's discard.
 *
 * Redirects to the catalog only once the database has confirmed the product is
 * gone. Every other outcome stays on the page with a sentence.
 */
export async function deleteProductDraftAction(
  workspaceSlug: string,
  productId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!deleteConfirmationSchema.safeParse(formData.get("confirmation")).success) {
    return { error: DRAFT_DELETION_MESSAGES.confirmation }
  }

  const outcome = await deleteProductDraft({ workspaceSlug, productId })
  if (outcome.kind !== "deleted") {
    return { error: draftDeletionErrorMessage(outcome, "product") }
  }

  redirect(routes.workspace(outcome.workspaceSlug))
}

/**
 * The files a buyer receives. A product's last ready one of these cannot be
 * deleted until its replacement is ready; see `deleteAssetAction`. The same
 * three types the database function checks, and the import screen's
 * buyer-files step lists.
 */
const BUYER_FILE_TYPES: ReadonlySet<string> = new Set(["deliverable", "archive", "source_file"])

/**
 * Deletes a product asset.
 *
 * A buyer file goes through `remove_import_deliverable`, the same locked
 * transaction the import screen uses: it refuses to remove the product's last
 * ready buyer file, and two deletions at once cannot both pass that check. The
 * function is named for the screen that needed it first, but it takes any
 * product and file. Its rows are removed first and their stored objects after
 * the commit, which is the harmless order when the second step fails.
 *
 * Everything else — images, documentation, a licence — is not a buyer file and
 * deletes as it always has, object first and row second.
 */
export async function deleteAssetAction(
  workspaceSlug: string,
  assetId: string,
): Promise<ActionState> {
  const { supabase, workspace } = await requireWorkspace(workspaceSlug)

  // Read through RLS first: this proves the caller may see the asset before the
  // service-role delete runs with RLS bypassed.
  const { data: asset } = await supabase
    .from("product_assets")
    .select("id, product_id, asset_type")
    .eq("id", assetId)
    .maybeSingle()

  if (!asset) return { error: "That file could not be found." }

  if (BUYER_FILE_TYPES.has(asset.asset_type)) {
    const { data: storagePaths, error } = await supabase.rpc("remove_import_deliverable", {
      p_product_id: asset.product_id,
      p_asset_id: assetId,
    })

    if (error) {
      if (error.message === "only_ready_deliverable") {
        return {
          error: "That is the only file buyers would receive. Upload its replacement first.",
        }
      }
      if (error.message === "deliverable_not_found") {
        return { error: "That file could not be found." }
      }
      console.error("[assets] could not delete a buyer file", { assetId, error })
      return { error: "That file could not be deleted. Try again." }
    }

    // The rows are committed; what remains is bytes nothing points at.
    await removeObjects(storagePaths ?? []).catch((cause: unknown) => {
      console.error("[assets] deleted a buyer file but not its stored object", {
        assetId,
        error: cause,
      })
    })

    revalidatePath(routes.workspace(workspaceSlug))
    return { error: null }
  }

  try {
    await deleteAssetCascade(workspace.id, assetId)
  } catch (cause) {
    console.error("[assets] delete failed", cause)
    return { error: "That file could not be deleted. Try again." }
  }

  revalidatePath(routes.workspace(workspaceSlug))
  return { error: null }
}

/**
 * Alt text for a product image, kept on the asset beside its dimensions.
 *
 * `metadata` is outside the columns the immutability trigger protects, so a
 * ready image can be described without being replaced. Only cover and preview
 * images are accepted: the deliverable is not a picture and has nothing to
 * describe. Whatever the creator types is theirs, and is labelled so; a
 * suggestion the model wrote earlier is overwritten, not kept beside it.
 */
export async function setImageAltTextAction(
  workspaceSlug: string,
  assetId: string,
  altText: string,
): Promise<{ error: string | null }> {
  const parsed = altTextSchema.safeParse(altText)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the alt text." }

  const { supabase, workspace } = await requireWorkspace(workspaceSlug)

  const { data: asset } = await supabase
    .from("product_assets")
    .select("id, asset_type, metadata")
    .eq("id", assetId)
    .eq("workspace_id", workspace.id)
    .maybeSingle()

  if (!asset || (asset.asset_type !== "cover_image" && asset.asset_type !== "preview_image")) {
    return { error: "That image could not be found." }
  }

  const rest = { ...((asset.metadata as Record<string, unknown>) ?? {}) }
  delete rest.altTextSource
  const { error } = await supabase
    .from("product_assets")
    .update({
      metadata: toJson(
        parsed.data.length > 0
          ? { ...rest, altText: parsed.data, altTextSource: "creator" }
          : { ...rest, altText: "" },
      ),
    })
    .eq("id", assetId)
    .eq("workspace_id", workspace.id)

  if (error) {
    console.error("[products] could not save alt text", { assetId, code: error.code })
    return { error: "That alt text could not be saved. Try again." }
  }
  return { error: null }
}

/**
 * Asks for alt text to be written from the image (ADR 0014).
 *
 * Queues the job and returns; the description lands on the asset a few
 * seconds later and the editor refreshes into it. Refused when the image
 * already has alt text, because the job would decline anyway and the creator
 * should clear the field first if they want another.
 */
export async function suggestImageAltTextAction(
  workspaceSlug: string,
  assetId: string,
): Promise<{ error: string | null }> {
  const { supabase, workspace } = await requireWorkspace(workspaceSlug)

  const { data: asset } = await supabase
    .from("product_assets")
    .select("id, asset_type, asset_state, derived_from, metadata")
    .eq("id", assetId)
    .eq("workspace_id", workspace.id)
    .maybeSingle()

  if (
    !asset ||
    asset.derived_from !== null ||
    (asset.asset_type !== "cover_image" && asset.asset_type !== "preview_image")
  ) {
    return { error: "That image could not be found." }
  }
  if (asset.asset_state !== "ready") return { error: "Wait for the upload to finish first." }
  if (readAltText(asset.metadata).trim().length > 0) {
    return { error: "Clear the alt text first to ask for another." }
  }

  await jobs.enqueue("describe_image", { workspaceId: workspace.id, assetId })
  return { error: null }
}
