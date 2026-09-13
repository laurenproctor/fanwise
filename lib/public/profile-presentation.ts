import { formatLocation } from "@/lib/location/countries"
import { parseContact, resolveLinks, type DraftLink, type ResolvedLink } from "./profile-links"
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
 * what guarantees the preview draws exactly the icons publication would. The
 * Contact button is resolved the same way, by `parseContact`, so the preview
 * shows a button exactly when publication would write one.
 */
export interface ProfilePresentation {
  handle: string
  displayName: string
  shortBio: string | null
  /** The longer About. Null when the creator left it empty. */
  about: string | null
  /** A URL the viewer's browser may load: a blob, a signed URL or a media route. */
  avatarUrl: string | null
  initials: string
  /** "Brooklyn, United States", a country alone, or a legacy free-text location. Null for none. */
  location: string | null
  links: ResolvedLink[]
  /** The Contact button, or null to show none. `url` is `mailto:` or https. */
  contact: { url: string; label: string } | null
  products: PresentationProduct[]
  /**
   * The kinds of product on the page, in the order they first appear. Derived
   * from the products shown, never typed, so it cannot claim a specialty the
   * catalog does not back up.
   */
  specialties: string[]
}

export interface PresentationProduct {
  key: string
  title: string
  typeLabel: string
  imageUrl: string | null
  imageAlt: string
  /** The product's public page. Set on the public route; absent in the builder's previews. */
  href?: string | null
  /** One line about the product, when the page or the product has one. */
  summary?: string | null
  startingPrice?: { amount: number; currency: string } | null
  channelCount?: number
}

/** The draft's editable fields, as typed. */
export interface ProfileDraftFields {
  handle: string
  displayName: string
  shortBio: string
  /** Optional, longer than the introduction. */
  about: string
  /** Optional. A city from the dataset, only with a country. */
  city: string
  /** Optional ISO 3166-1 alpha-2 code, or empty. */
  countryCode: string
  /**
   * The legacy free-text location, kept for a profile that has not chosen a
   * city and country yet. Ignored once a country is chosen.
   */
  location: string
  /** The creator's links, in order, as typed. */
  links: DraftLink[]
  /** Optional: an email address or a website. Empty means no Contact button. */
  contact: string
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
  const about = fields.about.trim()
  return {
    handle: options.handle,
    displayName,
    shortBio: shortBio.length > 0 ? shortBio : null,
    about: about.length > 0 ? about : null,
    avatarUrl: options.avatarUrl,
    initials: initialsFor(displayName),
    location: formatLocation({
      city: fields.city,
      countryCode: fields.countryCode.trim(),
      legacy: fields.location,
    }),
    contact: resolvedContact(fields.contact),
    links: resolveLinks(fields.links),
    products: options.products,
    specialties: specialtiesOf(options.products),
  }
}

/**
 * The same component, fed from the public read path: what `/@handle` renders.
 * Only published rows reach it, because the rows come from the anon client.
 */
export function presentationFromPublicView(
  profile: PublicProfileView,
  cards: PublicProductCard[],
  media: {
    avatarUrl: string | null
    imageUrl: (assetId: string) => string
    productHref: (slug: string) => string
  },
): ProfilePresentation {
  const products = cards.map((card) => ({
    key: card.slug,
    title: card.title,
    typeLabel: card.typeLabel,
    imageUrl: card.coverAssetId ? media.imageUrl(card.coverAssetId) : null,
    imageAlt: card.coverAlt,
    href: media.productHref(card.slug),
    summary: card.summary,
    startingPrice: card.startingPrice,
    channelCount: card.channelCount,
  }))
  return {
    handle: profile.handle,
    displayName: profile.displayName,
    shortBio: profile.shortBio,
    about: profile.about?.trim() ? profile.about.trim() : null,
    avatarUrl: profile.hasAvatar ? media.avatarUrl : null,
    initials: initialsFor(profile.displayName),
    location: formatLocation({
      city: profile.city,
      countryCode: profile.countryCode,
      legacy: profile.location,
    }),
    contact: resolvedContact(profile.contactUrl ?? ""),
    links: resolveLinks(profile.links),
    products,
    specialties: specialtiesOf(products),
  }
}

function specialtiesOf(products: readonly PresentationProduct[]): string[] {
  return [...new Set(products.map((product) => product.typeLabel).filter(Boolean))]
}

/**
 * A Contact button, or none. The same parser reads what a creator typed and
 * what the live row holds, so `mailto:hello@studio.com` from the database and
 * `hello@studio.com` from the field both label the button with the address.
 */
function resolvedContact(raw: string): ProfilePresentation["contact"] {
  const parsed = parseContact(raw)
  return parsed.kind === "valid" ? { url: parsed.url, label: parsed.label } : null
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
