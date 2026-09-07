import type { Metadata } from "next"
import Link from "next/link"
import "@/components/marketing/marketing.css"
import { CtaPanel } from "@/components/marketing/cta-panel"
import { PricingCalculator } from "@/components/marketing/pricing-calculator"
import { ScrollReveal } from "@/components/marketing/scroll-reveal"
import { SiteFooter } from "@/components/marketing/site-footer"
import { SiteNav } from "@/components/marketing/site-nav"
import { ThemeScript } from "@/components/marketing/theme-toggle"
import { marketingRoutes } from "@/lib/routes"

export const metadata: Metadata = {
  title: "Fanwise Pricing",
  description:
    "$9 a month, then $6 for each marketplace you connect. One owned storefront included, unlimited catalog, no percentage of sales.",
}

const NAV = [
  { label: "Product", href: marketingRoutes.landing },
  { label: "Marketplaces", href: marketingRoutes.marketplaces },
  { label: "How it works", href: marketingRoutes.howItWorks },
  { label: "FAQ", href: "#faq" },
  { label: "About", href: marketingRoutes.about },
]

const FOOTER = [
  { label: "Pricing", href: "#plan" },
  { label: "Channels", href: "#channels" },
  { label: "FAQ", href: "#faq" },
  { label: "About", href: marketingRoutes.about },
  { label: "Terms", href: marketingRoutes.terms },
  { label: "Privacy", href: marketingRoutes.privacy },
]

const MODEL = [
  {
    title: "Unlimited catalog",
    body: "Put your entire library into Fanwise without watching a product cap.",
  },
  {
    title: "No revenue share",
    body: "A $20 template and a $20,000 license cost the same to publish.",
  },
  {
    title: "Channels when you need them",
    body: "Expand distribution without upgrading to an arbitrary plan tier.",
  },
]

const FAQ = [
  {
    q: "Do I pay per product?",
    a: "No. Fanwise is built to hold your entire digital-product catalog, and the subscription does not increase as it grows.",
  },
  {
    q: "What counts as a marketplace?",
    a: "An external sales destination connected to Fanwise — Etsy, Creative Market, Envato, Gumroad, Adobe Stock or MyFonts.",
  },
  {
    q: "Does my own store count as a marketplace?",
    a: "One owned storefront is included with Fanwise. External marketplaces are $6 each.",
  },
  {
    q: "What if I stop selling on a marketplace?",
    a: "Disconnect it and the $6 charge ends with the current billing period. There is no mid-cycle refund, and a connection bills for a minimum of one full period.",
  },
  {
    q: "Does Fanwise take a percentage of my sales?",
    a: "No. Fanwise charges a subscription and never a share of revenue.",
  },
  {
    q: "Is the catalog really unlimited?",
    a: "Yes, subject to fair-use storage limits. Fanwise is meant to be the source of truth for your whole catalog.",
  },
  {
    q: "Can I use multiple accounts on the same marketplace?",
    a: "Each connected seller account bills separately, because each needs its own publishing, sync and analytics connection. Studio supports several per marketplace.",
  },
  {
    q: "Can I cancel?",
    a: "Any time. You can also export your catalog and leave — Fanwise holds your products, not your business.",
  },
]

const EXTERNAL = ["Etsy", "Creative Market", "Envato Market", "Gumroad", "Adobe Stock", "MyFonts"]

/**
 * The pricing page does not use MarketingPage, because the equation band bleeds
 * to the full window width and the shared shell holds everything inside one
 * 1080px column.
 */
export default function PricingPage() {
  return (
    <div className="fw fw-page">
      <ThemeScript />
      <ScrollReveal />

      <div className="fw-wrap">
        <SiteNav links={NAV} cta={{ label: "Start free", href: marketingRoutes.signUp }} />
        <header id="top" style={{ padding: "68px 0 12px", maxWidth: 780 }}>
          <h1 className="fw-price-h1">Simple pricing for wherever you sell.</h1>
        </header>
        <div style={{ paddingTop: 0, paddingBottom: 12 }}>
          <p className="fw-price-lede">
            Fanwise is $9 a month, then $6 for each marketplace you connect. Your catalog can grow
            without your bill moving.
          </p>
          <div className="fw-price-actions">
            <Link href={marketingRoutes.signUp} className="fw-btn fw-btn--accent">
              Start free
            </Link>
            <a href="#calculator" className="fw-btn fw-btn--outline">
              See how pricing works
            </a>
          </div>
          <div className="fw-price-points">
            <span>
              <i /> No product limits
            </span>
            <span>
              <i /> No percentage of sales
            </span>
            <span>
              <i /> Drop a channel any month
            </span>
          </div>
        </div>
      </div>

      <PricingCalculator />

      <div className="fw-wrap">
        <section id="channels" style={{ padding: "0 0 92px" }}>
          <div className="fw-channels">
            <div>
              <span className="fw-eyebrow fw-eyebrow--tight">Owned versus rented</span>
              <h2 className="fw-h2">Your own store should be the center.</h2>
              <p style={{ color: "var(--fw-ink-2)", marginTop: 18, maxWidth: "44ch" }}>
                Fanwise helps you distribute widely without losing sight of the channel you own.
                Connect one direct storefront at no channel charge, then add external marketplaces
                for $6 each.
              </p>
              <div className="fw-channels__claim">
                <b>1 owned storefront included.</b>
                <span>Every external marketplace after that is $6 a month.</span>
              </div>
            </div>
            <div className="fw-channels__lists">
              <div>
                <h4>Direct storefront</h4>
                <div className="fw-channels__list">
                  <div className="fw-channels__row">
                    Shopify
                    <span className="fw-channels__state fw-channels__state--included">
                      Included
                    </span>
                  </div>
                  <div className="fw-channels__row">
                    More direct platforms
                    <span className="fw-channels__state fw-channels__state--planned">Planned</span>
                  </div>
                </div>
              </div>
              <div>
                <h4>External marketplaces</h4>
                <div className="fw-channels__list">
                  {EXTERNAL.map((name) => (
                    <div key={name} className="fw-channels__row">
                      {name}
                      <span className="fw-channels__state fw-channels__state--live">Live</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section style={{ padding: "0 0 92px" }}>
          <div className="fw-intro">
            <span className="fw-eyebrow fw-eyebrow--tight">The model</span>
            <h2 className="fw-h2">Pricing that grows with your operation, not your success.</h2>
            <p className="fw-intro__body">
              Fanwise does not charge more because you made more products or had a great month. You
              pay for the channels it operates.
            </p>
          </div>
          <div className="fw-cards">
            {MODEL.map((item) => (
              <div key={item.title} className="fw-card">
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section style={{ padding: "0 0 92px" }}>
          <div className="fw-studio">
            <div className="fw-studio__text">
              <h3>Running a larger catalog or team?</h3>
              <p>
                Fanwise Studio is for high-volume creators, foundries and creative teams that need
                bulk publishing, multiple users, and more automation.
              </p>
              <p className="fw-studio__list">
                Team members &middot; Multiple accounts per marketplace &middot; Bulk publishing
                &middot; Advanced sync &middot; Scheduled releases
              </p>
            </div>
            <div className="fw-studio__side">
              <span className="fw-studio__price">$59 a month</span>
              <Link href={marketingRoutes.signUp} className="fw-btn fw-btn--outline">
                Join the Studio waitlist
              </Link>
            </div>
          </div>
        </section>

        <section id="faq" style={{ padding: "0 0 92px" }}>
          <div className="fw-intro">
            <span className="fw-eyebrow fw-eyebrow--tight">Questions</span>
            <h2 className="fw-h2">The details.</h2>
          </div>
          <div className="fw-faq">
            {FAQ.map((item, index) => (
              <details key={item.q} open={index === 0}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <CtaPanel
          size="large"
          title="One catalog. Every channel."
          body="Create your product once. Fanwise prepares, publishes and manages it everywhere you sell."
          action={{ label: "Start free", href: marketingRoutes.signUp }}
          fine="$9 a month when you are ready. Add marketplaces for $6 each."
        />

        <SiteFooter links={FOOTER} />
      </div>
    </div>
  )
}
