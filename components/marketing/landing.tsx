import Link from "next/link"
import "./marketing.css"
import { HeroCanvas } from "./hero-canvas"
import { FanMark } from "./logo"
import { MarketplacePicker } from "./marketplace-picker"
import { ScrollReveal } from "./scroll-reveal"
import { FANWISE_DEFINITION } from "./site-footer"
import { SiteNav } from "./site-nav"
import { ThemeScript } from "./theme-toggle"
import { marketingRoutes } from "@/lib/routes"

const NAV = [
  { label: "Product", href: "#product" },
  { label: "Marketplaces", href: marketingRoutes.marketplaces },
  { label: "How it works", href: marketingRoutes.howItWorks },
  { label: "Pricing", href: marketingRoutes.pricing },
  { label: "About", href: marketingRoutes.about },
]

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

const RAIL = [
  ["Shopify", "Storefront"],
  ["Etsy", "Automatic"],
  ["Creative Market", "Assisted"],
  ["Gumroad", "Assisted"],
  ["Adobe Stock", "Assisted"],
  ["MyFonts", "Assisted"],
] as const

const TALLY = [
  ["Re-export previews for six image specs", "1h 40m"],
  ["Rewrite the description to six length limits", "55m"],
  ["Research and enter tags in six taxonomies", "1h 10m"],
  ["Map one license to six license menus", "35m"],
  ["Fill forms, upload, wait, fix rejections", "2h 20m"],
] as const

const HOW = [
  {
    num: "STEP 01",
    title: "Build the master listing",
    body: "Upload the files, one set of full-size previews, a description, a license and a price. This is the single source every shop derives from.",
  },
  {
    num: "STEP 02",
    title: "Pick the shops",
    body: "Toggle the marketplaces this product belongs on. Each gets its own draft: previews cropped to spec, copy trimmed to the limit, tags mapped to that shop's taxonomy.",
  },
  {
    num: "STEP 03",
    title: "Review and publish",
    body: "Check the drafts side by side, adjust anything a shop will care about, publish. Fanwise tracks approvals and flags the rejections that need a human.",
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
  "One owned storefront included",
  "Full preview, copy and tag mapping",
  "Status tracking and rejection fixes",
  "Add or drop a marketplace any month",
]

const STUDIO_FEATURES = [
  "For foundries and creative teams",
  "Multiple seats and client workspaces",
  "Multiple accounts per marketplace",
  "Bulk publishing and updates",
  "Advanced sync and analytics",
]

export function Landing() {
  return (
    <div className="fw fw-ground">
      <ThemeScript />
      <ScrollReveal />

      <div className="fw-shell">
        <header id="top" className="fw--dark fw-hero">
          <HeroCanvas />
          <div className="fw-hero__scrim" />
          <div className="fw-wrap--wide fw-hero__inner">
            <SiteNav links={NAV} variant="hero" />

            <div style={{ paddingTop: 56 }}>
              <span className="fw-chip">
                <i className="fw-chip__dot fw-pulse" /> Six marketplaces connected
              </span>
              <h1 className="fw-hero__title">
                Create once.
                <br />
                <b>Sell everywhere.</b>
              </h1>
            </div>

            <div className="fw-hero__foot">
              <p>
                One canonical product, translated into a listing for every shop that sells it —
                previews, copy, tags and license, each to that shop&apos;s rules.
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
              Fanwise holds one record of your product and hands every marketplace a listing{" "}
              <span>in the exact shape it demands.</span>
            </h2>
            <div className="fw-statement__side">
              <p>
                Fonts, templates, presets, icons, mockups, UI kits. If it ships as a file and sells
                as a listing, Fanwise fans it out.
              </p>
              <a href="#product" className="fw-arrow-link">
                Look inside the workspace <span aria-hidden="true">&rarr;</span>
              </a>
            </div>
          </div>

          <section id="product" className="fw-wrap--wide" style={{ paddingBottom: 96 }}>
            <div className="fw-slab-head fw-slab-head--tight">
              <div>
                <span className="fw-slab-eyebrow">The workspace</span>
                <h2>One master, six drafts</h2>
              </div>
              <p>
                The master listing on the left is the only thing you write. Each shop&apos;s derived
                draft carries its own preview crop, copy length, tags and live status.
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
                    <div>Marketplace</div>
                    <div>Derived draft</div>
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
                      <div>
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
                    <div>
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
                  6 drafts &middot; 3 live &middot; 2 pending &middot; <b>1 needs attention</b>
                </div>
                <div>Next sync in 4m</div>
              </div>
            </div>

            <div className="fw-mock__caption">
              <p className="fw-footnote">
                Interface shown with a sample workspace; the product, figures and statuses are
                illustrative. A rejection comes back with the shop&apos;s reason and a suggested
                fix; accepting it rebuilds and resubmits that one draft.
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
                <span className="fw-slab-eyebrow">The arithmetic</span>
                <h2>
                  Making it takes a week.
                  <br />
                  Listing it used to take another.
                </h2>
              </div>
              <p>
                Every shop wants the same product in a slightly different shape. Six times over, by
                hand, for every release.
              </p>
            </div>
            <div className="fw-arith">
              <div
                aria-label="Illustrative time spent listing one font family by hand"
                className="fw-tally"
              >
                {TALLY.map(([task, time]) => (
                  <div key={task} className="fw-tally__row">
                    <span>{task}</span>
                    <span className="fw-tally__time">{time}</span>
                  </div>
                ))}
                <div className="fw-tally__row fw-tally__row--total">
                  <span>One font family, listed by hand</span>
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
                  Illustrative timings for one font family across six shops, not a measured
                  benchmark. The minutes on Fanwise are review and approval: Fanwise builds the
                  drafts, a person signs them off.
                </p>
              </div>
            </div>
          </section>

          <section id="work" className="fw-wrap--wide" style={{ padding: "0 0 92px" }}>
            <div className="fw-slab-head">
              <div>
                <span className="fw-slab-eyebrow">Three steps</span>
                <h2>How it works</h2>
              </div>
              <p>
                The first step is the only one that takes real time, and it happens once per
                product.
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
                <h2>The spec sheet</h2>
              </div>
              <p>
                This is the work. Six sets of rules, none of them in agreement. Fanwise keeps them
                so you never have to.
              </p>
            </div>
            <div className="fw-table-scroll fw-table--slab">
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
              Spec values are illustrative. Rules are maintained per marketplace and versioned; when
              a shop changes a requirement, affected drafts rebuild and you get a note saying which
              listings moved.
            </p>
          </section>
        </div>

        <section id="pricing" className="fw--dark fw-band fw-band--pricing">
          <div className="fw-orb fw-orb--pricing" />
          <div className="fw-wrap--wide fw-band__inner">
            <div className="fw-band-head">
              <div>
                <span className="fw-band-eyebrow">Pricing</span>
                <h2>One price, plus the shops</h2>
              </div>
              <p>
                $9 a month, then $6 for each marketplace you connect. One owned storefront is
                included, the catalog is unlimited, and Fanwise never takes a percentage of sales.
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
                <b>Leave with six listings.</b>
              </h2>
              <p className="fw-band--start__lede">
                Connect a shop, upload a product, and watch the drafts build. $9 a month, plus $6
                for each marketplace connected.
              </p>
              <div className="fw-assurances">
                <span>
                  <i /> Six shops connected
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
              <p>An email and a password is all it takes. Connect your first shop from inside.</p>
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
