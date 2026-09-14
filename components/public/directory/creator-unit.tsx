import Link from "next/link"
import { ProfileAvatar } from "@/components/public/profile-avatar"
import { PublicImage } from "@/components/public/public-image"
import { initialsFor } from "@/lib/public/profile-presentation"
import { profileLinkLabel, productCountLabel } from "@/lib/public/directory"
import type { DirectoryCreator, DirectoryPreview } from "@/lib/public/directory-queries"
import { publicMediaRoutes } from "@/lib/public/media-routes"
import { publicRoutes } from "@/lib/routes"

/**
 * One creator in the directory: their work first, then who made it.
 *
 * Two interaction zones and no link around the whole unit. Each preview is its
 * own link to that product's page; the name and the explicit profile link go
 * to the profile. Wrapping the unit in a profile link would nest the product
 * links inside it, which is invalid and leaves a click on a thumbnail with two
 * possible destinations. The avatar is a second, pointer-only way to the
 * profile: out of the tab order and hidden from assistive technology, because
 * the name beside it is already that link.
 *
 * Focus order follows the DOM: previews, then the name, then the profile link.
 *
 * `featured` and `directory` differ only in the collage. Everything below the
 * images — type sizes, line count, the statement's clamp — is the same, so
 * every unit in a grid is the same height and no position looks promoted.
 */
export function CreatorUnit({
  creator,
  variant,
  eager = false,
}: {
  creator: DirectoryCreator
  variant: "featured" | "directory"
  /** Only for units in the first viewport. */
  eager?: boolean
}) {
  const profileHref = publicRoutes.profile(creator.handle)
  const nameId = `creator-${creator.id}`
  const section = variant === "featured" ? "featured" : "directory"
  // Place and kinds of work may be cut short on a narrow card; the count is
  // never the part that disappears.
  const description = [
    creator.location,
    creator.primaryTypes.length > 0 ? creator.primaryTypes.join(", ") : null,
  ].filter((part): part is string => Boolean(part))

  return (
    <article aria-labelledby={nameId} className="flex min-w-0 flex-col">
      <PreviewCollage creator={creator} variant={variant} eager={eager} />

      <div className="mt-4 flex items-start gap-3.5">
        <Link
          href={profileHref}
          tabIndex={-1}
          aria-hidden
          data-directory-link="profile"
          data-directory-section={section}
          className="shrink-0"
        >
          <ProfileAvatar
            src={
              creator.hasAvatar
                ? `${publicMediaRoutes.avatar(creator.id)}?v=${encodeURIComponent(creator.updatedAt)}`
                : null
            }
            initials={initialsFor(creator.displayName)}
            size={variant === "featured" ? 56 : 48}
            rounded="rounded-full"
          />
        </Link>

        <div className="min-w-0 flex-1">
          {/*
            `.fw h3` and `.fw p` zero their margins at a specificity the utility
            layer cannot beat, so spacing between these lines is padding. The
            name link is a 44px target, pulled back into a 24px line by its
            negative margin so the rhythm stays tight.
          */}
          <h3 id={nameId} className="font-display text-[19px] leading-[1.25] tracking-[-0.02em]">
            <Link
              href={profileHref}
              data-directory-link="profile"
              data-directory-section={section}
              className="-my-2.5 flex min-h-11 max-w-full items-center rounded-[4px] text-[var(--color-ink)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
            >
              <span className="truncate">{creator.displayName}</span>
            </Link>
          </h3>

          <p className="flex min-w-0 pt-1 text-[13.5px] whitespace-nowrap text-[var(--color-ink-3)]">
            {description.length > 0 ? (
              <span className="min-w-0 truncate">
                {description.join(" · ")}
                <span aria-hidden className="px-1.5">
                  ·
                </span>
              </span>
            ) : null}
            <span className="shrink-0">{productCountLabel(creator.productCount)}</span>
          </p>

          {/*
            Always rendered, so a creator without an introduction keeps the
            same height as one with. Clamped to one line in the directory; the
            saved text is never shortened, only its display.
          */}
          <p
            className={`box-content pt-1.5 text-[14.5px] leading-[1.5] text-[var(--color-ink-2)] ${
              variant === "featured" ? "line-clamp-2 min-h-[3em]" : "line-clamp-1 min-h-[1.5em]"
            }`}
          >
            {creator.shortBio}
          </p>

          <Link
            href={profileHref}
            data-directory-link="profile"
            data-directory-section={section}
            aria-describedby={nameId}
            className="-my-2 inline-flex min-h-11 items-center gap-1.5 rounded-[4px] text-[14px] text-[var(--color-accent)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          >
            {profileLinkLabel(creator.displayName)}
            <span aria-hidden>→</span>
          </Link>
        </div>
      </div>
    </article>
  )
}

/**
 * The work, arranged by how much of it there is. The outer box has one fixed
 * ratio per variant whatever the count, so a creator with one product takes
 * exactly the space of a creator with forty.
 */
const LAYOUTS = {
  featured: {
    box: "aspect-[3/2]",
    // Cell classes by preview count: a wide lead and a narrow partner above,
    // two halves below; or a tall lead beside two.
    cells: {
      1: ["col-span-6 row-span-2"],
      2: ["col-span-3 row-span-2", "col-span-3 row-span-2"],
      3: ["col-span-4 row-span-2", "col-span-2", "col-span-2"],
      4: ["col-span-4", "col-span-2", "col-span-3", "col-span-3"],
    },
    sizes: "(max-width: 767px) 100vw, (max-width: 1023px) 50vw, 380px",
  },
  directory: {
    box: "aspect-[2/1]",
    cells: {
      1: ["col-span-6 row-span-2"],
      2: ["col-span-3 row-span-2", "col-span-3 row-span-2"],
      3: ["col-span-4 row-span-2", "col-span-2", "col-span-2"],
    },
    sizes: "(max-width: 639px) 100vw, (max-width: 1023px) 50vw, (max-width: 1279px) 33vw, 280px",
  },
} as const

function PreviewCollage({
  creator,
  variant,
  eager,
}: {
  creator: DirectoryCreator
  variant: "featured" | "directory"
  eager: boolean
}) {
  const layout = LAYOUTS[variant]
  const max = variant === "featured" ? 4 : 3
  const previews = creator.previews.slice(0, max)
  const cells = layout.cells[Math.max(1, previews.length) as keyof typeof layout.cells]

  return (
    <ul
      aria-label={`Work by ${creator.displayName}`}
      className={`grid ${layout.box} w-full grid-cols-6 grid-rows-2 gap-1 overflow-hidden rounded-[10px]`}
    >
      {previews.map((preview, index) => (
        <li key={preview.slug} className={`relative min-h-0 min-w-0 ${cells[index] ?? ""}`}>
          <PreviewLink
            creator={creator}
            preview={preview}
            section={variant}
            eager={eager && index === 0}
            sizes={layout.sizes}
          />
        </li>
      ))}
    </ul>
  )
}

function PreviewLink({
  creator,
  preview,
  section,
  eager,
  sizes,
}: {
  creator: DirectoryCreator
  preview: DirectoryPreview
  section: "featured" | "directory"
  eager: boolean
  sizes: string
}) {
  const label = `Preview of ${preview.title} by ${creator.displayName}`
  return (
    <Link
      href={publicRoutes.product(creator.handle, preview.slug)}
      data-directory-link="product"
      data-directory-section={section}
      className="group relative block h-full w-full overflow-hidden bg-[var(--color-paper-2)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-accent)]"
    >
      {preview.coverAssetId ? (
        <PublicImage
          assetId={preview.coverAssetId}
          alt={label}
          ratio="auto"
          sizes={sizes}
          priority={eager}
          className="transition-transform duration-300 group-hover:scale-[1.015] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
      ) : (
        // No image yet is a real state. The same box, ruled and labelled with
        // the kind of work, rather than an empty rectangle or a broken frame.
        <span className="flex h-full w-full items-center justify-center p-3">
          <span aria-hidden className="label-mono text-center">
            {preview.typeLabel}
          </span>
          <span className="sr-only">{label}</span>
        </span>
      )}

      {/*
        The product's name, on hover or keyboard focus, as a small label in the
        corner rather than a dark wash over the artwork. Always shown where
        there is no hover, so a tap is never a guess. Hidden from assistive
        technology, which already has the link's name from the image.
      */}
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-2 left-2 max-w-[calc(100%-16px)] truncate rounded-[var(--radius-pill)] bg-[var(--color-paper)] px-2.5 py-1 text-[12.5px] text-[var(--color-ink)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100"
      >
        {preview.title} →
      </span>
    </Link>
  )
}
