"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { publicInternal, publicRoutes, routes } from "@/lib/routes"
import { removeAvatars } from "./avatars"
import { loadBuilderContext } from "./draft-store"
import type { ReadinessIssue } from "./publish-readiness"
import { loadPublishState } from "./publish-state"

/**
 * Publishing a profile, and taking it down.
 *
 * Kept apart from `./draft-actions`, which never publishes and is tested to
 * say so. This is the only file the builder reaches publication through.
 *
 * Publishing is the database function `publish_public_profile()`, one
 * transaction. Before calling it this action re-reads the draft and re-derives
 * everything the screen showed — field validity, links, the address, the
 * image, which products are still eligible — so nothing the browser sends is
 * trusted beyond "this is the draft I reviewed", expressed as the draft's
 * `updated_at`. The function then locks the draft and refuses it if that has
 * moved.
 *
 * Raw database errors are logged and never returned. What comes back is one of
 * a few outcomes the screen knows how to explain.
 */

export type PublishResult =
  | { ok: true; outcome: "published" | "unchanged"; handle: string; path: string }
  | { ok: false; kind: "not_ready"; issues: ReadinessIssue[] }
  | { ok: false; kind: "draft_changed"; message: string }
  | { ok: false; kind: "failed"; message: string }

const publishInput = z.object({ expectedDraftUpdatedAt: z.string().min(1).max(64) })

const outcomeSchema = z.object({
  outcome: z.enum(["published", "unchanged"]),
  handle: z.string(),
  previous_handle: z.string(),
  previous_avatar_path: z.string().nullable(),
})

const FAILED = "Your profile could not be published. Nothing changed; try again."

export async function publishProfileAction(
  workspaceSlug: string,
  input: unknown,
): Promise<PublishResult> {
  const parsed = publishInput.safeParse(input)
  if (!parsed.success) return { ok: false, kind: "failed", message: FAILED }

  const supabase = await createClient()
  const ctx = await loadBuilderContext(supabase, workspaceSlug)
  if (!ctx) return { ok: false, kind: "failed", message: FAILED }

  const state = await loadPublishState(supabase, ctx, workspaceSlug)
  if (!state.stored || state.draft.updatedAt === null) {
    return {
      ok: false,
      kind: "not_ready",
      issues: [{ step: 1, field: "displayName", message: "Complete your profile details first." }],
    }
  }
  if (!state.readiness.ready) {
    return { ok: false, kind: "not_ready", issues: state.readiness.issues }
  }
  if (state.draft.updatedAt !== parsed.data.expectedDraftUpdatedAt) {
    return {
      ok: false,
      kind: "draft_changed",
      message: "Your draft changed since this page opened. Review it again before publishing.",
    }
  }

  const { plan } = state.readiness
  const { data, error } = await supabase.rpc("publish_public_profile", {
    p_public_profile_id: ctx.profile.id,
    p_expected_draft_updated_at: parsed.data.expectedDraftUpdatedAt,
    p_values: { ...plan.values },
    p_product_ids: plan.productIds,
  })

  if (error) {
    console.error("[public] publish failed", error)
    if (error.code === "PT409") {
      return {
        ok: false,
        kind: "draft_changed",
        message: "Your draft changed since this page opened. Review it again before publishing.",
      }
    }
    if (error.code === "23505") {
      return {
        ok: false,
        kind: "not_ready",
        issues: [
          { step: 1, field: "handle", message: "That address was just taken. Choose another." },
        ],
      }
    }
    if (error.code === "23514") {
      return {
        ok: false,
        kind: "not_ready",
        issues: [
          {
            step: 2,
            field: "products",
            message: "Your product selection changed. Review it in Manage products.",
          },
        ],
      }
    }
    return { ok: false, kind: "failed", message: FAILED }
  }

  const result = outcomeSchema.safeParse(data)
  if (!result.success) {
    console.error("[public] publish returned an unexpected shape", result.error)
    return { ok: false, kind: "failed", message: FAILED }
  }
  const outcome = result.data

  if (outcome.outcome === "published") {
    // The replaced live image, once nothing points at it. Never a reason to
    // report failure: the publication has already happened.
    const previous = outcome.previous_avatar_path
    if (previous && previous !== state.draft.avatarPath) {
      await removeAvatars([previous]).catch(() => {})
    }
    revalidateProfile(workspaceSlug, outcome.previous_handle, outcome.handle)
  }

  return {
    ok: true,
    outcome: outcome.outcome,
    handle: outcome.handle,
    path: publicRoutes.profile(outcome.handle),
  }
}

/**
 * Takes the live profile off the public web. Every product page beneath it
 * goes with it, by the RLS gate on the parent's status; nothing is deleted and
 * the draft is untouched, so publishing again restores it.
 */
export async function unpublishProfileAction(workspaceSlug: string): Promise<void> {
  const supabase = await createClient()
  const ctx = await loadBuilderContext(supabase, workspaceSlug)
  if (!ctx) return

  const { error } = await supabase
    .from("public_profiles")
    .update({ status: "draft", published_at: null })
    .eq("id", ctx.profile.id)
  if (error) console.error("[public] unpublish failed", error)

  revalidateProfile(workspaceSlug, ctx.profile.handle, ctx.profile.handle)
}

/**
 * The internal rewrite targets, for both handles, as `layout` so the product
 * pages beneath go too; see the note on revalidatePublic in ./actions.ts.
 */
function revalidateProfile(workspaceSlug: string, previous: string, next: string): void {
  revalidatePath(routes.publicProfileSettings(workspaceSlug), "layout")
  for (const handle of new Set([previous.toLowerCase(), next.toLowerCase()])) {
    revalidatePath(publicInternal(handle), "layout")
  }
}
