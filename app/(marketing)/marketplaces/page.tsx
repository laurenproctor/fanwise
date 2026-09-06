import type { Metadata } from "next"
import { SHOPS } from "@/components/marketing/channels"
import { CtaPanel } from "@/components/marketing/cta-panel"
import { MarketingPage } from "@/components/marketing/page-shell"
import { marketingRoutes } from "@/lib/routes"

export const metadata: Metadata = {
  title: "Fanwise Marketplaces",
  description:
    "Six shops, six rulebooks. Connect the marketplaces you sell on for $6 each a month; your Shopify storefront is included.",
}

const NAV = [
  { label: "Product", href: marketingRoutes.landing },
  { label: "How it works", href: marketingRoutes.howItWorks },
  { label: "Spec sheet", href: "#specs" },
  { label: "Pricing", href: marketingRoutes.pricing },
  { label: "About", href: marketingRoutes.about },
]

const FOOTER = [
  { label: "Product", href: marketingRoutes.landing },
  { label: "How it works", href: marketingRoutes.howItWorks },
  { label: "Pricing", href: marketingRoutes.pricing },
  { label: "About", href: marketingRoutes.about },
  { label: "Terms", href: marketingRoutes.terms },
  { label: "Privacy", href: marketingRoutes.privacy },
]

const SPEC_COLUMNS = [
  "Marketplace",
  "Main preview",
  "Title limit",
  "Tags",
  "Description",
  "Review",
] as const

export default function MarketplacesPage() {
  return (
    <MarketingPage nav={{ links: NAV }} footer={FOOTER}>
      <header className="fw-page__header fw-page__header--tight">
        <span className="fw-eyebrow">Marketplaces</span>
        <h1 className="fw-h1">Six shops. Six rulebooks. One of yours.</h1>
        <p className="fw-lede">
          Every marketplace below is a first-class destination in Fanwise. Connect the ones you sell
          on for $6 each a month; your Shopify storefront is included.
        </p>
      </header>

      <section className="fw-shop-grid">
        {SHOPS.map((shop) => (
          <article key={shop.name} className="fw-shop">
            <div className="fw-shop__head">
              <h2>{shop.name}</h2>
              <span
                className={
                  shop.kind === "storefront"
                    ? "fw-badge fw-badge--storefront"
                    : "fw-badge fw-badge--marketplace"
                }
              >
                {shop.badge}
              </span>
            </div>
            <p className="fw-shop__blurb">{shop.blurb}</p>
            <dl className="fw-shop__specs">
              {(
                [
                  ["Preview", shop.preview],
                  ["Title", shop.title],
                  ["Tags", shop.tags],
                  ["Copy", shop.copy],
                  ["Review", shop.review],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="fw-shop__spec">
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <p className="fw-note fw-note--card">{shop.handles}</p>
          </article>
        ))}
      </section>

      <section id="specs" style={{ padding: "52px 0 92px" }}>
        <div className="fw-intro">
          <span className="fw-eyebrow fw-eyebrow--tight">Reference</span>
          <h2 className="fw-h2">The spec sheet, side by side.</h2>
          <p className="fw-intro__body">
            Rules are maintained per marketplace and versioned. When a shop changes a requirement,
            affected drafts rebuild and you get a note saying which listings moved.
          </p>
        </div>
        <p className="fw-footnote fw-footnote--page" style={{ margin: "-22px 0 26px" }}>
          Spec values on this page are illustrative. Each marketplace publishes its own requirements
          and Fanwise tracks them per channel.
        </p>
        <div className="fw-table-scroll">
          <table className="fw-table">
            <thead>
              <tr>
                {SPEC_COLUMNS.map((column) => (
                  <th key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SHOPS.map((shop) => (
                <tr key={shop.name}>
                  <td>{shop.name}</td>
                  <td>{shop.preview}</td>
                  <td>{shop.title}</td>
                  <td>{shop.tags}</td>
                  <td>{shop.copy}</td>
                  <td>{shop.review}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <CtaPanel
        title="Connect the shops you already sell on."
        body="$9 a month, plus $6 for each marketplace. Your storefront is included."
        action={{ label: "Get started", href: marketingRoutes.signUp }}
      />
    </MarketingPage>
  )
}
