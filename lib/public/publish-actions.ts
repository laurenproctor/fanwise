"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { publicInternal, publicRoutes, routes } from "@/lib/routes"
import { removeAvatars } from "./avatars"
import { loadBuilderContext, readDraft, writeDraftProducts } from "./draft-store"
import {
  PROFILE_CHOICE_TEXT,
  planProfileChoice,
  withProductShown,
  type ProfileChoiceOutcome,
} from "./profile-choice"
import { loadProductCandidates } from "./product-candidates"
import { confirmedAndEligible, planPublishAll } from "./publish-all"
import type { ReadinessIssue } from "./publish-readiness"
import { loadPublishState } from "./publish-state"
import { loadLiveProductIds } from "./workspace-queries"

/**
 * Publishing a profile, and taking it down.
 *
 * Kept apart from `./draft-actions`, which never publishes and is tested to
 * say so. This is the only file anything reaches publication through: the
 * builder's Publish, Unpublish, and the profile page's "Publish all products
 * on my profile".
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

export type PublishAllResult =
  | {
      ok: true
      outcome: "published" | "unchanged"
      publishedCount: number
      noLongerEligible: number
    }
  | { ok: false; kind: "not_live" | "nothing_to_publish" | "failed"; message: string }

const publishAllInput = z.object({
  productIds: z.array(z.uuid()).min(1).max(500),
})

const publishAllOutcome = z.object({
  outcome: z.enum(["published", "unchanged"]),
  published_count: z.number().int().min(0),
})

const PUBLISH_ALL_FAILED = "Your products could not be published. Nothing changed; try again."

/**
 * Publishes every product the creator confirmed onto their live public
 * profile, in one transaction, and nothing else.
 *
 * Public Fanwise visibility only. This reads listings to decide eligibility,
 * exactly as step 2 of the builder does, and writes none: no channel is
 * contacted, no listing changes status, no publication run is started.
 *
 * Nothing the browser sends is trusted beyond "these are the products I
 * confirmed". The workspace is the one RLS resolves for the signed-in member,
 * eligibility is recomputed here from that member's own reads, and only the
 * overlap is sent. `publish_all_profile_products()` then re-checks membership,
 * workspace ownership and archival itself, and holds the profile row lock, so
 * a second press waits for the first and finds nothing left to do.
 */
export async function publishAllProductsAction(
  workspaceSlug: string,
  input: unknown,
): Promise<PublishAllResult> {
  const parsed = publishAllInput.safeParse(input)
  if (!parsed.success) return { ok: false, kind: "failed", message: PUBLISH_ALL_FAILED }

  const supabase = await createClient()
  const ctx = await loadBuilderContext(supabase, workspaceSlug)
  if (!ctx) return { ok: false, kind: "failed", message: PUBLISH_ALL_FAILED }

  if (ctx.profile.status !== "published") {
    return {
      ok: false,
      kind: "not_live",
      message: "Publish your profile first. Products appear on it once it is live.",
    }
  }

  let plan
  try {
    const [candidates, live] = await Promise.all([
      loadProductCandidates(supabase, ctx, workspaceSlug),
      loadLiveProductIds(supabase, ctx.profile.id),
    ])
    plan = planPublishAll(candidates, live)
  } catch (error) {
    console.error("[public] publish all: eligibility read failed", error)
    return { ok: false, kind: "failed", message: PUBLISH_ALL_FAILED }
  }

  const { ids, noLongerEligible } = confirmedAndEligible(parsed.data.productIds, plan)
  if (ids.length === 0) {
    return {
      ok: false,
      kind: "nothing_to_publish",
      message:
        "None of those products can be published now. They may already be on your profile, or no longer be live in a shop.",
    }
  }

  const { data, error } = await supabase.rpc("publish_all_profile_products", {
    p_public_profile_id: ctx.profile.id,
    p_product_ids: ids,
  })

  if (error) {
    console.error("[public] publish all failed", error)
    if (error.code === "PT412") {
      return {
        ok: false,
        kind: "not_live",
        message: "Publish your profile first. Products appear on it once it is live.",
      }
    }
    return { ok: false, kind: "failed", message: PUBLISH_ALL_FAILED }
  }

  const result = publishAllOutcome.safeParse(data)
  if (!result.success) {
    console.error("[public] publish all returned an unexpected shape", result.error)
    return { ok: false, kind: "failed", message: PUBLISH_ALL_FAILED }
  }

  if (result.data.outcome === "published") {
    revalidateProfile(workspaceSlug, ctx.profile.handle, ctx.profile.handle)
  }

  return {
    ok: true,
    outcome: result.data.outcome,
    publishedCount: result.data.published_count,
    noLongerEligible,
  }
}

export type ProfileChoiceResult =
  { ok: true; outcome: ProfileChoiceOutcome; message: string } | { ok: false; message: string }

const profileChoiceInput = z.object({ onProfile: z.boolean() })

const CHOICE_FAILED = "That could not be saved. Nothing changed; try again."

/**
 * The checkbox on a product's public page: on or off the creator's profile.
 *
 * Writes the profile builder's own draft, so the builder shows the same
 * arrangement afterwards, and when the profile is live and the product is
 * eligible, publishes that one page through the same function "Publish all
 * products" uses, which appends it to the live order and switches it on in
 * the draft in one transaction. Turning a product off returns its page to
 * draft and switches its draft entry off in place. See lib/public/profile-choice.ts.
 */
export async function setProductOnProfileAction(
  workspaceSlug: string,
  productSlug: string,
  input: unknown,
): Promise<ProfileChoiceResult> {
  const parsed = profileChoiceInput.safeParse(input)
  if (!parsed.success) return { ok: false, message: CHOICE_FAILED }
  const { onProfile } = parsed.data

  const supabase = await createClient()
  const ctx = await loadBuilderContext(supabase, workspaceSlug)
  if (!ctx) return { ok: false, message: CHOICE_FAILED }

  const { data: product } = await supabase
    .from("products")
    .select("id")
    .eq("workspace_id", ctx.workspaceId)
    .eq("slug", productSlug)
    .maybeSingle()
  if (!product) return { ok: false, message: "That product could not be found." }

  let live: boolean
  let eligible: boolean
  let draft
  try {
    const [candidates, liveIds, read] = await Promise.all([
      loadProductCandidates(supabase, ctx, workspaceSlug),
      loadLiveProductIds(supabase, ctx.profile.id),
      readDraft(supabase, ctx.profile),
    ])
    live = liveIds.has(product.id)
    eligible = candidates.find((c) => c.id === product.id)?.eligibility.eligible ?? false
    draft = read.draft
  } catch (error) {
    console.error("[public] profile choice: read failed", error)
    return { ok: false, message: CHOICE_FAILED }
  }

  const plan = planProfileChoice({ onProfile, profileStatus: ctx.profile.status, eligible, live })

  if (plan.publishNow) {
    // One transaction: the page goes live at the end of the order and the
    // draft, where one exists, is switched on to match.
    const { error } = await supabase.rpc("publish_all_profile_products", {
      p_public_profile_id: ctx.profile.id,
      p_product_ids: [product.id],
    })
    if (error) {
      console.error("[public] profile choice: publish failed", error)
      return { ok: false, message: CHOICE_FAILED }
    }
  } else {
    const saved = await writeDraftProducts(
      supabase,
      ctx,
      withProductShown(draft.products, product.id, onProfile),
      draft.revision,
    )
    if (!saved.ok) {
      return {
        ok: false,
        message:
          saved.reason === "conflict"
            ? "Your profile builder changed in another tab. Reload this page and try again."
            : CHOICE_FAILED,
      }
    }
  }

  if (plan.unpublishPage) {
    const { error } = await supabase
      .from("public_product_pages")
      .update({ status: "draft", published_at: null })
      .eq("public_profile_id", ctx.profile.id)
      .eq("product_id", product.id)
      .eq("workspace_id", ctx.workspaceId)
    if (error) {
      console.error("[public] profile choice: unpublish failed", error)
      return { ok: false, message: CHOICE_FAILED }
    }
  }

  if (plan.publishNow || plan.unpublishPage) {
    revalidateProfile(workspaceSlug, ctx.profile.handle, ctx.profile.handle)
  }
  revalidatePath(routes.product(workspaceSlug, productSlug))
  return { ok: true, outcome: plan.outcome, message: PROFILE_CHOICE_TEXT[plan.outcome] }
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
  // `layout` on the profile section covers its overview and all three builder
  // steps, so a publish from any of them is reflected on the others at once.
  revalidatePath(routes.profile(workspaceSlug), "layout")
  for (const handle of new Set([previous.toLowerCase(), next.toLowerCase()])) {
    revalidatePath(publicInternal(handle), "layout")
  }
}
