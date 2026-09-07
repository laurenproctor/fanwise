import type { ReactNode } from "react"
import "./marketing.css"
import { ScrollReveal } from "./scroll-reveal"
import { SiteFooter } from "./site-footer"
import { SiteNav, type NavLink } from "./site-nav"
import { ThemeScript } from "./theme-toggle"

/**
 * The light interior pages: Marketplaces, How It Works, Pricing, About, Terms,
 * Privacy. One 1080px column, nav at the top, footer at the bottom.
 *
 * `reveal` is off for the two legal pages, which is what the handoff does —
 * Terms and Privacy load the theme script and not the reveal script. Text
 * someone is reading for the terms of a contract should not be animating.
 */
export function MarketingPage({
  nav,
  footer,
  children,
  reveal = true,
  legal = false,
}: {
  nav: {
    links: NavLink[]
    signIn?: boolean
    cta?: { label: string; href: string } | null
  }
  footer: { label: string; href: string }[]
  children: ReactNode
  reveal?: boolean
  legal?: boolean
}) {
  return (
    <div className={legal ? "fw fw-page fw-legal" : "fw fw-page"}>
      <ThemeScript />
      {reveal ? <ScrollReveal /> : null}
      <div className="fw-wrap">
        <SiteNav {...nav} />
        {children}
        <SiteFooter links={footer} />
      </div>
    </div>
  )
}
