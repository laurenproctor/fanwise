import Link from "next/link"
import { FanMark } from "./logo"
import { ThemeToggle } from "./theme-toggle"
import { NavMenu } from "./nav-menu"
import { marketingRoutes } from "@/lib/routes"

export type NavLink = { label: string; href: string }

/**
 * The marketing nav.
 *
 * Three surfaces, one component. `light` is the interior pages, `dark` is the
 * Get Started page, and `hero` is the landing, which trades the gap between
 * links for a hover pill behind each one and runs a smaller CTA.
 *
 * The link set differs per page in the handoff — each page drops its own entry
 * and some add an in-page anchor — so it is passed in rather than derived. That
 * is the design, not an oversight to normalize away.
 *
 * Below 900px the links, Sign in and the CTA move into NavMenu's disclosure;
 * marketing.css swaps the two rows. Five links, a toggle, Sign in and a pill is
 * roughly 860px of bar, so the breakpoint is where the widest page runs out of
 * room rather than a device size.
 */
export function SiteNav({
  links,
  variant = "light",
  signIn = true,
  cta = { label: "Get started", href: marketingRoutes.signUp },
}: {
  links: NavLink[]
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
        {links.map((link) => (
          <Link key={link.href} href={link.href}>
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

      <NavMenu links={links} signIn={signIn} cta={cta} variant={variant} />
    </nav>
  )
}
