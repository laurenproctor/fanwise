import type { Metadata } from "next"
import Link from "next/link"
import { MarketingPage } from "@/components/marketing/page-shell"
import { marketingRoutes } from "@/lib/routes"

export const metadata: Metadata = {
  title: "Terms of Service — Fanwise",
  description:
    "You own your products, Fanwise publishes them where you tell it to, you pay a flat subscription, and you can export everything and leave whenever you like.",
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

export default function TermsPage() {
  return (
    <MarketingPage nav={{ links: NAV, signIn: false }} footer={FOOTER} reveal={false} legal>
      <header className="fw-legal__header">
        <span className="fw-eyebrow">Legal</span>
        <h1 className="fw-legal__h1">Terms of Service</h1>
        <p className="fw-legal__date">Effective September 6, 2026</p>
        <p className="fw-legal__summary">
          The short version: you own your products, Fanwise publishes them where you tell it to, you
          pay a flat subscription, and you can export everything and leave whenever you like. The
          longer version follows.
        </p>
      </header>

      <main className="fw-legal__body">
        <section>
          <h2>1. The agreement</h2>
          <p>
            These terms are a contract between you and Fanwise covering your use of the Fanwise
            service — the workspace, the publishing tools, and everything reachable from your
            account. By creating a workspace you accept them. If you use Fanwise for a company or
            studio, you accept them on its behalf.
          </p>
        </section>
        <section>
          <h2>2. The service</h2>
          <p>
            Fanwise holds a canonical record of each of your digital products and derives
            marketplace-specific listings from it — previews, copy, tags, pricing and license
            mappings — then publishes and maintains those listings on the channels you connect. We
            may change or improve features over time; we will not remove your ability to export your
            catalog.
          </p>
        </section>
        <section>
          <h2>3. Your account</h2>
          <p>
            You need accurate account details and a secure password. You are responsible for
            activity in your workspace. One person per account on the standard plan; seats for teams
            are part of Studio.
          </p>
        </section>
        <section>
          <h2>4. Your content and ownership</h2>
          <p>
            Everything you upload — product files, previews, descriptions, metadata — remains yours.
            You grant Fanwise a limited license to store, process, transform and transmit that
            content solely to operate the service: generating derived listings, submitting them to
            the marketplaces you choose, and keeping them in sync. We do not sell your content,
            claim rights in it, or use it to build products that compete with yours.
          </p>
        </section>
        <section>
          <h2>5. Marketplace connections</h2>
          <p>
            Each marketplace you connect has its own terms, review process and fees, and those
            remain between you and that marketplace. Fanwise prepares listings to each shop&apos;s
            published requirements, but the shop decides what it accepts. We are not responsible for
            a marketplace&apos;s rejections, suspensions, fee changes or outages, and connecting a
            channel through Fanwise does not exempt you from its rules.
          </p>
        </section>
        <section>
          <h2>6. Billing</h2>
          <p>
            Fanwise is $9 a month plus $6 a month for each connected external marketplace, billed in
            advance on a monthly or annual cycle. Each connected seller account bills separately.
            Disconnecting a marketplace ends its charge at the close of the current billing period;
            connections bill for a minimum of one full period, and we do not prorate mid-cycle.
            Fanwise never takes a percentage of your sales. Prices may change with at least 30
            days&apos; notice, effective from your next cycle.
          </p>
        </section>
        <section>
          <h2>7. Acceptable use</h2>
          <p>
            Sell only work you have the rights to sell. Do not use Fanwise to distribute malware,
            infringe intellectual property, evade a marketplace ban, or interfere with the service
            or other workspaces. We may suspend workspaces that do.
          </p>
        </section>
        <section>
          <h2>8. Cancellation and export</h2>
          <p>
            You can cancel at any time from your workspace; service continues to the end of the paid
            period. You can export your full catalog — files, listings, metadata and history — at
            any time, including after cancellation for 90 days. Fanwise holds your products, not
            your business.
          </p>
        </section>
        <section>
          <h2>9. Disclaimers and liability</h2>
          <p>
            Fanwise is provided as-is. We work to keep listings correct and channels in sync, but we
            do not guarantee uninterrupted service, marketplace acceptance, or sales outcomes. To
            the extent the law allows, our total liability for any claim is limited to the amount
            you paid Fanwise in the twelve months before the claim arose, and neither of us is
            liable for indirect or consequential damages.
          </p>
        </section>
        <section>
          <h2>10. Changes to these terms</h2>
          <p>
            If we make material changes we will email the workspace owner at least 30 days before
            they take effect. Continuing to use Fanwise after that date accepts the new terms; if
            you disagree, cancel and export before it.
          </p>
        </section>
        <section>
          <h2>11. Contact</h2>
          <p>
            Questions about these terms: <a href="mailto:legal@fanwise.app">legal@fanwise.app</a>.
            See also the <Link href={marketingRoutes.privacy}>Privacy Policy</Link>.
          </p>
        </section>
      </main>
    </MarketingPage>
  )
}
