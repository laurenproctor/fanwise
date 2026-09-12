import type { Metadata } from "next"
import Link from "next/link"
import { MissingRoute } from "@/components/marketing/missing-route"
import { MarketingPage } from "@/components/marketing/page-shell"
import { marketingRoutes } from "@/lib/routes"
import "@/components/marketing/not-found.css"

/**
 * The root not-found boundary.
 *
 * This is where a workspace guard lands. `notFound()` thrown from
 * app/[slug]/layout.tsx cannot be caught by a not-found file nested inside
 * that same layout, because the layout is what failed to render, so it bubbles
 * to here. It is also what Next renders for any URL no route matches.
 *
 * The wording is deliberately the same for a URL that never existed and a
 * workspace belonging to someone else. Distinguishing them would confirm that a
 * slug is real, which is exactly the probe this page has to defeat. Nothing on
 * the page reads the request, the session or the path, so it cannot say more
 * than that by accident.
 *
 * In the marketing shell rather than the workspace header: that header needs a
 * workspace, and this page is exactly where there is not one. The visitor may
 * be signed in or not, so every link is one that works for both.
 *
 *   - Go to dashboard is `/sign-in`, which sends a signed-in creator on to `/`
 *     and so to their catalog, and asks anyone else to sign in first.
 *   - Browse products is `/`. There is no public product directory; to a
 *     creator `/` resolves to their catalog, and to a visitor it is the
 *     landing page, which the nav already calls Product.
 *   - Return to Fanwise is `/`.
 */

export const metadata: Metadata = {
  title: "Page not found · Fanwise",
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

export default function NotFound() {
  return (
    <MarketingPage nav={{ links: NAV }} footer={FOOTER} reveal={false}>
      <main className="fw-nf">
        <div>
          <span className="fw-eyebrow">Not found</span>
          <h1 className="fw-h1 fw-nf__title">This listing didn’t make it to the marketplace.</h1>
          <p className="fw-nf__lede">The page may have moved, changed, or never gone live.</p>
          <div className="fw-nf__actions">
            <Link href={marketingRoutes.signIn} className="fw-btn fw-btn--ink">
              Go to dashboard
            </Link>
            <Link href={marketingRoutes.landing} className="fw-btn fw-btn--outline">
              Browse products
            </Link>
          </div>
          <Link href={marketingRoutes.landing} className="fw-nf__quiet">
            Return to Fanwise
          </Link>
        </div>
        <MissingRoute />
      </main>
    </MarketingPage>
  )
}
