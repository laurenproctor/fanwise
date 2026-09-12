import type { ProfilePresentation, PresentationProduct } from "@/lib/public/profile-presentation"
import type { ProfileLinkKind } from "@/lib/public/profile-links"

/**
 * A creator's public profile, drawn from data it is handed.
 *
 * One component for every place the profile appears: the builder's live
 * preview, its final preview, and the public page. It fetches nothing, writes
 * nothing, holds no state and imports no action, so what it renders is a pure
 * function of `profile` — which is what makes "the preview is what customers
 * will see" a property of the code rather than a promise kept by two copies of
 * the markup.
 *
 * Its props are `ProfilePresentation` and nothing wider. That type carries no
 * workspace, email, billing or draft field, so there is nothing private here
 * to leak even by mistake (see lib/public/profile-presentation.ts).
 *
 * `layout` exists because the builder's preview pane is narrower than any
 * viewport breakpoint: a "desktop" preview inside a 600px column has to lay
 * out as desktop regardless of the window, so it cannot lean on `sm:` and
 * `lg:`. The public page passes `responsive` and gets the breakpoints.
 *
 * `interactive={false}` renders links as text. Inside a preview a link is a
 * way to leave the builder by accident, and a tab stop on every product card
 * between the form and the Continue button.
 *
 * There is no email icon and no contact control. That is deliberate, and
 * tested.
 */

export type ProfileLayout = "desktop" | "mobile" | "responsive"

const LAYOUT = {
  desktop: {
    // The nav sits above the identity, right-aligned, as the mockup draws it:
    // beside the name it would squeeze a two-word studio onto two lines in a
    // pane this narrow. DOM order stays identity-first for screen readers.
    header: "flex-col-reverse gap-3",
    identity: "flex-row items-center gap-5",
    nav: "self-end text-[13px]",
    avatar: 72,
    name: "text-[30px]",
    grid: "grid-cols-2",
    pad: "px-7 py-7",
  },
  mobile: {
    header: "flex-col gap-5",
    identity: "flex-col items-start gap-4",
    nav: "text-[14px]",
    avatar: 64,
    name: "text-[26px]",
    grid: "grid-cols-1",
    pad: "px-5 py-6",
  },
  responsive: {
    header: "flex-col gap-5 sm:flex-row sm:items-start sm:justify-between sm:gap-6",
    identity: "flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6",
    nav: "text-[14px]",
    avatar: 96,
    name: "text-[32px] sm:text-[44px]",
    grid: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    pad: "px-5 py-10 sm:px-8 sm:py-14",
  },
} as const

export function PublicProfile({
  profile,
  layout,
  interactive = true,
  nameAs: Name = "h1",
  placeholders = false,
  emptyProductsMessage = "No products to show yet.",
}: {
  profile: ProfilePresentation
  layout: ProfileLayout
  interactive?: boolean
  /** h1 on the public page; h2 when the profile is a preview inside another page. */
  nameAs?: "h1" | "h2" | "h3"
  /** Show gentle stand-ins for empty fields. For the builder, never the public page. */
  placeholders?: boolean
  emptyProductsMessage?: string
}) {
  const shape = LAYOUT[layout]
  const hasName = profile.displayName.length > 0

  return (
    <article
      data-layout={layout}
      aria-label={hasName ? `${profile.displayName} public profile` : "Public profile"}
      className={`flex flex-col gap-8 bg-[var(--color-paper)] text-[var(--color-ink)] ${shape.pad}`}
    >
      <header className={`flex ${shape.header}`}>
        <div className={`flex min-w-0 ${shape.identity}`}>
          <Avatar profile={profile} size={shape.avatar} />
          <div className="flex min-w-0 flex-col gap-1.5">
            <Name
              className={`font-display leading-[1.05] font-light tracking-[-0.03em] break-words ${shape.name} ${
                hasName ? "" : "text-[var(--color-ink-3)]"
              }`}
            >
              {hasName ? profile.displayName : placeholders ? "Your studio name" : null}
            </Name>
            {profile.shortBio ? (
              <p className="max-w-prose text-[15px] break-words text-[var(--color-ink-2)]">
                {profile.shortBio}
              </p>
            ) : placeholders ? (
              <p className="text-[15px] text-[var(--color-ink-3)]">
                Your short introduction appears here.
              </p>
            ) : null}
          </div>
        </div>

        <nav
          aria-label={hasName ? `${profile.displayName} profile` : "Profile"}
          className={`flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 ${shape.nav}`}
        >
          <SectionLink href="#profile-products" interactive={interactive}>
            Products
          </SectionLink>
          <SectionLink href="#profile-about" interactive={interactive}>
            About
          </SectionLink>
          {profile.links.length > 0 ? (
            <ul className="flex items-center gap-3" aria-label="Links">
              {profile.links.map((link) => (
                <li key={link.kind}>
                  <LinkIcon
                    kind={link.kind}
                    url={link.url}
                    label={link.label}
                    interactive={interactive}
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </nav>
      </header>

      <section id="profile-products" aria-label="Products" className="flex flex-col gap-4">
        {profile.products.length > 0 ? (
          <ul className={`grid gap-5 ${shape.grid}`}>
            {profile.products.map((product) => (
              <ProductTile key={product.key} product={product} />
            ))}
          </ul>
        ) : (
          <p className="rounded-[12px] border border-dashed border-[var(--color-rule)] px-5 py-8 text-center text-[14px] text-[var(--color-ink-3)]">
            {emptyProductsMessage}
          </p>
        )}
      </section>

      {/*
        About repeats nothing from the header but the name: it is where the
        links are spelled out in words, for a visitor who cannot tell a globe
        icon from a Behance mark.
      */}
      {hasName || profile.links.length > 0 ? (
        <section
          id="profile-about"
          aria-label="About"
          className="flex flex-col gap-3 border-t border-[var(--color-rule)] pt-6"
        >
          <span className="label-mono">About{hasName ? ` ${profile.displayName}` : ""}</span>
          {profile.links.length > 0 ? (
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-[14px] text-[var(--color-ink-2)]">
              {profile.links.map((link) => (
                <li key={link.kind} className="break-all">
                  {interactive ? (
                    <a
                      href={link.url}
                      target="_blank"
                      rel="me noopener noreferrer nofollow"
                      className="underline underline-offset-4 hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                    >
                      {link.label}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  ) : (
                    link.label
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </article>
  )
}

function Avatar({ profile, size }: { profile: ProfilePresentation; size: number }) {
  const box = { width: size, height: size }
  if (profile.avatarUrl) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element -- a blob: preview or a
         short-lived signed URL; the optimizer can use neither. */
      <img
        src={profile.avatarUrl}
        alt=""
        width={size}
        height={size}
        style={box}
        decoding="async"
        className="shrink-0 rounded-[12px] border border-[var(--color-rule)] bg-[var(--color-paper-2)] object-cover"
      />
    )
  }
  return (
    <span
      aria-hidden
      style={box}
      className="font-display flex shrink-0 items-center justify-center rounded-[12px] border border-[var(--color-rule)] bg-[var(--color-paper-2)] text-[var(--color-ink)]"
    >
      <span style={{ fontSize: Math.round(size * 0.4) }} className="font-light tracking-[-0.04em]">
        {profile.initials}
      </span>
    </span>
  )
}

function SectionLink({
  href,
  interactive,
  children,
}: React.PropsWithChildren<{ href: string; interactive: boolean }>) {
  if (!interactive) return <span className="text-[var(--color-ink)]">{children}</span>
  return (
    <a
      href={href}
      className="text-[var(--color-ink)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
    >
      {children}
    </a>
  )
}

function ProductTile({ product }: { product: PresentationProduct }) {
  return (
    <li className="flex min-w-0 flex-col gap-2">
      <div className="aspect-[4/3] w-full overflow-hidden rounded-[8px] bg-[var(--color-paper-2)]">
        {product.imageUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element -- as Avatar. */
          <img
            src={product.imageUrl}
            alt={product.imageAlt}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          // Intentional rather than an empty grey box: a creator should be able to
          // tell "no image yet" from "image still loading".
          <span
            role="img"
            aria-label={`${product.title} has no image`}
            data-missing-image
            className="flex h-full w-full items-center justify-center text-[var(--color-ink-3)]"
          >
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              width="28"
              height="28"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
            >
              <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
              <path d="m3.5 16 5-5 4 4 3-3 5 5" strokeLinejoin="round" />
              <circle cx="15.5" cy="9" r="1.5" />
            </svg>
          </span>
        )}
      </div>
      <span className="text-[15px] break-words text-[var(--color-ink)]">{product.title}</span>
      <span className="text-[13px] text-[var(--color-ink-3)]">{product.typeLabel}</span>
    </li>
  )
}

const LINK_NAMES: Record<ProfileLinkKind, string> = {
  website: "Website",
  instagram: "Instagram",
  behance: "Behance",
}

function LinkIcon({
  kind,
  url,
  label,
  interactive,
}: {
  kind: ProfileLinkKind
  url: string
  label: string
  interactive: boolean
}) {
  const name = `${LINK_NAMES[kind]}: ${label}`
  const icon = <Glyph kind={kind} />
  if (!interactive) {
    return (
      <span
        role="img"
        aria-label={name}
        data-link={kind}
        className="flex h-6 w-6 items-center justify-center"
      >
        {icon}
      </span>
    )
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="me noopener noreferrer nofollow"
      aria-label={`${name} (opens in a new tab)`}
      data-link={kind}
      className="flex h-11 w-11 items-center justify-center rounded-full text-[var(--color-ink)] hover:bg-[var(--color-paper-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
    >
      {icon}
    </a>
  )
}

function Glyph({ kind }: { kind: ProfileLinkKind }) {
  const common = {
    viewBox: "0 0 24 24",
    width: 18,
    height: 18,
    "aria-hidden": true,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  }
  switch (kind) {
    case "website":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" />
        </svg>
      )
    case "instagram":
      return (
        <svg {...common}>
          <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
          <circle cx="12" cy="12" r="3.8" />
          <circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" />
        </svg>
      )
    case "behance":
      return (
        <svg {...common}>
          <path d="M3 7h5a2.5 2.5 0 0 1 0 5H3V7Zm0 5h5.5a2.75 2.75 0 0 1 0 5.5H3V12Z" />
          <path d="M14 13.5h7a3.5 3.5 0 1 0-1 2.5M15 8h5" />
        </svg>
      )
  }
}
