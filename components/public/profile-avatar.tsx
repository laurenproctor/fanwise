"use client"

import { useState } from "react"

/**
 * A profile's image, or its initials when there is none or it will not load.
 *
 * A client component for one reason: `onError`. An image can fail after the
 * page rendered — a signed URL that expired under an open tab, an object
 * removed since, a file that is not really an image — and a public page must
 * never show the browser's broken-image icon where a studio's identity goes.
 * The initials are the same box in the same place, so falling back moves
 * nothing on the page.
 *
 * Square, with `object-cover`: any picture fills the box and is cropped from
 * its centre, which is the crop the builder's preview shows. Width, height and
 * aspect ratio are all set, so the page does not shift while it loads.
 */
export function ProfileAvatar({
  src,
  initials,
  size,
  alt = "",
  rounded = "rounded-[12px]",
  className = "",
}: {
  src: string | null
  initials: string
  size: number
  /** Empty by default: beside the studio's name, the image repeats it. */
  alt?: string
  rounded?: string
  className?: string
}) {
  const [failed, setFailed] = useState<string | null>(null)
  const box = { width: size, height: size }

  if (src && failed !== src) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element -- a blob: preview, a signed
         URL or the avatar route; see components/public/public-image.tsx for why
         public images do not go through the optimizer. */
      <img
        src={src}
        alt={alt}
        width={size}
        height={size}
        style={box}
        decoding="async"
        data-avatar="image"
        onError={() => setFailed(src)}
        className={`aspect-square shrink-0 border border-[var(--color-rule)] bg-[var(--color-paper-2)] object-cover ${rounded} ${className}`}
      />
    )
  }

  return (
    <span
      aria-hidden={alt ? undefined : true}
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
      style={box}
      data-avatar="initials"
      className={`font-display flex aspect-square shrink-0 items-center justify-center border border-[var(--color-rule)] bg-[var(--color-paper-2)] text-[var(--color-ink)] ${rounded} ${className}`}
    >
      <span style={{ fontSize: Math.round(size * 0.4) }} className="font-light tracking-[-0.04em]">
        {initials}
      </span>
    </span>
  )
}
