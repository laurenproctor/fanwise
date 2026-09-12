import { publicMediaRoutes } from "@/lib/public/media-routes"

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
 */
export function PublicImage({
  assetId,
  alt,
  className = "",
  sizes,
  priority = false,
  ratio = "4 / 3",
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
      className={`h-full w-full bg-[var(--color-paper-2)] object-cover ${className}`}
    />
  )
}

/**
 * The creator's avatar, or their initials.
 *
 * The fallback is not a placeholder silhouette. A studio that has not uploaded
 * a mark still has a name, and two letters of it in the brand's own type reads
 * as a considered identity where a grey person icon reads as a broken image.
 */
export function PublicAvatar({
  profileId,
  displayName,
  initials,
  hasAvatar,
  size = 96,
}: {
  profileId: string
  displayName: string
  initials: string
  hasAvatar: boolean
  size?: number
}) {
  const box = { width: size, height: size }

  if (!hasAvatar) {
    return (
      <span
        style={box}
        role="img"
        aria-label={displayName}
        className="font-display flex shrink-0 items-center justify-center rounded-[20px] border border-[var(--color-rule)] bg-[var(--color-ink)] text-[var(--color-paper)]"
      >
        <span style={{ fontSize: Math.round(size * 0.38) }} className="tracking-[-0.02em]">
          {initials}
        </span>
      </span>
    )
  }

  return (
    /* eslint-disable-next-line @next/next/no-img-element -- as PublicImage. */
    <img
      src={publicMediaRoutes.avatar(profileId)}
      alt={displayName}
      width={size}
      height={size}
      style={box}
      decoding="async"
      className="shrink-0 rounded-[20px] border border-[var(--color-rule)] bg-[var(--color-paper-2)] object-cover"
    />
  )
}
