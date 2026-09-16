import Link from "next/link"
import { FanMark } from "./logo"
import { ThemeToggle } from "./theme-toggle"
import { NavMenu } from "./nav-menu"
import { marketingRoutes } from "@/lib/routes"

export type NavLink = { label: string; href: string }

/**
 * The public destinations, in the one order every page shows them.
 *
 * The handoff gave each page its own set, dropping its own entry and adding
 * in-page anchors. When Creators became a first-class destination (September
 * 2026) the founder chose one shared set instead, with the current page marked
 * rather than removed, so the header reads the same everywhere and a visitor
 * can always see where they are. "Marketplaces" still means the channels
 * Fanwise publishes to; the directory of Fanwise members is "Creators".
 */
export const PUBLIC_NAV = [
  { key: "product", label: "Product", href: marketingRoutes.landing },
  { key: "creators", label: "Creators", href: marketingRoutes.creators },
  { key: "marketplaces", label: "Marketplaces", href: marketingRoutes.marketplaces },
  { key: "how-it-works", label: "How it works", href: marketingRoutes.howItWorks },
  { key: "pricing", label: "Pricing", href: marketingRoutes.pricing },
  { key: "about", label: "About", href: marketingRoutes.about },
] as const

export type PublicNavKey = (typeof PUBLIC_NAV)[number]["key"]

/**
 * The marketing nav.
 *
 * Three surfaces, one component. `light` is the interior pages, `dark` is the
 * Get Started page, and `hero` is the landing, which trades the gap between
 * links for a hover pill behind each one and runs a smaller CTA.
 *
 * `current` marks the page the visitor is on, with `aria-current` and the
 * underline in marketing.css. Pages outside the set (Terms, Privacy, a 404)
 * pass nothing and no link is marked.
 *
 * Below 900px the links, Sign in and the CTA move into NavMenu's disclosure;
 * marketing.css swaps the two rows. Five links, a toggle, Sign in and a pill is
 * roughly 860px of bar, so the breakpoint is where the widest page runs out of
 * room rather than a device size.
 */
export function SiteNav({
  current,
  variant = "light",
  signIn = true,
  cta = { label: "Get started", href: marketingRoutes.signUp },
}: {
  current?: PublicNavKey
  variant?: "light" | "dark" | "hero"
  signIn?: boolean
  cta?: { label: string; href: string } | null
}) {
  const dark = variant !== "light"

  return (
    <nav
      className={
        variant === "hero" ? "fw-nav fw-nav--hero" : dark ? "fw-nav fw-nav--dark" : "fw-nav"
      }
    >
      <Link
        href={marketingRoutes.landing}
        className={dark ? "fw-brand fw-brand--dark" : "fw-brand"}
      >
        <FanMark size={variant === "light" ? 21 : 22} />
        Fanwise
      </Link>

      <div
        className={
          variant === "hero"
            ? "fw-nav__links fw-nav__links--pills"
            : dark
              ? "fw-nav__links fw-nav__links--dark"
              : "fw-nav__links"
        }
      >
        {PUBLIC_NAV.map((link) => (
          <Link
            key={link.key}
            href={link.href}
            aria-current={link.key === current ? "page" : undefined}
          >
            {link.label}
          </Link>
        ))}
      </div>

      <div className={variant === "hero" ? "fw-nav__end fw-nav__end--tight" : "fw-nav__end"}>
        <ThemeToggle variant={dark ? "dark" : "light"} />
        {signIn ? (
          <Link
            href={marketingRoutes.signIn}
            className={
              variant === "hero"
                ? "fw-nav__signin fw-nav__signin--dark fw-nav__signin--hero"
                : dark
                  ? "fw-nav__signin fw-nav__signin--dark"
                  : "fw-nav__signin"
            }
          >
            Sign in
          </Link>
        ) : null}
        {cta ? (
          <Link
            href={cta.href}
            className={
              variant === "hero" ? "fw-btn fw-btn--sm fw-btn--bright" : "fw-btn fw-btn--ink"
            }
          >
            {cta.label}
          </Link>
        ) : null}
      </div>

      <NavMenu links={PUBLIC_NAV} signIn={signIn} cta={cta} variant={variant} />
    </nav>
  )
}
