import type { LicenseSelection } from "./types"

/**
 * The licence catalogue. Code, not a table, and deliberately so.
 *
 * Fanwise has no licence model: `products.license_summary` is one free-text
 * column and `asset_type` has a `license` member for a file somebody uploads.
 * Rather than build a licence generator, the migration alongside this file adds
 * three columns — `license_id`, `license_version`, `license_accepted_at` — and
 * this is the catalogue those keys point at.
 *
 * **A version is text, and changing an entry's wording means bumping it.** That
 * is the whole of the versioning machinery, and it is what makes the columns
 * worth having: a product that accepted `commercial@1` still says so after the
 * wording changes, and `licenseText()` can still produce what they agreed to.
 * Editing a `summary` without bumping its `version` silently rewrites history
 * for every product that accepted it, and a unit test asserts every entry has
 * one so the field cannot be forgotten.
 *
 * What is deliberately absent, and is a different feature: a per-workspace
 * catalogue, licence documents, per-channel licence mapping, and any rendering
 * of terms beyond the sentence below.
 */

export interface LicenseCatalogEntry extends LicenseSelection {
  /** Bumped whenever `summary` changes. Never reused. */
  readonly version: string
  /** What a creator reads beside the radio, above the terms themselves. */
  readonly hint: string
}

export const LICENSE_CATALOG: readonly LicenseCatalogEntry[] = [
  {
    id: "personal",
    name: "Personal use",
    version: "1",
    hint: "The narrowest. Buyers may use it themselves and nothing more.",
    summary: "For personal projects only. No commercial use, and no redistribution.",
  },
  {
    id: "commercial",
    name: "Commercial use",
    version: "1",
    hint: "The usual choice for a digital product sold to working designers.",
    summary:
      "For personal and commercial projects by the buyer. No redistribution and no resale of the files themselves.",
  },
  {
    id: "extended",
    name: "Extended commercial",
    version: "1",
    hint: "Widest. Allows work the buyer sells on to their own clients.",
    summary:
      "For personal and commercial projects, including work sold to the buyer's own clients and use in products for sale. No redistribution of the files themselves.",
  },
]

export const CUSTOM_LICENSE_ID = "custom"
/**
 * The version recorded for terms a creator wrote.
 *
 * Constant rather than incrementing, because the text is theirs and is stored
 * verbatim in `license_summary`: there is no catalogue entry to be out of date
 * with, and a number here would imply one.
 */
export const CUSTOM_LICENSE_VERSION = "own"

/** A licence the creator wrote. An empty summary leaves the step incomplete. */
export function customLicense(summary: string): LicenseSelection {
  return { id: CUSTOM_LICENSE_ID, name: "Your own terms", summary }
}

export function licenseEntry(id: string): LicenseCatalogEntry | null {
  return LICENSE_CATALOG.find((entry) => entry.id === id) ?? null
}

/**
 * The version to record for a chosen licence.
 *
 * Read from the catalogue rather than taken from the browser: the version is a
 * claim about what Fanwise showed, and a client that supplied it could claim a
 * creator accepted terms they never saw.
 */
export function versionFor(id: string): string {
  return id === CUSTOM_LICENSE_ID ? CUSTOM_LICENSE_VERSION : (licenseEntry(id)?.version ?? "1")
}

/**
 * What a creator accepted, reconstructed.
 *
 * For a catalogue licence the terms come from the catalogue at the version
 * recorded, which is why the version is stored. For custom terms the summary
 * on the product is the only copy there ever was, so it is returned as given.
 */
export function licenseText(params: {
  id: string | null
  version: string | null
  summary: string | null
}): string | null {
  if (!params.id) return null
  if (params.id === CUSTOM_LICENSE_ID) return params.summary
  const entry = licenseEntry(params.id)
  if (!entry) return params.summary
  return entry.version === params.version ? entry.summary : params.summary
}

/* ------------------------------------------------------------- attestation */

/**
 * The sentence a creator agrees to, and the version of it that is recorded.
 *
 * Bumped whenever a word of `RIGHTS_ATTESTATION_TEXT` changes, for the same
 * reason a licence version is: an attestation whose wording nobody kept is an
 * attestation to nothing in particular.
 */
export const RIGHTS_ATTESTATION_VERSION = "2026-09-12.1"

export const RIGHTS_ATTESTATION_TEXT =
  "I created this product or have permission to sell and distribute it."

/**
 * What Fanwise is and is not doing when it records that.
 *
 * Rendered next to the attestation, every time. Fanwise is collecting a
 * statement from a creator; it is not checking one, and it is not advice. Saying
 * so where the statement is made is the difference between a record and an
 * implied endorsement.
 */
export const RIGHTS_DISCLAIMER =
  "Fanwise records your statement and the time you made it. It does not check it, and this is not legal advice."

/** The second disclosure, asked separately because it is a different question. */
export const THIRD_PARTY_PROMPT =
  "Does this product include fonts, images, icons, APIs, datasets or other components you licensed from somebody else?"

export const THIRD_PARTY_HINT =
  "List them, with the licence each one is under. Leave it empty and confirm if there are none."
