"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { routes } from "@/lib/routes"
import { toJson } from "@/lib/imports/json"
import { jobs } from "@/lib/jobs"
import { isUnreadFont } from "./read-upload"
import type { Product } from "@/lib/products/types"
import { mergeFontMetadata, patchColumns, productPatchSchema, type PatchField } from "./save"

/**
 * The font workspace's writes.
 *
 * Every one re-establishes the caller and the workspace, and reads the row
 * through RLS before writing it (docs/security.md rule 7). None of them runs a
 * long external call: saving is a row update. Publishing is not here at all:
 * the shared publish actions apply a font's blockers themselves
 * (lib/products/publish-gate.ts), whichever button is pressed.
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

export type FontSaveResult =
  | { ok: true; savedAt: number; slug: string }
  | {
      ok: false
      error: string
      field: PatchField | null
      /** True when trying the same save again could succeed. */
      retryable: boolean
    }

const UNIQUE_VIOLATION = "23505"
const CHECK_VIOLATION = "23514"

/**
 * One autosave.
 *
 * Refused for anything that is not a font product, so this action cannot be
 * pointed at a template and write font metadata onto it.
 */
export async function saveFontProductAction(
  workspaceSlug: string,
  productId: string,
  patch: unknown,
): Promise<FontSaveResult> {
  const parsed = productPatchSchema.safeParse(patch)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const key = issue?.path[0]
    return {
      ok: false,
      error: issue?.message ?? "Check that detail and try again.",
      field: typeof key === "string" && key !== "font" ? (key as PatchField) : null,
      retryable: false,
    }
  }

  const { supabase, workspace } = await requireWorkspace(workspaceSlug)

  const { data: product, error: readError } = await supabase
    .from("products")
    .select("id, slug, product_type, metadata")
    .eq("id", productId)
    .eq("workspace_id", workspace.id)
    .maybeSingle()

  if (readError) {
    console.error("[fonts] could not read the product to save", { productId, readError })
    return { ok: false, error: "Couldn't save. Trying again…", field: null, retryable: true }
  }
  if (!product) {
    return { ok: false, error: "That product could not be found.", field: null, retryable: false }
  }
  if (product.product_type !== "font") {
    return { ok: false, error: "This is not a font product.", field: null, retryable: false }
  }

  const columns: Record<string, unknown> = patchColumns(parsed.data)
  if (parsed.data.font) {
    const merged = mergeFontMetadata(product.metadata, parsed.data.font)
    if (!merged.ok) return { ok: false, error: merged.error, field: merged.field, retryable: false }
    columns.metadata = toJson(merged.metadata)
  }

  if (Object.keys(columns).length === 0) {
    return { ok: true, savedAt: Date.now(), slug: product.slug }
  }

  const { data: saved, error } = await supabase
    .from("products")
    .update(columns as Partial<Product>)
    .eq("id", productId)
    .eq("workspace_id", workspace.id)
    .select("slug")
    .maybeSingle()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: "Another product in this workspace already uses that address.",
        field: "slug",
        retryable: false,
      }
    }
    if (error.code === CHECK_VIOLATION && error.message.includes("license")) {
      return {
        ok: false,
        error: "A chosen license needs its terms. Write a summary before clearing it.",
        field: "licenseSummary",
        retryable: false,
      }
    }
    console.error("[fonts] save failed", { productId, code: error.code, message: error.message })
    return { ok: false, error: "Couldn't save. Trying again…", field: null, retryable: true }
  }
  if (!saved) {
    return { ok: false, error: "That product could not be found.", field: null, retryable: false }
  }

  // A new address is not revalidated here. Re-rendering the page the action
  // was called from would render the old address, which no longer resolves;
  // the workspace moves the browser to the new one itself.
  if (saved.slug === product.slug) {
    revalidatePath(routes.product(workspaceSlug, saved.slug))
  }
  return { ok: true, savedAt: Date.now(), slug: saved.slug }
}

const altTextSchema = z.string().trim().max(250, "Keep alt text under 250 characters.")

/**
 * Alt text for a product image, kept on the asset beside its dimensions.
 *
 * `metadata` is outside the columns the immutability trigger protects, so a
 * ready image can be described without being replaced. Only cover and preview
 * images are accepted: the deliverable is not a picture and has nothing to
 * describe.
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

  const { error } = await supabase
    .from("product_assets")
    .update({
      metadata: toJson({
        ...((asset.metadata as Record<string, unknown>) ?? {}),
        altText: parsed.data,
      }),
    })
    .eq("id", assetId)
    .eq("workspace_id", workspace.id)

  if (error) {
    console.error("[fonts] could not save alt text", { assetId, code: error.code })
    return { error: "That alt text could not be saved. Try again." }
  }
  return { error: null }
}

/**
 * Asks for a ready font file's reading, when the job that settled it left
 * none.
 *
 * The files section calls this for every "Not read yet" row it shows, so a row
 * settled by a worker built before fonts were read is read on the next visit
 * rather than re-uploaded. The job is the same one an upload runs
 * (`finalize_asset`): on a ready row it completes the reading and nothing else.
 * A file that is already read, or is not a font, enqueues nothing.
 */
export async function readFontFileAction(
  workspaceSlug: string,
  assetId: string,
): Promise<{ error: string | null }> {
  const { supabase, workspace } = await requireWorkspace(workspaceSlug)

  const { data: asset, error } = await supabase
    .from("product_assets")
    .select("id, asset_state, mime_type, metadata")
    .eq("id", assetId)
    .eq("workspace_id", workspace.id)
    .maybeSingle()

  if (error) {
    console.error("[fonts] could not read the file to request its reading", { assetId, error })
    return { error: "That file could not be read. Try again." }
  }
  if (!asset) return { error: "That file could not be found." }
  if (asset.asset_state !== "ready" || !isUnreadFont(asset.mime_type, asset.metadata)) {
    return { error: null }
  }

  await jobs.enqueue("finalize_asset", { workspaceId: workspace.id, assetId: asset.id })
  return { error: null }
}
