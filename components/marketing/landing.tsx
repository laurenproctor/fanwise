import Link from "next/link"
import "./marketing.css"
import { HeroCanvas } from "./hero-canvas"
import { FanMark } from "./logo"
import { MarketplacePicker } from "./marketplace-picker"
import { ScrollReveal } from "./scroll-reveal"
import { FANWISE_DEFINITION } from "./site-footer"
import { SiteNav } from "./site-nav"
import { BUILD_LIST, RAIL } from "./channels"
import { ShopMark } from "./shop-mark"
import { marketingRoutes } from "@/lib/routes"

const FOOTER = [
  { label: "Product", href: "#product" },
  { label: "Marketplaces", href: marketingRoutes.marketplaces },
  { label: "How it works", href: marketingRoutes.howItWorks },
  { label: "Pricing", href: marketingRoutes.pricing },
  { label: "About", href: marketingRoutes.about },
  { label: "Sign in", href: marketingRoutes.signIn },
  { label: "Terms", href: marketingRoutes.terms },
  { label: "Privacy", href: marketingRoutes.privacy },
]

/**
 * The sample workspace. Placeholder, per design/README.md: "The Aster Grotesk
 * sample workspace" is one of the figures the mockups invent, and the caption
 * under the window says so on the page itself.
 */
const MASTER_FACTS = [
  ["Files", "4 · 68 MB"],
  ["Price", "$48.00"],
  ["License", "Desktop + Web"],
  ["Previews", "9 at full size"],
  ["Updated", "Today, 09:14"],
] as const

const MASTER_TAGS = ["grotesque", "sans serif", "variable", "editorial", "display"]

type Status = "live" | "pending" | "attention"

const STATUS_CLASS: Record<Status, string> = {
  live: "fw-status fw-status--live",
  pending: "fw-status fw-status--pending",
  attention: "fw-status fw-status--attention",
}

const DERIVED: {
  name: string
  spec: string
  status: Status
  label: string
  when: string
  /** The last row of a group: the rejection banner carries the rule instead. */
  last?: boolean
}[] = [
  {
    name: "Fanwise",
    spec: "Your storefront · checkout · delivery",
    status: "live",
    label: "Selling",
    when: "2m ago",
  },
  {
    name: "Etsy",
    spec: "2000 px 4:3 · 13 tags · 140 char title",
    status: "live",
    label: "Live",
    when: "2m ago",
  },
  {
    name: "Creative Market",
    spec: "1160 × 772 · category tree · markdown",
    status: "live",
    label: "Live",
    when: "2m ago",
  },
  {
    name: "Envato Market",
    spec: "590 px inline · 15 tags · 50 char title",
    status: "pending",
    label: "In review",
    when: "2m ago",
  },
  {
    name: "Gumroad",
    spec: "1280 × 720 cover · rich text",
    status: "live",
    label: "Live",
    when: "2m ago",
  },
  {
    name: "Adobe Stock",
    spec: "Rendered preview · 49 keywords",
    status: "attention",
    label: "Needs a fix",
    when: "1m ago",
    last: true,
  },
]

const TALLY = [
  ["Re-export previews for six image specs", "1h 40m"],
  ["Rewrite the description to six length limits", "55m"],
  ["Research and enter tags in six taxonomies", "1h 10m"],
  ["Map one license to six license menus", "35m"],
  ["Fill forms, upload, wait, fix rejections", "2h 20m"],
] as const

/**
 * What Fanwise sells today. Typefaces, physical products and Mac apps are the
 * product types the site opens with; the third card names the rest without
 * promising a date.
 */
const SELL = [
  {
    num: "AVAILABLE NOW",
    title: "Typefaces",
    body: "Upload the family once and skip the specimen grind. Fanwise reads every style, checks language coverage, and builds the specimens each shop asks for.",
  },
  {
    num: "AVAILABLE NOW",
    title: "Physical products",
    body: "Set your variants, stock, and shipping rules once. Fanwise takes the order and tells you what to ship.",
  },
  {
    num: "AVAILABLE NOW",
    title: "Mac apps",
    body: "Ship a new build without rewriting a listing. Upload it with its release notes. Fanwise takes the payment and delivers the download.",
  },
]

const HOW = [
  {
    num: "STEP 01",
    title: "Build the master listing",
    body: "Add the files or the item details, full-size previews, a description, and a price. You never write this product up again.",
  },
  {
    num: "STEP 02",
    title: "Open your storefront",
    body: "Turn on checkout and your product page starts selling. Buyers pay you. Fanwise delivers the files, or hands you the order to ship.",
  },
  {
    num: "STEP 03",
    title: "Publish everywhere",
    body: "Pick the other shops and get a finished draft for each: previews cropped to spec, copy trimmed to the limit, tags mapped to that shop's categories. Fanwise tracks approvals and flags the rejections that need you.",
  },
]

const SPEC_ROWS = [
  [
    "Etsy",
    "2000 px shortest side, 4:3",
    "140 chars",
    "13 max, 20 chars each",
    "Plain text, no HTML",
    "Instant",
  ],
  [
    "Creative Market",
    "1160 × 772 px",
    "60 chars",
    "Free-form plus category tree",
    "Markdown subset",
    "Shop approval, then instant",
  ],
  [
    "Envato Market",
    "590 px inline, 80 × 80 thumb",
    "50 chars",
    "15 max",
    "HTML subset",
    "Manual review, days",
  ],
  [
    "Gumroad",
    "1280 × 720 px cover",
    "No hard limit",
    "Discover categories",
    "Rich text",
    "Instant",
  ],
  [
    "Adobe Stock",
    "Rendered template preview",
    "200 chars",
    "Up to 49 keywords",
    "Keywords only",
    "Moderation queue",
  ],
  [
    "MyFonts",
    "5 to 15 PNG at 2:1",
    "Family name",
    "Foundry tags",
    "Under 500 words",
    "Foundry review, 24h",
  ],
] as const

const SPEC_COLUMNS = [
  "Marketplace",
  "Main preview",
  "Title limit",
  "Tags",
  "Description",
  "Review",
] as const

const PLAN_FEATURES = [
  "Unlimited products, no per-product charge",
  "Your own storefront, with checkout and delivery",
  "One Shopify or WooCommerce store included",
  "Previews, copy, and tags built for every shop",
  "Every listing status in one view, with fixes for rejections",
  "Add or drop a marketplace any month",
]

const STUDIO_FEATURES = [
  "For foundries, app studios, brands, and creative teams",
  "Multiple seats and client workspaces",
  "Multiple accounts per marketplace",
  "Bulk publishing and updates",
  "Advanced sync and analytics",
]

export function Landing() {
  return (
    <div className="fw fw-ground">
      <ScrollReveal />

      <div className="fw-shell">
        <header id="top" className="fw--dark fw-hero">
          <HeroCanvas />
          <div className="fw-hero__scrim" />
          <div className="fw-wrap--wide fw-hero__inner">
            <SiteNav current="product" variant="hero" />

            <div style={{ paddingTop: 56 }}>
              <span className="fw-chip">
                <i className="fw-chip__dot fw-pulse" /> Typefaces, physical products, Mac apps
              </span>
              <h1 className="fw-hero__title">
                Create once.
                <br />
                <b>Sell everywhere.</b>
              </h1>
            </div>

            <div className="fw-hero__foot">
              <p>
                Add a typeface, a physical product, or a Mac app once. Sell it from your own
                storefront and in every shop that carries it, without rebuilding a single listing.
              </p>
              <div className="fw-hero__buttons">
                <a href="#start" className="fw-btn fw-btn--sm fw-btn--bright">
                  Get started
                </a>
                <a href="#product" className="fw-btn fw-btn--sm fw-btn--ghost-dark">
                  See it working
                </a>
              </div>
            </div>
          </div>
        </header>

        <div className="fw-slab">
          <div className="fw-wrap--wide fw-statement">
            <h2>
              Write one listing. Fanwise sells it from your storefront and rebuilds it for every
              marketplace, <span>so you never fill in the same form twice.</span>
            </h2>
            <div className="fw-statement__side">
              <p>
                Start with typefaces, physical products, and Mac apps. Templates, images, icons, and
                presets follow.
              </p>
              <a href="#sell" className="fw-arrow-link">
                See what you can sell <span aria-hidden="true">&rarr;</span>
              </a>
            </div>
          </div>

          <section id="sell" className="fw-wrap--wide" style={{ paddingBottom: 92 }}>
            <div className="fw-slab-head">
              <div>
                <span className="fw-slab-eyebrow">What you can sell</span>
                <h2>Typefaces, physical products, and Mac apps</h2>
              </div>
              <p>
                Each product type gets a record that already knows what buyers and shops ask for.
                You fill it in once.
              </p>
            </div>
            <div className="fw-slab-cards">
              {SELL.map((item) => (
                <div key={item.title} className="fw-slab-card">
                  <div className="fw-slab-card__num">{item.num}</div>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </div>
              ))}
            </div>
          </section>

          <section id="product" className="fw-wrap--wide" style={{ paddingBottom: 96 }}>
            <div className="fw-slab-head fw-slab-head--tight">
              <div>
                <span className="fw-slab-eyebrow">The workspace</span>
                <h2>One listing, 7 places to buy</h2>
              </div>
              <p>
                The master listing on the left is the only thing you write. Your storefront sells it
                right away. Each shop gets its own draft with the right preview crop, copy length,
                and tags, and you see every status in one view.
              </p>
            </div>

            <div className="fw-mock">
              <div className="fw-mock__bar">
                <div className="fw-mock__crumbs">
                  Library <i>/</i> <b>Aster Grotesk</b> <i>/</i> Fan out
                </div>
                <div className="fw-mock__account">
                  <span aria-hidden="true" className="fw-mock__avatar">
                    LP
                  </span>{" "}
                  Proctor Type Co.
                </div>
              </div>

              <div className="fw-mock__body">
                <div className="fw-mock__master">
                  <div className="fw-specimen">
                    <span>Aa</span>
                    <small>ASTER GROTESK &middot; 14 STYLES</small>
                  </div>
                  <h3>Aster Grotesk</h3>
                  <div className="fw-mock__facts">
                    {MASTER_FACTS.map(([label, value]) => (
                      <div key={label} className="fw-mock__fact">
                        <span>{label}</span>
                        <b>{value}</b>
                      </div>
                    ))}
                  </div>
                  <div className="fw-mock__tags">
                    {MASTER_TAGS.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                </div>

                <div className="fw-mock__derived">
                  <div className="fw-derived-row fw-derived-row--head">
                    <div>Shop</div>
                    <div>Draft</div>
                    <div>Status</div>
                    <div style={{ textAlign: "right" }}>Updated</div>
                  </div>

                  {DERIVED.map((row) => (
                    <div
                      key={row.name}
                      className={
                        row.last ? "fw-derived-row fw-derived-row--last" : "fw-derived-row"
                      }
                    >
                      <div className="fw-derived-row__name">{row.name}</div>
                      <div className="fw-derived-row__spec">{row.spec}</div>
                      <div className="fw-derived-row__status">
                        <span className={STATUS_CLASS[row.status]}>
                          <i
                            className={
                              row.status === "live" ? "fw-status__dot fw-pulse" : "fw-status__dot"
                            }
                          />{" "}
                          {row.label}
                        </span>
                      </div>
                      <div className="fw-derived-row__when">{row.when}</div>
                    </div>
                  ))}

                  <div className="fw-rejection">
                    <div className="fw-rejection__inner">
                      <p>
                        <b>Title runs 214 characters, 14 over the limit.</b> Fanwise trimmed it to
                        198 and kept the family name in front.
                      </p>
                      <button type="button" className="fw-rejection__action">
                        Accept and resubmit
                      </button>
                    </div>
                  </div>

                  <div className="fw-derived-row fw-derived-row--last">
                    <div className="fw-derived-row__name">MyFonts</div>
                    <div className="fw-derived-row__spec">OTF and TTF · 8 specimens at 2:1</div>
                    <div className="fw-derived-row__status">
                      <span className="fw-status fw-status--pending">
                        <i className="fw-status__dot" /> Foundry review
                      </span>
                    </div>
                    <div className="fw-derived-row__when">1m ago</div>
                  </div>
                </div>
              </div>

              <div className="fw-mock__foot">
                <div>
                  Storefront selling &middot; 6 drafts &middot; 3 live &middot; 2 pending &middot;{" "}
                  <b>1 needs attention</b>
                </div>
                <div>Next sync in 4m</div>
              </div>
            </div>

            <div className="fw-mock__caption">
              <p className="fw-footnote">
                Interface shown with a sample typeface workspace. The product, figures, and statuses
                are illustrative. Physical products and Mac apps use the same layout. When a shop
                rejects a draft, Fanwise shows the reason and a suggested fix. Accept it and that
                one draft rebuilds and resubmits.
              </p>
              <a href="#start" className="fw-arrow-link">
                Fan out a product <span aria-hidden="true">&rarr;</span>
              </a>
            </div>
          </section>
        </div>

        <div id="shops" className="fw-rail">
          <div className="fw-wrap--wide fw-rail__grid">
            {RAIL.map(([name, mode]) => (
              <div key={name} className="fw-rail__cell">
                {/*
                  Above the name rather than beside it. The cells are 150px at
                  their narrowest, and "WooCommerce" at 18px display leaves no
                  room for a mark on the same line.
                */}
                <ShopMark name={name} className="fw-rail__mark" glyph={17} />
                <strong>{name}</strong>
                <span className="fw-rail__mode">
                  <i /> {mode}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="fw-slab-plain">
          <section id="cost" className="fw-wrap--wide" style={{ padding: "92px 0" }}>
            <div className="fw-slab-head">
              <div>
                <span className="fw-slab-eyebrow">The time you get back</span>
                <h2>
                  Making it takes a week.
                  <br />
                  Listing it used to take another.
                </h2>
              </div>
              <p>
                Every shop wants the same product in a slightly different shape. By hand, that is
                the same job 6 times for every release. On Fanwise, you review and approve.
              </p>
            </div>
            <div className="fw-arith">
              <div
                aria-label="Illustrative time spent listing one product by hand"
                className="fw-tally"
              >
                {TALLY.map(([task, time]) => (
                  <div key={task} className="fw-tally__row">
                    <span>{task}</span>
                    <span className="fw-tally__time">{time}</span>
                  </div>
                ))}
                <div className="fw-tally__row fw-tally__row--total">
                  <span>One product, listed by hand</span>
                  <span className="fw-tally__time">6h 40m</span>
                </div>
              </div>
              <div>
                <div className="fw-bars">
                  <div className="fw-bar">
                    <div className="fw-bar__head">
                      <span>By hand, six shops</span>
                      <b>6h 40m</b>
                    </div>
                    <div className="fw-bar__track">
                      <div className="fw-bar__fill" style={{ width: "100%" }} />
                    </div>
                  </div>
                  <div className="fw-bar">
                    <div className="fw-bar__head">
                      <span>On Fanwise</span>
                      <b>under 10m</b>
                    </div>
                    <div className="fw-bar__track">
                      <div
                        className="fw-bar__fill fw-bar__fill--fanwise"
                        style={{ width: "2.4%" }}
                      />
                    </div>
                  </div>
                </div>
                <p className="fw-footnote" style={{ marginTop: 18 }}>
                  Illustrative timings for one product across six shops, not a measured benchmark.
                  The minutes on Fanwise are review and approval: Fanwise builds the drafts and you
                  sign them off.
                </p>
              </div>
            </div>
          </section>

          <section id="work" className="fw-wrap--wide" style={{ padding: "0 0 92px" }}>
            <div className="fw-slab-head">
              <div>
                <span className="fw-slab-eyebrow">3 steps</span>
                <h2>How it works</h2>
              </div>
              <p>
                The first step takes real time. It happens once per product, and everything after it
                is review.
              </p>
            </div>
            <div className="fw-slab-cards">
              {HOW.map((step) => (
                <div key={step.num} className="fw-slab-card">
                  <div className="fw-slab-card__num">{step.num}</div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              ))}
            </div>
          </section>

          <section id="specs" className="fw-wrap--wide" style={{ padding: "0 0 92px" }}>
            <div className="fw-slab-head">
              <div>
                <span className="fw-slab-eyebrow">Reference</span>
                <h2>6 rulebooks you no longer keep</h2>
              </div>
              <p>
                This is the work Fanwise takes off your desk: 6 sets of rules, none of them in
                agreement, all kept current for you.
              </p>
            </div>
            <div
              className="fw-table-scroll fw-table--slab"
              role="region"
              aria-label="What each shop asks for"
              tabIndex={0}
            >
              <table className="fw-table fw-table--slab">
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
                  {SPEC_ROWS.map((row) => (
                    <tr key={row[0]}>
                      {row.map((cell, i) => (
                        <td key={i}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="fw-footnote" style={{ marginTop: 18 }}>
              Spec values are illustrative. Fanwise tracks the rules for each marketplace. When a
              shop changes a requirement, the affected drafts rebuild and you get a note saying
              which listings moved.
            </p>
            <p style={{ marginTop: 18 }}>
              <Link href={`${marketingRoutes.marketplaces}#build-list`} className="fw-arrow-link">
                {BUILD_LIST.length} more shops are on the build list, including eBay, Amazon,
                Walmart, TikTok Shop, itch.io and the Mac App Store{" "}
                <span aria-hidden="true">&rarr;</span>
              </Link>
            </p>
          </section>
        </div>

        <section id="pricing" className="fw--dark fw-band fw-band--pricing">
          <div className="fw-orb fw-orb--pricing" />
          <div className="fw-wrap--wide fw-band__inner">
            <div className="fw-band-head">
              <div>
                <span className="fw-band-eyebrow">Pricing</span>
                <h2>A flat price. Your sales stay yours.</h2>
              </div>
              <p>
                $9 a month covers your storefront and an unlimited catalog. Add $6 for each
                marketplace you connect. Fanwise never takes a percentage of sales.
              </p>
            </div>
            <div className="fw-tiers">
              <div className="fw-tier fw-tier--main">
                <h3>Fanwise</h3>
                <div className="fw-tier__figure">
                  $9<small>per month</small>
                </div>
                <p className="fw-tier__plus">
                  plus <b>$6</b> for each marketplace connected
                </p>
                <MarketplacePicker />
                <ul className="fw-tier__list">
                  {PLAN_FEATURES.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <a href="#start" className="fw-btn fw-btn--sm fw-btn--bright">
                  Get started
                </a>
              </div>
              <div className="fw-tier fw-tier--studio">
                <h3>Studio</h3>
                <div className="fw-tier__figure">
                  $59<small>per month</small>
                </div>
                <ul className="fw-tier__list">
                  {STUDIO_FEATURES.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <a href="#start" className="fw-btn fw-btn--sm fw-btn--ghost-dark">
                  Join the Studio waitlist
                </a>
              </div>
            </div>
            <p style={{ marginTop: 22, fontSize: 14 }}>
              <Link href={marketingRoutes.pricing} className="fw-arrow-link fw-arrow-link--dark">
                The full pricing page <span aria-hidden="true">&rarr;</span>
              </Link>
            </p>
          </div>
        </section>

        <section id="start" className="fw--dark fw-band fw-band--start">
          <div className="fw-orb fw-orb--start-c" />
          <div className="fw-orb fw-orb--start-d" />
          <div className="fw-wrap--wide fw-band__inner">
            <div>
              <span className="fw-band-eyebrow">Get started</span>
              <h2>
                Bring one product.
                <br />
                <b>Leave with a storefront.</b>
              </h2>
              <p className="fw-band--start__lede">
                Add one product and start selling from your own storefront. Connect the other shops
                when you&apos;re ready. $9 a month, plus $6 for each marketplace.
              </p>
              <div className="fw-assurances">
                <span>
                  <i /> Your own storefront
                </span>
                <span>
                  <i /> $9 plus $6 a marketplace
                </span>
                <span>
                  <i /> Export and leave anytime
                </span>
              </div>
            </div>
            {/*
              The handoff put a four-field form here — name, email, product
              category, first shop — that submitted to nothing. The real account
              form asks for an email and a password, so this hands over to it
              rather than collecting answers no field can carry.
            */}
            <div className="fw-signup-card">
              <h3>Create a workspace</h3>
              <p>All it takes is an email and a password. Add your first product from inside.</p>
              <Link href={marketingRoutes.signUp} className="fw-btn fw-btn--bright">
                Get started
              </Link>
            </div>
          </div>
        </section>

        <footer className="fw--dark fw-site-footer">
          <div className="fw-wrap--wide fw-site-footer__inner">
            <div className="fw-site-footer__brand">
              <a href="#top" className="fw-brand fw-brand--dark">
                <FanMark size={22} />
                Fanwise
              </a>
              <span className="fw-systems">
                <i className="fw-pulse" /> All systems operational
              </span>
            </div>
            <div className="fw-site-footer__links">
              {FOOTER.map((link) =>
                link.href.startsWith("#") ? (
                  <a key={link.href} href={link.href}>
                    {link.label}
                  </a>
                ) : (
                  <Link key={link.href} href={link.href}>
                    {link.label}
                  </Link>
                ),
              )}
            </div>
            <p className="fw-dict--dark">{FANWISE_DEFINITION}</p>
          </div>
        </footer>
      </div>
    </div>
  )
}
