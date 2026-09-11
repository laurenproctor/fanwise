import { z } from "zod"
import type { SupabaseClient, User } from "@supabase/supabase-js"
import type { Database } from "@/lib/supabase/database.types"
import { randomSuffix, slugify, withSuffix } from "@/lib/slug"
import type { Workspace } from "./queries"

/**
 * The personal workspace a new account is given on arrival.
 *
 * Nobody is asked to name anything before they have seen the product. The
 * workspace is named for the person when an identity provider has told us their
 * name, and "My studio" otherwise, and it is renamed in Settings. The address
 * does not follow a rename.
 *
 * The guarantee that matters, one workspace however many times this runs, is
 * not made here. It is made by provision_personal_workspace() in the database,
 * which serializes on the caller and hands back the workspace they already have.
 * Everything in this file is naming, plus absorbing a slug collision.
 */

export const FALLBACK_WORKSPACE_NAME = "My studio"

/**
 * Where a name can come from. `full_name` and `name` are what Supabase's
 * identity providers write. Email and password signup writes neither, so today
 * every account starts as "My studio".
 *
 * user_metadata is writable by the account itself. That is acceptable here and
 * only here, because the value names that same account's own workspace and
 * nothing else reads it. It is still parsed rather than trusted, so an object, a
 * number or a paragraph falls back instead of reaching a column.
 */
const NAME_KEYS = ["full_name", "name"] as const

/** Letters, and the marks, apostrophes, hyphens and dots real first names carry. */
const FIRST_NAME = /^[\p{L}\p{M}][\p{L}\p{M}'’.-]*$/u

/** Keeps "<first name>’s studio" well inside the 80-character name column. */
const MAX_FIRST_NAME_LENGTH = 40

const metadataSchema = z.record(z.string(), z.unknown())

export function personalWorkspaceName(metadata: unknown): string {
  const parsed = metadataSchema.safeParse(metadata)
  if (!parsed.success) return FALLBACK_WORKSPACE_NAME

  for (const key of NAME_KEYS) {
    const value = parsed.data[key]
    if (typeof value !== "string") continue

    const first = value.trim().split(/\s+/)[0] ?? ""
    if (first.length > MAX_FIRST_NAME_LENGTH || !FIRST_NAME.test(first)) continue

    return `${first}’s studio`
  }

  return FALLBACK_WORKSPACE_NAME
}

/**
 * The slug for a provisioned workspace. Always suffixed, unlike a name a person
 * types, for two reasons.
 *
 * Every nameless account is "My studio", so an unsuffixed `my-studio` would be
 * won by the first one and collide for every account after it. And a slug that
 * came back suffixed would tell its owner the plain one belongs to somebody,
 * which is the probe app/not-found.tsx exists to defeat. A suffix on every slug
 * says nothing about any other.
 */
export function personalWorkspaceSlug(name: string, suffix: string): string {
  return withSuffix(slugify(name), suffix)
}

type ProvisionClient = Pick<SupabaseClient<Database>, "rpc">

export type ProvisionResult = { ok: true; workspace: Workspace } | { ok: false }

/** How many slug collisions to absorb before reporting a failure. */
const MAX_SLUG_ATTEMPTS = 5

// Postgres unique_violation. The slug is the only unique column a new
// workspace can collide on.
const UNIQUE_VIOLATION = "23505"

export async function provisionPersonalWorkspace(
  supabase: ProvisionClient,
  user: Pick<User, "user_metadata">,
  suffix: () => string = randomSuffix,
): Promise<ProvisionResult> {
  const name = personalWorkspaceName(user.user_metadata)

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
    const { data, error } = await supabase.rpc("provision_personal_workspace", {
      p_name: name,
      p_slug: personalWorkspaceSlug(name, suffix()),
    })

    if (!error && data) return { ok: true, workspace: data }

    // A caller who already has a workspace gets it back without an insert, so
    // only a new row can collide. A collision means another suffix; anything
    // else is a failure, logged here and never shown (rule 8).
    if (error?.code !== UNIQUE_VIOLATION) {
      console.error("[workspaces] provision_personal_workspace failed", error)
      return { ok: false }
    }
  }

  return { ok: false }
}
