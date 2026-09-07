import type { Metadata } from "next"
import { CtaPanel } from "@/components/marketing/cta-panel"
import { MarketingPage } from "@/components/marketing/page-shell"
import { marketingRoutes } from "@/lib/routes"

export const metadata: Metadata = {
  title: "About Fanwise",
  description:
    "The product record belongs to the person who made the product. Why Fanwise treats every marketplace as a destination, not an authority.",
}

const NAV = [
  { label: "Product", href: marketingRoutes.landing },
  { label: "Marketplaces", href: marketingRoutes.marketplaces },
  { label: "How it works", href: marketingRoutes.howItWorks },
  { label: "Pricing", href: marketingRoutes.pricing },
]

const FOOTER = [
  { label: "Product", href: marketingRoutes.landing },
  { label: "Pricing", href: marketingRoutes.pricing },
  { label: "Sign in", href: marketingRoutes.signIn },
  { label: "Terms", href: marketingRoutes.terms },
  { label: "Privacy", href: marketingRoutes.privacy },
]

/** Where publishing goes once it works. Four phases, in order. */
const PHASES = [
  {
    num: "01",
    title: "Make publishing easy",
    body: "One product becomes six correct listings in minutes instead of a day.",
  },
  {
    num: "02",
    title: "Hold the catalog",
    body: "Fanwise becomes the source of truth for everything you sell, everywhere it sells.",
  },
  {
    num: "03",
    title: "Bring the money back",
    body: "Sales and performance from every channel, reconciled in one ledger.",
  },
  {
    num: "04",
    title: "Help decisions",
    body: "What to make next, where to sell it, and what to charge — grounded in your own numbers.",
  },
]

/**
 * The three sentences that constrain the architecture. They are the same three
 * invariants CLAUDE.md states, said to a reader rather than to a developer.
 */
const NOTS = [
  "A form-filling bot. Fanwise understands each shop's rules; it does not paste into their forms and hope.",
  "Organized around any one marketplace. Every shop is a peer destination, including the biggest one.",
  "A tool that treats marketplace records as the truth. The truth is yours; the listings are copies.",
]

export default function AboutPage() {
  return (
    <MarketingPage nav={{ links: NAV }} footer={FOOTER}>
      <header className="fw-page__header">
        <span className="fw-eyebrow">About</span>
        <h1 className="fw-h1">The product record belongs to the person who made the product.</h1>
        <p className="fw-lede">
          Designers who sell in six shops keep six copies of the truth — one per marketplace, each
          drifting from the others. Fanwise exists to put the record back in one place, owned by its
          maker, and to treat every marketplace as what it is: a destination.
        </p>
      </header>

      <section style={{ padding: "88px 0", maxWidth: 820 }}>
        <span className="fw-eyebrow fw-eyebrow--tight">The one rule</span>
        <div className="fw-about__rule-card">
          <span className="fw-about__term">Canonical product</span>
          <span aria-hidden="true" className="fw-about__arrow">
            &rarr;
          </span>
          <span className="fw-about__term">Channel adapter</span>
          <span aria-hidden="true" className="fw-about__arrow">
            &rarr;
          </span>
          <span className="fw-about__term fw-about__term--out">Listing</span>
        </div>
        <p className="fw-about__after">
          Never the reverse. Your product record is authoritative; each shop receives a translation
          of it. No marketplace&apos;s quirks leak back into your catalog, so every channel added
          makes the system more useful instead of the record messier.
        </p>
      </section>

      <section style={{ padding: "0 0 88px" }}>
        <span className="fw-eyebrow fw-eyebrow--tight">Where this goes</span>
        <h2 className="fw-h2" style={{ maxWidth: 640 }}>
          Publishing is the wedge, not the company.
        </h2>
        <div className="fw-cards fw-cards--roadmap">
          {PHASES.map((phase) => (
            <div key={phase.num} className="fw-card fw-card--rule">
              <div className="fw-card__num">{phase.num}</div>
              <h3>{phase.title}</h3>
              <p>{phase.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section style={{ padding: "0 0 88px", maxWidth: 820 }}>
        <span className="fw-eyebrow fw-eyebrow--tight">What Fanwise is not</span>
        <div className="fw-nots">
          {NOTS.map((not) => (
            <div key={not} className="fw-nots__row">
              <span className="fw-nots__label">Not</span>
              <p>{not}</p>
            </div>
          ))}
        </div>
        <p className="fw-about__after">
          If a decision would make any of those three sentences false, it is the wrong decision.
          That sentence is written into how Fanwise is built.
        </p>
      </section>

      <CtaPanel
        mark
        title="Create once. Sell everywhere."
        body="Bring one product and watch it fan out."
        action={{ label: "Get started", href: marketingRoutes.signUp }}
      />
    </MarketingPage>
  )
}
