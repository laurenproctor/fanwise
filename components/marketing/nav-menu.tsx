"use client"

import { useId } from "react"
import Link from "next/link"
import { ThemeToggle } from "./theme-toggle"
import { useDisclosure } from "@/components/ui/use-disclosure"
import { marketingRoutes } from "@/lib/routes"
import type { NavLink } from "./site-nav"

/**
 * The marketing nav below 900px: a disclosure holding the links, Sign in and
 * the CTA, with the theme toggle left in the bar beside it.
 *
 * The desktop row and this share one link set and are both in the markup; the
 * media query in marketing.css decides which is shown. Duplicating the links
 * into a second list is deliberate — the alternative is measuring the bar in
 * the browser, which cannot run before the first paint and so flashes.
 *
 * Closing is useDisclosure's job, except for the per-link handler: an in-page
 * anchor such as #faq changes no route, so the panel would stay open over the
 * section it just scrolled to.
 */
export function NavMenu({
  links,
  signIn,
  cta,
  variant,
}: {
  links: NavLink[]
  signIn: boolean
  cta: { label: string; href: string } | null
  variant: "light" | "dark" | "hero"
}) {
  const { open, toggle, close, triggerRef, containerRef } = useDisclosure({ closeAbove: 900 })
  const panelId = useId()
  const dark = variant !== "light"

  return (
    <div className="fw-nav__mobile" ref={containerRef}>
      <ThemeToggle variant={dark ? "dark" : "light"} />

      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        className={dark ? "fw-nav__toggle fw-nav__toggle--dark" : "fw-nav__toggle"}
      >
        <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          aria-hidden="true"
        >
          {open ? (
            <>
              <path d="M4 4l10 10" />
              <path d="M14 4L4 14" />
            </>
          ) : (
            <>
              <path d="M2.5 5h13" />
              <path d="M2.5 9h13" />
              <path d="M2.5 13h13" />
            </>
          )}
        </svg>
      </button>

      <div
        id={panelId}
        hidden={!open}
        className={dark ? "fw-nav__panel fw-nav__panel--dark" : "fw-nav__panel"}
      >
        {links.map((link) => (
          <Link key={link.href} href={link.href} onClick={close} className="fw-nav__panel-link">
            {link.label}
          </Link>
        ))}

        {signIn || cta ? <span aria-hidden="true" className="fw-nav__panel-sep" /> : null}

        {signIn ? (
          <Link href={marketingRoutes.signIn} onClick={close} className="fw-nav__panel-link">
            Sign in
          </Link>
        ) : null}

        {cta ? (
          <Link
            href={cta.href}
            onClick={close}
            className={dark ? "fw-btn fw-btn--bright" : "fw-btn fw-btn--ink"}
          >
            {cta.label}
          </Link>
        ) : null}
      </div>
    </div>
  )
}
