import { z } from "zod"
import type { User } from "@supabase/supabase-js"

/**
 * The person, as distinct from their studio.
 *
 * Fanwise has no profiles table and does not need one yet: a first name, a last
 * name and an email address are facts about an auth account, and Supabase keeps
 * exactly those. The names live in user_metadata, which is writable by the
 * account itself — acceptable here for the same reason it is acceptable in
 * lib/workspaces/provision.ts, and for no wider purpose: the value labels that
 * same account and nothing reads it to make a decision. It is parsed rather
 * than trusted on the way out, so an object, a number or a paragraph that
 * reached the column renders as empty instead of as itself.
 *
 * The email is NOT metadata. It is the identity column on the auth user, and it
 * moves only through the provider's confirmation flow.
 */

export const FIRST_NAME_KEY = "first_name"
export const LAST_NAME_KEY = "last_name"

/** What provision.ts reads when it names a new workspace. Kept in step. */
export const FULL_NAME_KEY = "full_name"

const MAX_PERSON_NAME = 60

const metadataSchema = z.record(z.string(), z.unknown())

function readName(metadata: unknown, key: string): string {
  const parsed = metadataSchema.safeParse(metadata)
  if (!parsed.success) return ""
  const value = parsed.data[key]
  if (typeof value !== "string") return ""
  const trimmed = value.trim()
  return trimmed.length > MAX_PERSON_NAME ? "" : trimmed
}

export interface AccountProfile {
  firstName: string
  lastName: string
  email: string
  /** True while the provider holds a confirmed-but-unapplied address change. */
  pendingEmail: string | null
}

export function accountProfile(user: User): AccountProfile {
  return {
    firstName: readName(user.user_metadata, FIRST_NAME_KEY),
    lastName: readName(user.user_metadata, LAST_NAME_KEY),
    email: user.email ?? "",
    // Supabase exposes the address awaiting confirmation here. It is a real
    // state a creator needs to see: the page would otherwise show the old
    // address with no sign that a change is in flight.
    pendingEmail: typeof user.new_email === "string" && user.new_email ? user.new_email : null,
  }
}

/**
 * The metadata patch for a saved name.
 *
 * `full_name` is written alongside the two parts because provision.ts reads it
 * when naming a workspace. Someone who fills in their name here and later gains
 * a second workspace should get it named for them, rather than "My studio"
 * because the two spellings of the same fact never met.
 */
export function nameMetadata(firstName: string, lastName: string): Record<string, string> {
  const full = [firstName, lastName].filter(Boolean).join(" ")
  return { [FIRST_NAME_KEY]: firstName, [LAST_NAME_KEY]: lastName, [FULL_NAME_KEY]: full }
}
