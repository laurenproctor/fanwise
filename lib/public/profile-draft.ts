import { z } from "zod"
import { countryName, isCountryCode } from "@/lib/location/countries"
import { classifyHandle } from "./handles"
import {
  LINK_LABEL_MAX,
  MAX_PROFILE_LINKS,
  checkLinks,
  parseContact,
  type LinkIssue,
} from "./profile-links"
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
 *     link, name and location rules, and it is what Continue and publication
 *     call. Whether a city really is in its country needs the city dataset,
 *     which is server only, so that one rule is `checkCity` in
 *     `./location-check` and the server adds it.
 */

export type ProfileDraftRow = Database["public"]["Tables"]["public_profile_drafts"]["Row"]
type PublicProfileRow = Database["public"]["Tables"]["public_profiles"]["Row"]

export const DRAFT_LIMITS = {
  handle: 64,
  displayName: 80,
  shortBio: 160,
  about: 2000,
  link: 2048,
  /** The legacy free-text location: what step 1 accepts, and what the column stores as typed. */
  location: 80,
  locationStored: 200,
  city: 80,
  cityStored: 200,
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

export const draftLinkSchema = z.object({
  url: z.string().max(DRAFT_LIMITS.link),
  label: z.string().max(LINK_LABEL_MAX * 2),
})

/**
 * Every field is required. A builder tab left open from before a field existed
 * sends a body without it; refusing that save (the tab reports a failed save
 * until it is reloaded) is what stops it blanking a value it never showed.
 */
export const draftFieldsSchema = z.object({
  handle: z.string().max(DRAFT_LIMITS.handle),
  displayName: z.string().max(200),
  shortBio: z.string().max(DRAFT_LIMITS.shortBio),
  about: z.string().max(DRAFT_LIMITS.about),
  city: z.string().max(DRAFT_LIMITS.cityStored),
  countryCode: z.string().max(2),
  location: z.string().max(DRAFT_LIMITS.locationStored),
  links: z.array(draftLinkSchema).max(MAX_PROFILE_LINKS),
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
 *
 * Links are passed in because they live in their own table.
 */
export function seedDraftFromProfile(
  profile: PublicProfileRow,
  links: ReadonlyArray<{ url: string; label: string | null }> = [],
): ProfileDraft {
  return {
    profileId: profile.id,
    fields: {
      handle: profile.handle,
      displayName: profile.display_name.slice(0, 200),
      shortBio: (profile.short_bio ?? "").slice(0, DRAFT_LIMITS.shortBio),
      about: (profile.about ?? "").slice(0, DRAFT_LIMITS.about),
      city: profile.city ?? "",
      countryCode: profile.country_code ?? "",
      location: (profile.location ?? "").slice(0, DRAFT_LIMITS.locationStored),
      links: links
        .slice(0, MAX_PROFILE_LINKS)
        .map((link) => ({ url: link.url, label: link.label ?? "" })),
      // The field takes a bare address and adds the scheme itself.
      contact: (profile.contact_url ?? "").replace(/^mailto:/i, ""),
    },
    avatarPath: profile.avatar_path,
    products: [],
    revision: 0,
    updatedAt: null,
  }
}

const storedLinksSchema = z.array(
  z
    .object({ url: z.string().catch(""), label: z.string().catch("") })
    .catch({ url: "", label: "" }),
)

/** Reads a stored draft, treating an unreadable `products` or `links` value as empty rather than failing the page. */
export function draftFromRow(row: ProfileDraftRow): ProfileDraft {
  const products = draftProductsSchema.safeParse(row.products)
  const links = storedLinksSchema.safeParse(row.links)
  return {
    profileId: row.public_profile_id,
    fields: {
      handle: row.handle,
      displayName: row.display_name,
      shortBio: row.short_bio,
      // `?? ""` for the deploy window: production is deployed from main before
      // 20260913030000 is applied to it, so for a few minutes a draft row has
      // none of these columns. A save in that window fails at the database and
      // writes nothing, so no value is lost.
      about: row.about ?? "",
      city: row.city ?? "",
      countryCode: row.country_code ?? "",
      location: row.location ?? "",
      links: links.success ? links.data.slice(0, MAX_PROFILE_LINKS) : [],
      contact: row.contact ?? "",
    },
    avatarPath: row.avatar_path,
    products: products.success ? products.data : [],
    revision: row.revision,
    updatedAt: row.updated_at,
  }
}

/** The fields a message can be attached to. Links report per row instead. */
export type DetailsField = Exclude<keyof ProfileDraftFields, "links">

export type DetailsErrors = Partial<Record<DetailsField, string>> & { links?: LinkIssue[] }

/** Whether a set of step 1 errors is empty. */
export function hasDetailsErrors(errors: DetailsErrors): boolean {
  return Object.entries(errors).some(([key, value]) =>
    key === "links" ? (value as LinkIssue[]).length > 0 : Boolean(value),
  )
}

/**
 * Whether step 1 is complete, without asking anybody else's data.
 *
 * Two facts cannot be decided purely and are added by the server: whether the
 * handle is free, and whether the city is really in the chosen country.
 * Everything else that blocks the step is decided here, so the browser and
 * the server agree on every other message.
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
  if (fields.about.trim().length > DRAFT_LIMITS.about) {
    errors.about = `Keep About under ${DRAFT_LIMITS.about} characters.`
  }

  const links = checkLinks(fields.links)
  if (links.length > 0) errors.links = links

  // Location, optional. A country alone is complete; a city needs its country.
  const country = fields.countryCode.trim()
  const city = fields.city.trim()
  if (country.length > 0 && !isCountryCode(country)) {
    errors.countryCode = "Choose a country from the list."
  }
  if (city.length > 0 && country.length === 0) {
    errors.city = "Choose a country first, then a city in it."
  } else if (city.length > DRAFT_LIMITS.city) {
    errors.city = `Keep the city under ${DRAFT_LIMITS.city} characters.`
  }
  if (country.length === 0 && fields.location.trim().length > DRAFT_LIMITS.location) {
    errors.location = `Keep the location under ${DRAFT_LIMITS.location} characters.`
  }

  const contact = parseContact(fields.contact)
  if (contact.kind === "invalid") errors.contact = contact.message

  return errors
}

/** The message for a city the dataset does not place in the chosen country. */
export function unknownCityMessage(countryCode: string): string {
  const country = countryName(countryCode)
  return country
    ? `Choose a city in ${country} from the list, or leave the city empty.`
    : "Choose a city from the list, or leave the city empty."
}
