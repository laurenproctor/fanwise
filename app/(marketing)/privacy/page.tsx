import type { Metadata } from "next"
import Link from "next/link"
import { MarketingPage } from "@/components/marketing/page-shell"
import { marketingRoutes } from "@/lib/routes"

export const metadata: Metadata = {
  title: "Privacy Policy — Fanwise",
  description:
    "Fanwise collects what it needs to run your workspace and publish your listings, and nothing it doesn't.",
}

const NAV = [
  { label: "Product", href: marketingRoutes.landing },
  { label: "Marketplaces", href: marketingRoutes.marketplaces },
  { label: "Pricing", href: marketingRoutes.pricing },
  { label: "About", href: marketingRoutes.about },
]

const FOOTER = [
  { label: "Product", href: marketingRoutes.landing },
  { label: "Pricing", href: marketingRoutes.pricing },
  { label: "Terms", href: marketingRoutes.terms },
  { label: "Privacy", href: marketingRoutes.privacy },
]

export default function PrivacyPage() {
  return (
    <MarketingPage nav={{ links: NAV, signIn: false }} footer={FOOTER} reveal={false} legal>
      <header className="fw-legal__header">
        <span className="fw-eyebrow">Legal</span>
        <h1 className="fw-legal__h1">Privacy Policy</h1>
        <p className="fw-legal__date">Effective September 6, 2026</p>
        <p className="fw-legal__summary">
          Fanwise collects what it needs to run your workspace and publish your listings, and
          nothing it doesn&apos;t. We do not sell your data, and your catalog is never used for
          anything except your own channels.
        </p>
      </header>

      <main className="fw-legal__body">
        <section>
          <h2>1. What we collect</h2>
          <p>
            <b>Account data</b> — your name, email address and billing details. <b>Catalog data</b>{" "}
            — the product files, previews, descriptions and metadata you upload.{" "}
            <b>Connection data</b> — the authorization tokens for marketplaces you connect, plus the
            listing status and sales figures those marketplaces report back. <b>Usage data</b> —
            logs of how the service is used, for reliability and support.
          </p>
        </section>
        <section>
          <h2>2. How we use it</h2>
          <p>
            To operate the service: build derived listings, publish to the channels you choose, keep
            them in sync, reconcile sales into your ledger, bill your subscription, and answer
            support requests. We use aggregate, de-identified usage data to improve Fanwise.
          </p>
        </section>
        <section>
          <h2>3. What we don&apos;t do</h2>
          <p>
            We do not sell or rent your personal data or your catalog. We do not use your products
            to train generative models or to build competing products. We do not show ads. Your
            sales figures are visible only to your workspace.
          </p>
        </section>
        <section>
          <h2>4. Sharing</h2>
          <p>
            Your listing content is shared with the marketplaces you connect — that is the product.
            Beyond that, we share data only with the processors that run Fanwise (hosting, payments,
            email), each bound by contract to use it solely for us, and where the law requires it.
          </p>
        </section>
        <section>
          <h2>5. Storage and security</h2>
          <p>
            Data is encrypted in transit and at rest. Marketplace tokens are stored encrypted and
            scoped to the narrowest permissions each marketplace allows. Access inside Fanwise is
            limited to staff who need it to support you.
          </p>
        </section>
        <section>
          <h2>6. Retention and deletion</h2>
          <p>
            Your data stays as long as your workspace does. After cancellation your catalog remains
            exportable for 90 days, then is deleted along with connection tokens. You can request
            full deletion sooner at any time; billing records are kept as long as tax law requires.
          </p>
        </section>
        <section>
          <h2>7. Cookies and local storage</h2>
          <p>
            Fanwise uses a session cookie to keep you signed in and local storage for preferences
            such as the light/dark view. No third-party advertising or cross-site tracking cookies.
          </p>
        </section>
        <section>
          <h2>8. Your rights</h2>
          <p>
            You can access, correct, export or delete your personal data from your workspace or by
            writing to us. Depending on where you live (including the EEA, UK and California), you
            may have additional statutory rights; we honor them regardless of where you live.
          </p>
        </section>
        <section>
          <h2>9. Changes and contact</h2>
          <p>
            Material changes to this policy are emailed to workspace owners 30 days in advance.
            Questions: <a href="mailto:privacy@fanwise.app">privacy@fanwise.app</a>. See also the{" "}
            <Link href={marketingRoutes.terms}>Terms of Service</Link>.
          </p>
        </section>
      </main>
    </MarketingPage>
  )
}
