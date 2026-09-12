"use server"

import { randomUUID } from "node:crypto"
import { redirect } from "next/navigation"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { routes } from "@/lib/routes"
import {
  MAX_AVATAR_BYTES,
  buildAvatarPath,
  checkAvatar,
  removeAvatars,
  uploadAvatar,
} from "./avatars"
import type { AutosaveResult } from "./draft-autosave"
import {
  checkHandleForProfile,
  loadBuilderContext,
  writeDraftAvatar,
  writeDraftFields,
  writeDraftProducts,
} from "./draft-store"
import {
  checkDetailsStep,
  draftFieldsSchema,
  draftProductsSchema,
  type DetailsErrors,
} from "./profile-draft"

/**
 * The profile builder's writes. Every one of them lands in
 * `public_profile_drafts` or the private avatar bucket, and none of them
 * publishes: there is no status change, no `release_public_handle`, and no
 * write to `public_profiles` anywhere in this file. Publication is step 3's
 * own action.
 *
 * Authorization is `loadBuilderContext`, which resolves the workspace and the
 * profile through RLS as the signed-in user. A slug the caller cannot see is a
 * slug with no profile, indistinguishable from one that does not exist.
 */

const saveInput = z.object({
  fields: draftFieldsSchema,
  revision: z.number().int().min(0),
})

export async function saveProfileDraftAction(
  workspaceSlug: string,
  input: unknown,
): Promise<AutosaveResult> {
  const parsed = saveInput.safeParse(input)
  if (!parsed.success) return { ok: false, reason: "failed" }

  const supabase = await createClient()
  const ctx = await loadBuilderContext(supabase, workspaceSlug)
  if (!ctx) return { ok: false, reason: "failed" }

  return writeDraftFields(supabase, ctx, parsed.data.fields, parsed.data.revision)
}

const productsInput = z.object({
  products: draftProductsSchema,
  revision: z.number().int().min(0),
})

/**
 * Step 2's autosave: which products show on the profile, in order.
 *
 * The workspace is the one RLS resolves from the slug for the signed-in user;
 * nothing the browser sends names a workspace. Every product id is checked
 * against that workspace before the write, and an unchanged arrangement is a
 * no-op. The listings behind these products are not read or touched: hiding a
 * product here removes it from the profile and nowhere else.
 */
export async function saveProfileProductsAction(
  workspaceSlug: string,
  input: unknown,
): Promise<AutosaveResult> {
  const parsed = productsInput.safeParse(input)
  if (!parsed.success) return { ok: false, reason: "failed" }

  const supabase = await createClient()
  const ctx = await loadBuilderContext(supabase, workspaceSlug)
  if (!ctx) return { ok: false, reason: "failed" }

  return writeDraftProducts(supabase, ctx, parsed.data.products, parsed.data.revision)
}

export type AvatarUploadResult = { ok: true } | { ok: false; message: string }

/**
 * Uploads a new draft image, or removes it with `remove=true`.
 *
 * Separate from the text autosave on purpose: the bytes are posted once, when
 * a picture is chosen, and never again because a name was edited. The file is
 * sniffed here whatever the browser said it was.
 *
 * The image it replaces is deleted only when it is not also the live profile's
 * image. A draft is seeded with the live avatar's path, so the first change of
 * picture in the builder would otherwise delete the picture the public page is
 * still showing.
 */
export async function uploadProfileDraftAvatarAction(
  workspaceSlug: string,
  formData: FormData,
): Promise<AvatarUploadResult> {
  const supabase = await createClient()
  const ctx = await loadBuilderContext(supabase, workspaceSlug)
  if (!ctx) return { ok: false, message: "That image could not be saved. Try again." }

  let nextPath: string | null = null

  if (formData.get("remove") !== "true") {
    const file = formData.get("image")
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, message: "Choose an image." }
    }
    if (file.size > MAX_AVATAR_BYTES) {
      return { ok: false, message: "That image is over 5 MB. Choose a smaller one." }
    }
    const checked = checkAvatar(Buffer.from(await file.arrayBuffer()), file.size)
    if (!checked.ok) return { ok: false, message: checked.message }

    nextPath = buildAvatarPath(ctx.profile.id, `draft-${randomUUID()}`, checked.mimeType)
    try {
      await uploadAvatar(nextPath, checked.bytes, checked.mimeType)
    } catch (error) {
      console.error("[public] draft avatar upload failed", error)
      return { ok: false, message: "That image could not be uploaded. Try again." }
    }
  }

  const written = await writeDraftAvatar(supabase, ctx, nextPath)
  if (!written.ok) {
    if (nextPath) await removeAvatars([nextPath]).catch(() => {})
    return { ok: false, message: "That image could not be saved. Try again." }
  }

  const previous = written.previous
  if (previous && previous !== nextPath && previous !== ctx.profile.avatar_path) {
    await removeAvatars([previous]).catch(() => {})
  }

  return { ok: true }
}

export type ContinueResult =
  | { ok: true; revision: number; next: string }
  | { ok: false; revision: number; errors: DetailsErrors; message: string | null }

/**
 * Step 1's Continue: store the latest fields, then decide whether the step is
 * complete, including whether the address is still free.
 *
 * Saving before judging means a creator whose step is incomplete loses
 * nothing — their fields are stored whatever the verdict — and it means the
 * address is checked against what is actually in the draft, not against a
 * value the browser claims to be about to save.
 */
export async function continueProfileDetailsAction(
  workspaceSlug: string,
  input: unknown,
): Promise<ContinueResult> {
  const parsed = saveInput.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      revision: 0,
      errors: {},
      message: "Your changes could not be saved. Try again.",
    }
  }

  const supabase = await createClient()
  const ctx = await loadBuilderContext(supabase, workspaceSlug)
  if (!ctx) redirect(routes.publicProfileSettings(workspaceSlug))

  const saved = await writeDraftFields(supabase, ctx, parsed.data.fields, parsed.data.revision)
  if (!saved.ok) {
    return {
      ok: false,
      revision: parsed.data.revision,
      errors: {},
      message:
        saved.reason === "conflict"
          ? "This draft was changed in another tab. Reload to see the latest version."
          : "Your changes could not be saved. Try again.",
    }
  }

  const errors = checkDetailsStep(parsed.data.fields)
  if (!errors.handle) {
    try {
      const status = await checkHandleForProfile(ctx.profile, parsed.data.fields.handle)
      if (status === "unavailable") errors.handle = "That address is taken. Choose another."
      if (status === "reserved") errors.handle = "That address is reserved. Choose another."
    } catch {
      return {
        ok: false,
        revision: saved.revision,
        errors: {},
        message: "We couldn't check your address. Try again.",
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, revision: saved.revision, errors, message: null }
  }

  return {
    ok: true,
    revision: saved.revision,
    next: routes.publicProfileBuilderProducts(workspaceSlug),
  }
}
