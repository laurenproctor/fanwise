import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/supabase/database.types"
import { createAdminClient } from "@/lib/supabase/admin"
import { classifyHandle } from "./handles"
import type { AutosaveResult } from "./draft-autosave"
import { sameArrangement } from "./product-arrangement"
import {
  draftFromRow,
  draftProductsSchema,
  seedDraftFromProfile,
  type DraftProduct,
  type ProfileDraft,
  type ProfileDraftFields,
} from "./profile-draft"

/**
 * Reading and writing the builder's draft, for the server actions and the
 * availability route.
 *
 * Every function that touches the draft takes the caller's own client, the
 * one `createClient()` builds from the session cookie, so RLS is the
 * authorization: a workspace slug that belongs to somebody else resolves to no
 * workspace, and a profile id from another workspace matches no draft. There
 * is no workspace-id comparison written here, because a foreign row never
 * comes back to be compared.
 *
 * The one exception is `handleHeldElsewhere`, and it is deliberate. Whether a
 * handle is taken has to see draft profiles in other workspaces, which RLS
 * rightly hides; asked through the caller's client, a handle held by somebody's
 * unpublished profile would report as available and then fail at publication.
 * So it uses the service role, after the caller has been authorized, and it
 * returns one boolean about one exact handle — the same fact the unique index
 * already discloses to anyone who tries to save it.
 *
 * Nothing in this file writes to `public_profiles`. That is the property the
 * builder's autosave rests on, and tests/unit/profile-builder-actions.test.ts
 * asserts it against a recording client.
 */

type Client = SupabaseClient<Database>
type PublicProfileRow = Database["public"]["Tables"]["public_profiles"]["Row"]

export interface BuilderContext {
  userId: string
  workspaceId: string
  profile: PublicProfileRow
}

export async function loadBuilderContext(
  supabase: Client,
  workspaceSlug: string,
): Promise<BuilderContext | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("slug", workspaceSlug)
    .maybeSingle()
  if (!workspace) return null

  const { data: profile } = await supabase
    .from("public_profiles")
    .select("*")
    .eq("workspace_id", workspace.id)
    .maybeSingle()
  if (!profile) return null

  return { userId: user.id, workspaceId: workspace.id, profile }
}

/** The stored draft, or the live profile copied when nothing has been saved yet. */
export async function readDraft(
  supabase: Client,
  profile: PublicProfileRow,
): Promise<{ draft: ProfileDraft; stored: boolean }> {
  const { data: row } = await supabase
    .from("public_profile_drafts")
    .select("*")
    .eq("public_profile_id", profile.id)
    .maybeSingle()

  return row
    ? { draft: draftFromRow(row), stored: true }
    : { draft: seedDraftFromProfile(profile), stored: false }
}

/**
 * Makes sure a draft row exists, seeded from the live profile.
 *
 * `ignoreDuplicates` is `on conflict do nothing`, so a row another request
 * created first is left alone rather than reset to the seed.
 */
async function ensureDraftRow(supabase: Client, ctx: BuilderContext): Promise<boolean> {
  const seed = seedDraftFromProfile(ctx.profile)
  const { error } = await supabase.from("public_profile_drafts").upsert(
    {
      public_profile_id: ctx.profile.id,
      workspace_id: ctx.workspaceId,
      ...fieldColumns(seed.fields),
      avatar_path: seed.avatarPath,
      revision: 0,
      updated_by: ctx.userId,
    },
    { onConflict: "public_profile_id", ignoreDuplicates: true },
  )
  if (error) console.error("[public] draft seed failed", error)
  return !error
}

function fieldColumns(fields: ProfileDraftFields) {
  return {
    handle: fields.handle,
    display_name: fields.displayName,
    short_bio: fields.shortBio,
    website: fields.website,
    instagram: fields.instagram,
    behance: fields.behance,
  }
}

/**
 * Stores the draft's text fields, if nobody has saved a newer revision.
 *
 * The `revision` filter is the concurrency check: an update that matches no
 * row means the draft moved on since the caller read it, and that is reported
 * as a conflict rather than written over.
 */
export async function writeDraftFields(
  supabase: Client,
  ctx: BuilderContext,
  fields: ProfileDraftFields,
  baseRevision: number,
): Promise<AutosaveResult> {
  if (!(await ensureDraftRow(supabase, ctx))) return { ok: false, reason: "failed" }
  return conditionalUpdate(supabase, ctx, fieldColumns(fields), baseRevision)
}

/**
 * Stores the product arrangement: which products show, in array order.
 *
 * Three checks before anything is written, all on the server:
 *
 *   - every id is a product in the caller's workspace, read through the
 *     caller's own client so RLS answers it (the draft table's trigger holds
 *     the same rule for any write that does not come through here);
 *   - no id appears twice;
 *   - an arrangement identical to the stored one at the same revision is a
 *     no-op that returns that revision, so a repeated save — a retry, a
 *     double click, a flush after an autosave already landed — changes
 *     nothing and cannot manufacture a conflict for the next one.
 *
 * Nothing here reads or writes a listing, a public page or the live profile.
 */
export async function writeDraftProducts(
  supabase: Client,
  ctx: BuilderContext,
  products: DraftProduct[],
  baseRevision: number,
): Promise<AutosaveResult> {
  const ids = products.map((entry) => entry.productId)
  if (new Set(ids).size !== ids.length) return { ok: false, reason: "failed" }

  if (ids.length > 0) {
    const { data: owned, error } = await supabase
      .from("products")
      .select("id")
      .eq("workspace_id", ctx.workspaceId)
      .in("id", ids)
    if (error) {
      console.error("[public] draft product ownership check failed", error)
      return { ok: false, reason: "failed" }
    }
    if ((owned ?? []).length !== ids.length) return { ok: false, reason: "failed" }
  }

  const { data: current } = await supabase
    .from("public_profile_drafts")
    .select("revision, products")
    .eq("public_profile_id", ctx.profile.id)
    .maybeSingle()

  if (current && current.revision === baseRevision) {
    const stored = draftProductsSchema.safeParse(current.products)
    if (stored.success && sameArrangement(stored.data, products)) {
      return { ok: true, revision: current.revision }
    }
  }

  if (!current && !(await ensureDraftRow(supabase, ctx))) return { ok: false, reason: "failed" }
  // Plain literals rather than the interface: the generated Json type needs an
  // index signature, which an interface does not carry.
  const stored = products.map(({ productId, visible }) => ({ productId, visible }))
  return conditionalUpdate(supabase, ctx, { products: stored }, baseRevision)
}

async function conditionalUpdate(
  supabase: Client,
  ctx: BuilderContext,
  patch: Database["public"]["Tables"]["public_profile_drafts"]["Update"],
  baseRevision: number,
): Promise<AutosaveResult> {
  const { data, error } = await supabase
    .from("public_profile_drafts")
    .update({ ...patch, revision: baseRevision + 1, updated_by: ctx.userId })
    .eq("public_profile_id", ctx.profile.id)
    .eq("revision", baseRevision)
    .select("revision")

  if (error) {
    console.error("[public] draft save failed", error)
    return { ok: false, reason: "failed" }
  }
  const saved = data?.[0]
  if (!saved) return { ok: false, reason: "conflict" }
  return { ok: true, revision: saved.revision }
}

/**
 * Points the draft at a new image, or at none. Returns the path it replaced.
 *
 * Not revision-checked: the image is its own column, set by its own action,
 * and cannot conflict with the text a second tab is typing.
 */
export async function writeDraftAvatar(
  supabase: Client,
  ctx: BuilderContext,
  avatarPath: string | null,
): Promise<{ ok: true; previous: string | null } | { ok: false }> {
  if (!(await ensureDraftRow(supabase, ctx))) return { ok: false }

  const { data: before } = await supabase
    .from("public_profile_drafts")
    .select("avatar_path")
    .eq("public_profile_id", ctx.profile.id)
    .maybeSingle()

  const { error } = await supabase
    .from("public_profile_drafts")
    .update({ avatar_path: avatarPath, updated_by: ctx.userId })
    .eq("public_profile_id", ctx.profile.id)

  if (error) {
    console.error("[public] draft avatar save failed", error)
    return { ok: false }
  }
  return { ok: true, previous: before?.avatar_path ?? null }
}

export type HandleCheckStatus = "available" | "unavailable" | "invalid" | "reserved"

/**
 * The server's answer for the studio-address field. Shape and reservation are
 * re-decided here rather than trusted from the browser.
 */
export async function checkHandleForProfile(
  profile: Pick<PublicProfileRow, "id" | "handle">,
  raw: string,
): Promise<HandleCheckStatus> {
  const classified = classifyHandle(raw)
  if (classified.kind === "empty" || classified.kind === "invalid") return "invalid"
  if (classified.kind === "reserved") return "reserved"
  if (classified.value === profile.handle.toLowerCase()) return "available"
  return (await handleHeldElsewhere(profile.id, classified.value)) ? "unavailable" : "available"
}

async function handleHeldElsewhere(profileId: string, handle: string): Promise<boolean> {
  const admin = createAdminClient()
  const [live, retired] = await Promise.all([
    admin.from("public_profiles").select("id").eq("handle", handle).neq("id", profileId).limit(1),
    admin
      .from("public_handle_history")
      .select("id")
      .eq("handle", handle)
      .neq("public_profile_id", profileId)
      .limit(1),
  ])
  if (live.error || retired.error) {
    throw new Error("handle availability lookup failed")
  }
  return (live.data?.length ?? 0) > 0 || (retired.data?.length ?? 0) > 0
}
