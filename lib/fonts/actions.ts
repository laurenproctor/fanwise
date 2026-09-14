"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { publishEverywhereAction, type PublishState } from "@/lib/publishing/actions"
import { routes } from "@/lib/routes"
import { toJson } from "@/lib/imports/json"
import type { Product } from "@/lib/products/types"
import { loadFontWorkspace } from "./queries"
import { mergeFontMetadata, patchColumns, productPatchSchema, type PatchField } from "./save"

/**
 * The font workspace's writes.
 *
 * Every one re-establishes the caller and the workspace, and reads the row
 * through RLS before writing it (docs/security.md rule 7). None of them runs a
 * long external call: saving is a row update, and publishing hands over to the
 * existing Publish Everywhere action, which enqueues its jobs.
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
 * Publish Everywhere, for a font product, behind its readiness blockers.
 *
 * The button is disabled while a blocker stands, and that is a convenience: a
 * disabled button can be pressed by anything that can post. The rules are
 * evaluated again here from the stored rows, and only when none that blocks
 * every channel is open does this hand over to the shared action, which then
 * applies each channel's own requirements as it always has.
 */
export async function publishFontEverywhereAction(
  workspaceSlug: string,
  productId: string,
): Promise<PublishState> {
  const { supabase, workspace } = await requireWorkspace(workspaceSlug)

  const { data: product } = await supabase
    .from("products")
    .select("*")
    .eq("id", productId)
    .eq("workspace_id", workspace.id)
    .maybeSingle()

  if (!product) return { error: "That product could not be found.", notice: null }

  if (product.product_type === "font") {
    const data = await loadFontWorkspace({
      workspaceId: workspace.id,
      workspaceSlug,
      product: product as Product,
    })
    const first = data.readiness.blockingAll[0]
    if (first) {
      return {
        error:
          data.readiness.blockingAll.length === 1
            ? `Publishing is blocked: ${first.label.toLowerCase()}.`
            : `Publishing is blocked by ${data.readiness.blockingAll.length} issues, starting with: ${first.label.toLowerCase()}.`,
        notice: null,
      }
    }
  }

  return publishEverywhereAction(workspaceSlug, productId)
}
