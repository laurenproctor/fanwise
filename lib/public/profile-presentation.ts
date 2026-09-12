import { resolvedLinks, type ResolvedLink } from "./profile-links"
import type { PublicProfileView, PublicProductCard } from "./types"

/**
 * Everything the public profile component is allowed to know.
 *
 * This type is the privacy boundary for the builder's preview, in the same way
 * `PublicProfileView` is for the public route: the component can only render
 * what arrives through it, and nothing here is a workspace id, an email, a
 * billing fact, a draft revision or a storage path. The two mappers below name
 * every field they copy, so a column added to a draft or a profile later cannot
 * reach a rendered page by accident.
 *
 * Links arrive already resolved. The component never parses a URL, which is
 * what guarantees the preview draws exactly the icons publication would.
 */
export interface ProfilePresentation {
  handle: string
  displayName: string
  shortBio: string | null
  /** A URL the viewer's browser may load: a blob, a signed URL or a media route. */
  avatarUrl: string | null
  initials: string
  links: ResolvedLink[]
  products: PresentationProduct[]
}

export interface PresentationProduct {
  key: string
  title: string
  typeLabel: string
  imageUrl: string | null
  imageAlt: string
}

/** The draft's editable fields, as typed. */
export interface ProfileDraftFields {
  handle: string
  displayName: string
  shortBio: string
  website: string
  instagram: string
  behance: string
}

/**
 * The builder's preview. Called on every keystroke, so it is cheap and pure.
 *
 * `handle` is the normalized form the field is showing, not what was typed:
 * the preview's address bar updates immediately with the canonical address,
 * while availability is checked separately and more slowly.
 */
export function presentationFromDraft(
  fields: ProfileDraftFields,
  options: { handle: string; avatarUrl: string | null; products: PresentationProduct[] },
): ProfilePresentation {
  const displayName = fields.displayName.trim()
  const shortBio = fields.shortBio.trim()
  return {
    handle: options.handle,
    displayName,
    shortBio: shortBio.length > 0 ? shortBio : null,
    avatarUrl: options.avatarUrl,
    initials: initialsFor(displayName),
    links: resolvedLinks({
      website: fields.website,
      instagram: fields.instagram,
      behance: fields.behance,
    }),
    products: options.products,
  }
}

/**
 * The same component, fed from the public read path. Unused by a route in this
 * phase; it exists so the shape is proven to fit both sides before the public
 * page adopts it at publication.
 */
export function presentationFromPublicView(
  profile: PublicProfileView & { behanceUrl?: string | null },
  cards: PublicProductCard[],
  media: { avatarUrl: string | null; imageUrl: (assetId: string) => string },
): ProfilePresentation {
  return {
    handle: profile.handle,
    displayName: profile.displayName,
    shortBio: profile.shortBio,
    avatarUrl: profile.hasAvatar ? media.avatarUrl : null,
    initials: initialsFor(profile.displayName),
    links: resolvedLinks({
      website: profile.websiteUrl ?? "",
      instagram: profile.instagramUrl ?? "",
      behance: profile.behanceUrl ?? "",
    }),
    products: cards.map((card) => ({
      key: card.slug,
      title: card.title,
      typeLabel: card.typeLabel,
      imageUrl: card.coverAssetId ? media.imageUrl(card.coverAssetId) : null,
      imageAlt: card.coverAlt,
    })),
  }
}

/** Up to two letters, the rule `lib/public/avatars.ts` uses. Copied, not imported: that module reaches for the admin client. */
export function initialsFor(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .map((word) => [...word].filter((ch) => /\p{L}|\p{N}/u.test(ch)))
    .filter((letters) => letters.length > 0)

  if (words.length === 0) return ""
  if (words.length === 1) return words[0]!.slice(0, 2).join("").toUpperCase()
  return `${words[0]![0]}${words[1]![0]}`.toUpperCase()
}
