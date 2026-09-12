/**
 * The shapes the public-surface forms exchange with their actions.
 *
 * A separate module because `lib/public/actions.ts` carries `"use server"`,
 * and such a module may export nothing but async functions — a type or a
 * constant exported alongside them is a build error, not a style preference.
 * Both the actions and the client components import from here.
 */

export interface PublicProfileState {
  error: string | null
  fieldErrors: Partial<
    Record<
      | "handle"
      | "displayName"
      | "shortBio"
      | "location"
      | "websiteUrl"
      | "instagramUrl"
      | "contactUrl"
      | "seoTitle"
      | "seoDescription"
      | "avatar",
      string
    >
  >
  savedAt: number | null
  /**
   * What the profile holds now, when this save is the reason it holds it.
   *
   * The form compares its fields against this rather than keeping a second
   * copy of "last saved" in a state hook it has to remember to update. See the
   * longer note in app/[slug]/settings/studio-details-form.tsx, whose pattern
   * this follows deliberately.
   */
  saved: { handle: string; hasAvatar: boolean } | null
}

export const EMPTY_PROFILE_STATE: PublicProfileState = {
  error: null,
  fieldErrors: {},
  savedAt: null,
  saved: null,
}

export interface PublicProductPageState {
  error: string | null
  fieldErrors: Partial<
    Record<
      | "slug"
      | "titleOverride"
      | "summaryOverride"
      | "descriptionOverride"
      | "coverAssetId"
      | "seoTitle"
      | "seoDescription",
      string
    >
  >
  savedAt: number | null
  saved: { slug: string } | null
}

export const EMPTY_PAGE_STATE: PublicProductPageState = {
  error: null,
  fieldErrors: {},
  savedAt: null,
  saved: null,
}
