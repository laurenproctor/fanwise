"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { ensureMinimumLength, randomSuffix, slugify, withSuffix } from "@/lib/slug"
import { jobs } from "@/lib/jobs"
import { deleteAssetCascade } from "./assets"
import { createUploadUrl, buildStoragePath } from "./storage"
import { sanitizeFilename } from "./storage"
import { createProductSchema, updateProductSchema, uploadIntentSchema } from "./schemas"
import { emptyMetadataFor } from "./metadata"

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
  const base = ensureMinimumLength(slugify(parsed.data.name), randomSuffix())
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
      revalidatePath(`/w/${workspaceSlug}/products`)
      redirect(`/w/${workspaceSlug}/products/${data.slug}`)
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

  revalidatePath(`/w/${workspaceSlug}/products`, "layout")
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

  revalidatePath(`/w/${workspaceSlug}/products`)
  return { error: null }
}

export async function deleteAssetAction(
  workspaceSlug: string,
  assetId: string,
): Promise<ActionState> {
  const { supabase, workspace } = await requireWorkspace(workspaceSlug)

  // Read through RLS first: this proves the caller may see the asset before the
  // service-role delete runs with RLS bypassed.
  const { data: asset } = await supabase
    .from("product_assets")
    .select("id")
    .eq("id", assetId)
    .maybeSingle()

  if (!asset) return { error: "That file could not be found." }

  try {
    await deleteAssetCascade(workspace.id, assetId)
  } catch (cause) {
    console.error("[assets] delete failed", cause)
    return { error: "That file could not be deleted. Try again." }
  }

  revalidatePath(`/w/${workspaceSlug}/products`)
  return { error: null }
}
