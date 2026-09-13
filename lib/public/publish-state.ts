import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/supabase/database.types"
import { createAvatarUrl } from "./avatars"
import { checkHandleForProfile, readDraft, type BuilderContext } from "./draft-store"
import { normalizeHandleInput } from "./handles"
import { arrange, toPresentationProducts, type ArrangementRow } from "./product-arrangement"
import { loadProductCandidates } from "./product-candidates"
import type { ProfileDraft } from "./profile-draft"
import { presentationFromDraft, type ProfilePresentation } from "./profile-presentation"
import {
  evaluateReadiness,
  sameSnapshot,
  snapshotOf,
  type HandleStatus,
  type Readiness,
} from "./publish-readiness"

/**
 * Everything step 3 knows about a draft, computed once, on the server, from
 * the database rather than from anything the browser holds.
 *
 * The page renders from it and the publish action re-computes it immediately
 * before writing, so "the screen said ready" is never the reason something is
 * published: the action asks the same questions again against the draft row it
 * is about to lock.
 */

export interface PublishState {
  draft: ProfileDraft
  stored: boolean
  rows: ArrangementRow[]
  readiness: Readiness
  /** The final preview: the draft, shown exactly as publishing would show it. */
  presentation: ProfilePresentation
  live: {
    status: "draft" | "published"
    handle: string
    lastPublishedAt: string | null
    /** False only when the profile is live and live is exactly this draft. */
    hasUnpublishedChanges: boolean
  }
}

export async function loadPublishState(
  supabase: SupabaseClient<Database>,
  ctx: BuilderContext,
  workspaceSlug: string,
): Promise<PublishState> {
  const { draft, stored } = await readDraft(supabase, ctx.profile)

  const [candidates, avatarUrl, handleStatus, latest] = await Promise.all([
    loadProductCandidates(supabase, ctx, workspaceSlug),
    draft.avatarPath ? createAvatarUrl(draft.avatarPath) : Promise.resolve(null),
    checkHandleForProfile(ctx.profile, draft.fields.handle).then(
      (status): HandleStatus => status,
      (): HandleStatus => "unknown",
    ),
    supabase
      .from("public_profile_publications")
      .select("snapshot, published_at")
      .eq("public_profile_id", ctx.profile.id)
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const rows = arrange(draft.products, candidates)
  const readiness = evaluateReadiness({
    fields: draft.fields,
    avatar: { path: draft.avatarPath, resolvable: avatarUrl !== null },
    handleStatus,
    draftProducts: draft.products,
    rows,
  })

  const published = ctx.profile.status === "published"
  const liveMatches =
    published &&
    readiness.ready &&
    latest.data !== null &&
    sameSnapshot(latest.data.snapshot, snapshotOf(readiness.plan, draft.avatarPath))

  return {
    draft,
    stored,
    rows,
    readiness,
    presentation: presentationFromDraft(draft.fields, {
      handle: normalizeHandleInput(draft.fields.handle),
      avatarUrl,
      products: toPresentationProducts(rows),
    }),
    live: {
      status: ctx.profile.status,
      handle: ctx.profile.handle,
      lastPublishedAt: latest.data?.published_at ?? null,
      hasUnpublishedChanges: !liveMatches,
    },
  }
}
