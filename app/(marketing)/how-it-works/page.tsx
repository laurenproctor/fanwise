import type { Metadata } from "next"
import { CtaPanel } from "@/components/marketing/cta-panel"
import { MarketingPage } from "@/components/marketing/page-shell"
import { marketingRoutes } from "@/lib/routes"

export const metadata: Metadata = {
  title: "How Fanwise works",
  description:
    "One master listing for a typeface, a physical product, or a Mac app. Fanwise sells it from your storefront and publishes six correct listings to other shops.",
}

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
    body: "Add a typeface, a physical product, or a Mac app: the files or the item details, full-size previews, a description, and a price. This is the only version of the product you ever write.",
    note: "You do this once per product. Fanwise builds everything after it, so you have nothing to keep in sync by hand.",
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
    title: "Open your storefront",
    body: "Turn on checkout and your product page starts selling. Buyers pay you. Fanwise delivers the files, or hands you the order to ship.",
    note: "Your storefront comes with the $9 base. You can sell from it before you connect another shop.",
    panelHead: "Storefront",
    rows: [
      { k: "Address", v: "fanwise.com/@you", tone: "fact" },
      { k: "Product page", v: "From the master", tone: "fact" },
      { k: "Checkout", v: "On", tone: "live" },
      { k: "Delivery", v: "Download or shipped", tone: "fact" },
    ],
  },
  {
    num: "03",
    title: "Pick the shops",
    body: "Choose the marketplaces this product belongs on. You get a finished draft for each one: previews cropped to that shop's spec, copy trimmed to its limits, tags mapped to its categories, and your license matched to its menu.",
    note: "Fanwise knows each shop's rulebook, so you don't have to.",
    panelHead: "Drafts for each shop",
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
    num: "04",
    title: "Review and publish",
    body: "Check the drafts side by side, adjust anything a shop will care about, and publish. Fanwise submits each draft, tracks approvals and moderation queues, and flags the rejections that need you.",
    note: "Nothing goes out unseen. Fanwise builds the drafts and you sign them off.",
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

/** What the master listing holds for each product type the site opens with. */
const TYPES = [
  {
    title: "Typefaces",
    body: "Enter the family once. Fanwise reads the styles and language coverage from the font files and builds the specimens.",
  },
  {
    title: "Physical products",
    body: "Enter the variants, the stock for each one, the weight and size, and the shipping rules. Every order tells you what to ship.",
  },
  {
    title: "Mac apps",
    body: "Upload the build with its version, release notes, macOS requirement, and screenshots. Buyers get the download when they pay.",
  },
]

const AFTER = [
  {
    title: "Edits fan out too",
    body: "Change the price, a preview, or the description once, and every listing updates on its own schedule.",
  },
  {
    title: "Rejections come with fixes",
    body: "When a shop rejects a draft, Fanwise shows the shop's reason and a suggested fix. Accept it and that one draft rebuilds and resubmits.",
  },
  {
    title: "Rules stay current",
    body: "Fanwise tracks each marketplace's rules. When a shop changes one, the affected drafts rebuild and you get a note saying which listings moved.",
  },
  {
    title: "Sales flow back",
    body: "Revenue from every channel lands in one ledger, so you can see which shops earn their $6.",
  },
]

export default function HowItWorksPage() {
  return (
    <MarketingPage nav={{ current: "how-it-works" }} footer={FOOTER}>
      <header className="fw-page__header fw-page__header--tight">
        <span className="fw-eyebrow">How it works</span>
        <h1 className="fw-h1">One master listing in. A storefront and six listings out.</h1>
        <p className="fw-lede">
          Write a product up once. Fanwise sells it from your storefront and builds the listing for
          every shop. Here is the whole path.
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
        <p className="fw-footnote fw-footnote--page" style={{ paddingTop: 28 }}>
          The panels show a sample workspace. The product, its figures and the spec values are
          illustrative.
        </p>
      </section>

      <section style={{ padding: "48px 0 0" }}>
        <div className="fw-intro">
          <span className="fw-eyebrow fw-eyebrow--tight">Product types</span>
          <h2 className="fw-h2">One path for every product type.</h2>
          <p className="fw-intro__body">
            The steps are the same for all three. Only the details you enter change.
          </p>
        </div>
        <div className="fw-cards">
          {TYPES.map((item) => (
            <div key={item.title} className="fw-card">
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </div>
          ))}
        </div>
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
        body="Add it once, open your storefront, and review the drafts side by side."
        action={{ label: "Get started", href: marketingRoutes.signUp }}
      />
    </MarketingPage>
  )
}
