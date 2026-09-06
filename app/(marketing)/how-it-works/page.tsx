import type { Metadata } from "next"
import { CtaPanel } from "@/components/marketing/cta-panel"
import { MarketingPage } from "@/components/marketing/page-shell"
import { marketingRoutes } from "@/lib/routes"

export const metadata: Metadata = {
  title: "How Fanwise works",
  description:
    "From your canonical product, through a channel adapter, to a listing. One master listing in, six correct listings out.",
}

const NAV = [
  { label: "Product", href: marketingRoutes.landing },
  { label: "Marketplaces", href: marketingRoutes.marketplaces },
  { label: "Pricing", href: marketingRoutes.pricing },
  { label: "About", href: marketingRoutes.about },
]

const FOOTER = [
  { label: "Product", href: marketingRoutes.landing },
  { label: "Marketplaces", href: marketingRoutes.marketplaces },
  { label: "Pricing", href: marketingRoutes.pricing },
  { label: "About", href: marketingRoutes.about },
  { label: "Terms", href: marketingRoutes.terms },
  { label: "Privacy", href: marketingRoutes.privacy },
]

/**
 * A panel row's value carries its own emphasis: plain facts are ink, and a
 * review state is mono and colored. `wait` uses a darker amber than the dark
 * surface does, because #F5B944 on paper is not readable.
 */
type Tone = "fact" | "live" | "wait"

const VALUE_CLASS: Record<Tone, string> = {
  fact: "fw-spec-panel__value",
  live: "fw-spec-panel__value fw-spec-panel__value--live",
  wait: "fw-spec-panel__value fw-spec-panel__value--wait",
}

const STEPS: {
  num: string
  title: string
  body: string
  note: string
  panelHead: string
  rows: { k: string; v: string; tone: Tone }[]
}[] = [
  {
    num: "01",
    title: "Build the master listing",
    body: "Upload the product files, one set of full-size previews, a description, a license and a price. This is the canonical record — the only version of the product you ever write.",
    note: "This happens once per product. Everything after it is derived, so there is nothing to keep in sync by hand.",
    panelHead: "Master · Aster Grotesk",
    rows: [
      { k: "Files", v: "4 · 68 MB", tone: "fact" },
      { k: "Previews", v: "9 at full size", tone: "fact" },
      { k: "Description", v: "One, unabridged", tone: "fact" },
      { k: "License", v: "Desktop + Web", tone: "fact" },
      { k: "Price", v: "$48.00", tone: "fact" },
    ],
  },
  {
    num: "02",
    title: "Pick the shops",
    body: "Toggle the marketplaces this product belongs on. Each one gets its own derived draft: previews cropped to that shop's spec, copy trimmed to its limits, tags mapped onto its taxonomy, your license matched to its menu.",
    note: "Drafts are built by the channel adapters — one per marketplace, each fluent in that shop's rulebook.",
    panelHead: "Derived drafts",
    rows: [
      { k: "Etsy", v: "4:3 crop · 13 tags · plain text", tone: "fact" },
      { k: "Creative Market", v: "1160 × 772 · markdown", tone: "fact" },
      { k: "Envato", v: "50 char title · HTML subset", tone: "fact" },
      { k: "Gumroad", v: "1280 × 720 cover · rich text", tone: "fact" },
      { k: "Adobe Stock", v: "49 keywords", tone: "fact" },
      { k: "MyFonts", v: "2:1 specimens", tone: "fact" },
    ],
  },
  {
    num: "03",
    title: "Review and publish",
    body: "Check the drafts side by side, adjust anything a shop will care about, and publish. Fanwise submits each draft, tracks approvals and moderation queues, and flags the rejections that need a human.",
    note: "Nothing goes out unseen — Fanwise builds the drafts, a person signs them off.",
    panelHead: "Status",
    rows: [
      { k: "Etsy", v: "Live", tone: "live" },
      { k: "Creative Market", v: "Live", tone: "live" },
      { k: "Envato", v: "In review", tone: "wait" },
      { k: "Gumroad", v: "Live", tone: "live" },
      { k: "Adobe Stock", v: "In moderation", tone: "wait" },
      { k: "MyFonts", v: "Foundry review", tone: "wait" },
    ],
  },
]

const AFTER = [
  {
    title: "Edits fan out too",
    body: "Change the price, a preview or the description on the master, and every derived listing updates on its own schedule.",
  },
  {
    title: "Rejections come with fixes",
    body: "When a shop bounces a draft, Fanwise shows the shop's reason and a suggested fix. Accepting it rebuilds and resubmits that one draft.",
  },
  {
    title: "Rules stay current",
    body: "Marketplace specs are versioned. When a shop changes a rule, affected drafts rebuild and you get a note saying which listings moved.",
  },
  {
    title: "Sales flow back",
    body: "Revenue from every channel lands in one ledger, so you can see which shops earn their $6.",
  },
]

export default function HowItWorksPage() {
  return (
    <MarketingPage nav={{ links: NAV }} footer={FOOTER}>
      <header className="fw-page__header fw-page__header--tight">
        <span className="fw-eyebrow">How it works</span>
        <h1 className="fw-h1">One master listing in. Six correct listings out.</h1>
        <p className="fw-lede">
          Everything in Fanwise flows in one direction: from your canonical product, through a
          channel adapter, to a listing. Here is the whole path.
        </p>
      </header>

      <section style={{ padding: "76px 0 0" }}>
        {STEPS.map((step) => (
          <article key={step.num} className="fw-step">
            <div className="fw-step__text">
              <div className="fw-step__num">STEP {step.num}</div>
              <h2 className="fw-step__title">{step.title}</h2>
              <p className="fw-step__body">{step.body}</p>
              <p className="fw-note">{step.note}</p>
            </div>
            <div className="fw-spec-panel">
              <div className="fw-spec-panel__head">{step.panelHead}</div>
              <div style={{ display: "grid" }}>
                {step.rows.map((row) => (
                  <div key={row.k} className="fw-spec-panel__row">
                    <span>{row.k}</span>
                    <span className={VALUE_CLASS[row.tone]}>{row.v}</span>
                  </div>
                ))}
              </div>
            </div>
          </article>
        ))}
      </section>

      <section style={{ padding: "48px 0 92px" }}>
        <div className="fw-intro">
          <span className="fw-eyebrow fw-eyebrow--tight">After publish</span>
          <h2 className="fw-h2">Publishing is a moment. Keeping listings right is the job.</h2>
        </div>
        <div className="fw-cards">
          {AFTER.map((item) => (
            <div key={item.title} className="fw-card">
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <CtaPanel
        title="Try it with one product."
        body="Upload it once, pick your shops, and review the drafts side by side."
        action={{ label: "Get started", href: marketingRoutes.signUp }}
      />
    </MarketingPage>
  )
}
