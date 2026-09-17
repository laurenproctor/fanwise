import { publicMediaRoutes } from "@/lib/public/media-routes"
import { ProfileAvatar } from "./profile-avatar"

/**
 * An image on a public page.
 *
 * Every public image is served through a route handler rather than from a
 * public bucket, and the reason is `unpublish`. A public object stays
 * fetchable by whoever has its URL for as long as it exists; a route handler
 * re-checks, on every request, that the page it belongs to is still published
 * before it mints a five-minute signed URL. Taking a page down takes its
 * pictures down with it, which is what a creator means by the word.
 *
 * A plain `<img>`, not `next/image`. The optimizer would need the bucket
 * origin in `images.remotePatterns`, and the signed URLs it would then cache
 * outlive the signature by design — a cached optimized image is a page that
 * keeps rendering after it was unpublished. The route is already a redirect to
 * a CDN-backed object, so the optimizer buys little here and costs the one
 * property this whole design is for.
 *
 * `width`, `height` and `aspect-ratio` are always set. An image whose box is
 * unknown until it loads is a page that jumps under the reader's cursor, and
 * on a gallery of twelve cards it jumps twelve times.
 *
 * The default box is 16:9, which is the shape of a marketplace cover image, and
 * so the shape a creator's promo already has. The first version of these pages
 * used 4:3, and a wide cover placed in it lost a quarter of its width to the
 * crop, which on a promo with a title at one edge cut the title off. Grids
 * still crop (`fit: "cover"`), because a grid of mixed shapes is a grid that
 * staggers; the product page's hero uses `fit: "contain"` instead, so the one
 * picture a visitor came to see is never cut, whatever its shape.
 */
export function PublicImage({
  assetId,
  alt,
  className = "",
  sizes,
  priority = false,
  ratio = "16 / 9",
  fit = "cover",
}: {
  assetId: string
  /**
   * Required, and not optional with a default. A cover image carries the
   * product's name, which is the one thing a screen reader needs here, and a
   * component that let it be forgotten would produce a page of unlabelled
   * images without anybody noticing.
   */
  alt: string
  className?: string
  sizes?: string
  priority?: boolean
  ratio?: string
  /** `cover` crops to the box; `contain` letterboxes inside it and never crops. */
  fit?: "cover" | "contain"
}) {
  return (
    /* eslint-disable-next-line @next/next/no-img-element -- see the docblock: the
       optimizer would cache past the signed URL's lifetime, which defeats
       unpublishing. */
    <img
      src={publicMediaRoutes.asset(assetId)}
      alt={alt}
      sizes={sizes}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      style={{ aspectRatio: ratio }}
      className={`h-full w-full bg-[var(--color-paper-2)] ${fit === "contain" ? "object-contain" : "object-cover"} ${className}`}
    />
  )
}

/**
 * The creator's avatar, or their initials.
 *
 * The fallback is not a placeholder silhouette. A studio that has not uploaded
 * a mark still has a name, and two letters of it in the brand's own type reads
 * as a considered identity where a grey person icon reads as a broken image.
 * The same letters stand in when an image fails to load (ProfileAvatar), so a
 * removed or unreadable object never shows as a broken frame.
 *
 * `version` is the profile's `updated_at`, the same cache key the profile page
 * puts on its avatar. The avatar route is cached for a minute, and without the
 * version a replaced picture stayed on this page for that minute, pointing at
 * an object the replacement had already deleted.
 */
export function PublicAvatar({
  profileId,
  displayName,
  initials,
  hasAvatar,
  version,
  size = 96,
}: {
  profileId: string
  displayName: string
  initials: string
  hasAvatar: boolean
  version?: string
  size?: number
}) {
  const src = hasAvatar
    ? `${publicMediaRoutes.avatar(profileId)}${version ? `?v=${encodeURIComponent(version)}` : ""}`
    : null
  return (
    <ProfileAvatar
      src={src}
      initials={initials}
      size={size}
      alt={displayName}
      rounded="rounded-[20px]"
    />
  )
}
