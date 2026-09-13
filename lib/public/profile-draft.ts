import { z } from "zod"
import { classifyHandle } from "./handles"
import { LINK_PARSERS, parseContact, type ProfileLinkKind } from "./profile-links"
import type { ProfileDraftFields } from "./profile-presentation"
import type { Database } from "@/lib/supabase/database.types"

/**
 * The public-profile builder's draft.
 *
 * One model for all three steps. Step 1 edits the identity fields and the
 * image, step 2 edits `products`, step 3 reads the whole thing and publishes
 * it. Nothing in this module writes anywhere; it describes the shape, bounds
 * it for storage, and decides whether a step is complete.
 *
 * Two validations, on purpose, answering different questions:
 *
 *   - `draftFieldsSchema` asks "may this be stored?". It bounds length and
 *     nothing else, so a half-typed address survives a refresh exactly as
 *     typed. The table's CHECKs are the same bounds.
 *   - `checkDetailsStep` asks "is step 1 finished?". It runs the handle,
 *     link and name rules, and it is what Continue and publication call.
 */

export type ProfileDraftRow = Database["public"]["Tables"]["public_profile_drafts"]["Row"]
type PublicProfileRow = Database["public"]["Tables"]["public_profiles"]["Row"]

export const DRAFT_LIMITS = {
  handle: 64,
  displayName: 80,
  shortBio: 160,
  link: 2048,
  /** What step 1 accepts. The draft column stores up to 200, as typed. */
  location: 80,
  locationStored: 200,
} as const

export type { ProfileDraftFields }

/** A product's place on the profile: whether it shows, in array order. */
export interface DraftProduct {
  productId: string
  visible: boolean
}

export interface ProfileDraft {
  profileId: string
  fields: ProfileDraftFields
  avatarPath: string | null
  products: DraftProduct[]
  revision: number
  /**
   * When the stored draft last changed, or null for a draft never saved. Step 3
   * sends it back with Publish so a draft edited after review is refused.
   */
  updatedAt: string | null
}

/**
 * Where the live profile stands. The builder shows this and never changes it:
 * only publication moves a draft into `public_profiles`.
 */
export interface PublishedState {
  status: "draft" | "published"
  handle: string
  publishedAt: string | null
}

export const draftFieldsSchema = z.object({
  handle: z.string().max(DRAFT_LIMITS.handle),
  displayName: z.string().max(200),
  shortBio: z.string().max(DRAFT_LIMITS.shortBio),
  website: z.string().max(DRAFT_LIMITS.link),
  instagram: z.string().max(DRAFT_LIMITS.link),
  behance: z.string().max(DRAFT_LIMITS.link),
  location: z.string().max(DRAFT_LIMITS.locationStored),
  contact: z.string().max(DRAFT_LIMITS.link),
})

export const draftProductsSchema = z
  .array(z.object({ productId: z.uuid(), visible: z.boolean() }))
  .max(500)

/**
 * A draft that has never been saved is the live profile, copied. Seeding from
 * the row rather than from blanks is what makes "open the builder" safe for a
 * profile that is already published: the first autosave stores what is
 * already public, not an empty page.
 */
export function seedDraftFromProfile(profile: PublicProfileRow): ProfileDraft {
  return {
    profileId: profile.id,
    fields: {
      handle: profile.handle,
      displayName: profile.display_name.slice(0, 200),
      shortBio: (profile.short_bio ?? "").slice(0, DRAFT_LIMITS.shortBio),
      website: profile.website_url ?? "",
      instagram: profile.instagram_url ?? "",
      behance: profile.behance_url ?? "",
      location: (profile.location ?? "").slice(0, DRAFT_LIMITS.locationStored),
      // The field takes a bare address and adds the scheme itself.
      contact: (profile.contact_url ?? "").replace(/^mailto:/i, ""),
    },
    avatarPath: profile.avatar_path,
    products: [],
    revision: 0,
    updatedAt: null,
  }
}

/** Reads a stored draft, treating an unreadable `products` value as empty rather than failing the page. */
export function draftFromRow(row: ProfileDraftRow): ProfileDraft {
  const products = draftProductsSchema.safeParse(row.products)
  return {
    profileId: row.public_profile_id,
    fields: {
      handle: row.handle,
      displayName: row.display_name,
      shortBio: row.short_bio,
      website: row.website,
      instagram: row.instagram,
      behance: row.behance,
      // `?? ""` for the deploy window, not for the steady state. Production is
      // deployed from main before 20260913020000 is applied to it, so for a few
      // minutes a draft row has neither column. Reading that as "not set" keeps
      // the builder rendering; a save in that window fails at the database and
      // writes nothing, so no value is lost either way.
      location: row.location ?? "",
      contact: row.contact ?? "",
    },
    avatarPath: row.avatar_path,
    products: products.success ? products.data : [],
    revision: row.revision,
    updatedAt: row.updated_at,
  }
}

export type DetailsField = keyof ProfileDraftFields
export type DetailsErrors = Partial<Record<DetailsField, string>>

/**
 * Whether step 1 is complete, without asking anybody else's data.
 *
 * Handle availability is not decided here, because it cannot be decided
 * purely; the Continue action adds it. Everything else that blocks the step
 * is, so the browser and the server agree on every message but that one.
 */
export function checkDetailsStep(fields: ProfileDraftFields): DetailsErrors {
  const errors: DetailsErrors = {}

  const handle = classifyHandle(fields.handle)
  if (handle.kind === "empty") errors.handle = "Choose your studio address."
  else if (handle.kind === "invalid") errors.handle = handle.message
  else if (handle.kind === "reserved") errors.handle = "That address is reserved. Choose another."

  const name = fields.displayName.trim()
  if (name.length === 0) errors.displayName = "Add your studio name."
  else if (name.length > DRAFT_LIMITS.displayName) {
    errors.displayName = `Keep the name under ${DRAFT_LIMITS.displayName} characters.`
  }

  if (fields.shortBio.length > DRAFT_LIMITS.shortBio) {
    errors.shortBio = `Keep the introduction under ${DRAFT_LIMITS.shortBio} characters.`
  }

  for (const kind of ["website", "instagram", "behance"] as const satisfies ProfileLinkKind[]) {
    const parsed = LINK_PARSERS[kind](fields[kind])
    if (parsed.kind === "invalid") errors[kind] = parsed.message
  }

  // Both optional. Empty is always complete; only a filled field can be wrong.
  if (fields.location.trim().length > DRAFT_LIMITS.location) {
    errors.location = `Keep the location under ${DRAFT_LIMITS.location} characters.`
  }

  const contact = parseContact(fields.contact)
  if (contact.kind === "invalid") errors.contact = contact.message

  return errors
}
