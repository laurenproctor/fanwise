import type { ProfilePresentation } from "@/lib/public/profile-presentation"
import { kindName, type ResolvedLink } from "@/lib/public/profile-links"
import { DEFAULT_BROWSE, browseSearch, type BrowseState } from "@/lib/public/product-browse"
import { LinkGlyph } from "./link-glyph"
import { ProfileAvatar } from "./profile-avatar"
import { ProfileProductBrowser } from "./profile-product-browser"

/**
 * A creator's public profile, drawn from data it is handed.
 *
 * One component for every place the profile appears: the builder's live
 * preview, its final preview, and the public page. It fetches nothing, writes
 * nothing and imports no action, so what it renders is a pure function of
 * `profile` — which is what makes "the preview is what customers will see" a
 * property of the code rather than a promise kept by two copies of the markup.
 * (The avatar is a small client component, for its load-failure fallback; it
 * holds no data of its own.)
 *
 * Its props are `ProfilePresentation` and nothing wider. That type carries no
 * workspace, email, billing or draft field, so there is nothing private here
 * to leak even by mistake (see lib/public/profile-presentation.ts).
 *
 * Three parts, in the order a visitor needs them:
 *
 *   1. Who: the image, the studio's name, where it is, one line on what it
 *      does, and the ways to reach it.
 *   2. The work: the products, as a grid of cards that each go to the
 *      product's own page, with a search, a filter by kind and a sort once
 *      there are enough to look through (profile-product-browser.tsx).
 *   3. About: the longer text, the kinds of product the studio makes (each a
 *      link to that kind in the grid, on the public page), where it is based,
 *      and every link written out in words.
 *
 * Each part renders only what the creator filled in. A partial profile is a
 * shorter page, never one with empty labels or a stray comma; the builder's
 * preview passes `placeholders` to show gentle stand-ins while it is edited.
 *
 * `layout` exists because the builder's preview pane is narrower than any
 * viewport breakpoint: a "desktop" preview inside a 600px column has to lay
 * out as desktop regardless of the window, so it cannot lean on `sm:` and
 * `lg:`. The public page passes `responsive` and gets the breakpoints.
 *
 * `interactive={false}` renders links as text. Inside a preview a link is a
 * way to leave the builder by accident, and a tab stop on every product card
 * between the form and the Continue button.
 */

export type ProfileLayout = "desktop" | "mobile" | "responsive"

const LAYOUT = {
  desktop: {
    header: "grid-cols-[auto_minmax(0,1fr)] gap-6",
    avatar: 88,
    name: "text-[32px]",
    actions: "col-span-2",
    grid: "grid-cols-2",
    about: "grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-8",
    pad: "px-7 py-8",
  },
  mobile: {
    header: "grid-cols-1 gap-5",
    avatar: 72,
    name: "text-[28px]",
    actions: "",
    grid: "grid-cols-1",
    about: "grid-cols-1 gap-6",
    pad: "px-5 py-7",
  },
  responsive: {
    header: "grid-cols-1 gap-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-8",
    avatar: 112,
    name: "text-[34px] sm:text-[48px]",
    actions: "sm:col-span-2",
    grid: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    about: "grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-14",
    pad: "px-5 py-10 sm:px-8 sm:py-14",
  },
} as const

type Heading = "h1" | "h2" | "h3"

export function PublicProfile({
  profile,
  layout,
  interactive = true,
  nameAs: Name = "h1",
  placeholders = false,
  emptyProductsMessage = "No products to show yet.",
  browse = DEFAULT_BROWSE,
}: {
  profile: ProfilePresentation
  layout: ProfileLayout
  interactive?: boolean
  /** h1 on the public page; h2 or h3 when the profile is a preview inside another page. */
  nameAs?: Heading
  /** Show gentle stand-ins for empty fields. For the builder, never the public page. */
  placeholders?: boolean
  emptyProductsMessage?: string
  /** The search, kind and sort the page opens on, read from the address by the public route. */
  browse?: BrowseState
}) {
  const shape = LAYOUT[layout]
  const hasName = profile.displayName.length > 0
  // Section headings sit one level under the name, wherever the name sits.
  const Section: "h2" | "h3" | "h4" = Name === "h1" ? "h2" : Name === "h2" ? "h3" : "h4"
  const hasAbout =
    profile.about !== null ||
    profile.specialties.length > 0 ||
    profile.location !== null ||
    profile.links.length > 0
  const productCount = profile.products.length

  return (
    <article
      data-layout={layout}
      aria-label={hasName ? `${profile.displayName} public profile` : "Public profile"}
      className={`flex flex-col gap-12 bg-[var(--color-paper)] text-[var(--color-ink)] ${shape.pad}`}
    >
      {/* 1. Who ------------------------------------------------------------ */}
      <header className={`grid items-center ${shape.header}`}>
        <ProfileAvatar
          src={profile.avatarUrl}
          initials={profile.initials}
          size={shape.avatar}
          rounded="rounded-[16px]"
        />
        <div className="flex min-w-0 flex-col gap-2">
          <Name
            className={`font-display leading-[1.04] font-light tracking-[-0.035em] text-balance break-words ${shape.name} ${
              hasName ? "" : "text-[var(--color-ink-3)]"
            }`}
          >
            {hasName ? profile.displayName : placeholders ? "Your studio name" : null}
          </Name>
          {profile.location ? (
            <p
              data-location
              className="flex items-center gap-1.5 text-[14px] break-words text-[var(--color-ink-2)]"
            >
              <PinGlyph />
              {profile.location}
            </p>
          ) : null}
          {profile.shortBio ? (
            <p className="max-w-[60ch] text-[16px] leading-[1.5] break-words text-[var(--color-ink-2)]">
              {profile.shortBio}
            </p>
          ) : placeholders ? (
            <p className="text-[16px] text-[var(--color-ink-3)]">
              Your short introduction appears here.
            </p>
          ) : null}
        </div>

        {profile.links.length > 0 || profile.contact ? (
          <div
            className={`flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-[var(--color-rule)] pt-5 ${shape.actions}`}
          >
            {profile.contact ? (
              <ContactButton contact={profile.contact} interactive={interactive} />
            ) : null}
            {profile.links.length > 0 ? (
              <ul className="flex flex-wrap items-center gap-1" aria-label="Links">
                {profile.links.map((link) => (
                  <li key={link.url}>
                    <LinkIcon link={link} interactive={interactive} />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </header>

      {/* 2. The work ------------------------------------------------------- */}
      <section
        id="profile-products"
        aria-labelledby="profile-products-heading"
        className="flex flex-col gap-5"
      >
        <div className="flex items-baseline justify-between gap-4 border-b border-[var(--color-rule)] pb-3">
          <Section
            id="profile-products-heading"
            className="font-display text-[22px] font-light tracking-[-0.02em]"
          >
            Products
          </Section>
          {productCount > 0 ? (
            <span className="label-mono tabular">
              {productCount} {productCount === 1 ? "product" : "products"}
            </span>
          ) : null}
        </div>
        {productCount > 0 ? (
          <ProfileProductBrowser
            // Remounted when the address asks for a different view, so a
            // "Makes" link lands on its kind even from an already-open page.
            key={browseSearch(browse)}
            products={profile.products}
            initial={browse}
            gridClassName={shape.grid}
            interactive={interactive}
          />
        ) : (
          <p className="rounded-[14px] border border-dashed border-[var(--color-rule)] px-5 py-10 text-center text-[14px] text-[var(--color-ink-3)]">
            {emptyProductsMessage}
          </p>
        )}
      </section>

      {/* 3. About ----------------------------------------------------------- */}
      {hasAbout || (placeholders && hasName) ? (
        <section
          id="profile-about"
          aria-labelledby="profile-about-heading"
          className="flex flex-col gap-5"
        >
          <div className="border-b border-[var(--color-rule)] pb-3">
            <Section
              id="profile-about-heading"
              className="font-display text-[22px] font-light tracking-[-0.02em]"
            >
              About{hasName ? <span className="sr-only"> {profile.displayName}</span> : null}
            </Section>
          </div>
          <div className={`grid ${shape.about}`}>
            <div className="min-w-0">
              {profile.about ? (
                <p className="max-w-[65ch] text-[16px] leading-[1.65] whitespace-pre-line break-words text-[var(--color-ink)]">
                  {profile.about}
                </p>
              ) : placeholders ? (
                <p className="text-[15px] text-[var(--color-ink-3)]">
                  A longer About, if you add one, appears here.
                </p>
              ) : null}
            </div>

            <dl className="flex min-w-0 flex-col gap-5 text-[14px]">
              {profile.specialties.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <dt className="label-mono">Makes</dt>
                  <dd>
                    <ul className="flex flex-wrap gap-2" aria-label="Kinds of product">
                      {profile.specialties.map((specialty) => (
                        <li key={specialty.type}>
                          {interactive && profile.specialties.length > 1 ? (
                            <a
                              href={`${browseSearch({ ...DEFAULT_BROWSE, type: specialty.type })}#profile-products`}
                              className="inline-block rounded-[var(--radius-pill)] border border-[var(--color-rule)] px-3 py-1 text-[13px] text-[var(--color-ink-2)] hover:border-[var(--color-ink-3)] hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                            >
                              {specialty.label}
                            </a>
                          ) : (
                            <span className="inline-block rounded-[var(--radius-pill)] border border-[var(--color-rule)] px-3 py-1 text-[13px] text-[var(--color-ink-2)]">
                              {specialty.label}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              ) : null}
              {profile.location ? (
                <div className="flex flex-col gap-2">
                  <dt className="label-mono">Based in</dt>
                  <dd className="text-[var(--color-ink)]">{profile.location}</dd>
                </div>
              ) : null}
              {profile.links.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <dt className="label-mono">Elsewhere</dt>
                  <dd>
                    <ul className="flex flex-col gap-2">
                      {profile.links.map((link) => (
                        <li
                          key={link.url}
                          className="flex min-w-0 items-center gap-2.5 text-[var(--color-ink-2)]"
                        >
                          <span className="shrink-0 text-[var(--color-ink)]">
                            <LinkGlyph kind={link.kind} size={16} />
                          </span>
                          {interactive ? (
                            <a
                              href={link.url}
                              target="_blank"
                              rel="me noopener noreferrer nofollow"
                              className="min-w-0 break-all underline-offset-4 hover:text-[var(--color-ink)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                            >
                              {link.label}
                              <span className="sr-only"> (opens in a new tab)</span>
                            </a>
                          ) : (
                            <span className="min-w-0 break-all">{link.label}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
        </section>
      ) : null}
    </article>
  )
}

/**
 * The Contact button.
 *
 * An email address opens the visitor's mail app in place; a web page opens in
 * a new tab, with the same `rel` every outbound link on a public page carries.
 * The accessible name says which, because "Contact" alone does not tell a
 * screen-reader user whether they are about to leave the page. Inside a
 * preview it is inert, like every other link there.
 */
function ContactButton({
  contact,
  interactive,
}: {
  contact: { url: string; label: string }
  interactive: boolean
}) {
  const className =
    "inline-flex min-h-11 items-center justify-center rounded-[var(--radius-pill)] border border-[var(--color-action)] bg-[var(--color-action)] px-5 text-[14px] font-medium text-[var(--color-on-action)]"
  const email = contact.url.startsWith("mailto:")
  if (!interactive) {
    return (
      <span data-contact className={className}>
        Contact
      </span>
    )
  }
  return (
    <a
      href={contact.url}
      data-contact
      {...(email ? {} : { target: "_blank", rel: "noopener noreferrer nofollow" })}
      aria-label={
        email
          ? `Contact by email: ${contact.label}`
          : `Contact: ${contact.label} (opens in a new tab)`
      }
      className={`${className} hover:border-[var(--color-action-hover)] hover:bg-[var(--color-action-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]`}
    >
      Contact
    </a>
  )
}

function PinGlyph() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className="shrink-0"
    >
      <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  )
}

function LinkIcon({ link, interactive }: { link: ResolvedLink; interactive: boolean }) {
  const platform = kindName(link.kind)
  const name = link.label === platform ? platform : `${platform}: ${link.label}`
  if (!interactive) {
    return (
      <span
        role="img"
        aria-label={name}
        data-link={link.kind}
        className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--color-rule)]"
      >
        <LinkGlyph kind={link.kind} />
      </span>
    )
  }
  return (
    <a
      href={link.url}
      target="_blank"
      rel="me noopener noreferrer nofollow"
      aria-label={`${name} (opens in a new tab)`}
      data-link={link.kind}
      className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--color-rule)] text-[var(--color-ink)] hover:border-[var(--color-ink-3)] hover:bg-[var(--color-paper-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
    >
      <LinkGlyph kind={link.kind} />
    </a>
  )
}
