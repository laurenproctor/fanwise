import Link from "next/link"
import { FanMark } from "@/components/marketing/logo"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { ButtonLink } from "@/components/ui/button"
import { marketingRoutes } from "@/lib/routes"

/**
 * The frame every public creator page hangs in.
 *
 * Not `MarketingPage`, deliberately. That shell pulls in `marketing.css`,
 * which carries its own 1080px column, its own nav markup and a set of
 * `fw-` classes tuned for the marketing site's rhythm. A creator's portfolio
 * is a wider, quieter, image-led surface, and bending the marketing stylesheet
 * around it would have meant editing a file six other pages depend on.
 *
 * What is shared is what should be: the tokens from `app/globals.css` — which
 * are the marketing light palette, so the colour is genuinely the same system
 * — plus the fan mark, the pill buttons and the theme toggle. One brand, two
 * layouts, no forked palette.
 *
 * The nav links are the ones the mockup shows, mapped onto routes that
 * actually exist. The mockup's "Discover" and "For creators" have no pages
 * behind them yet, and a header link to a 404 is worse than a header without
 * it, so this ships How it works and Pricing until they do.
 */

const NAV_LINKS = [
  { label: "How it works", href: marketingRoutes.howItWorks },
  { label: "Pricing", href: marketingRoutes.pricing },
] as const

const FOOTER_LINKS = [
  { label: "How it works", href: marketingRoutes.howItWorks },
  { label: "Pricing", href: marketingRoutes.pricing },
  { label: "Marketplaces", href: marketingRoutes.marketplaces },
  { label: "Terms", href: marketingRoutes.terms },
  { label: "Privacy", href: marketingRoutes.privacy },
] as const

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-[var(--color-paper)]">
      {/*
        A skip link, first in the DOM and visible only on focus. A profile page
        can carry forty product cards, and without this a keyboard visitor
        tabs through every one of them to reach the page they chose.
      */}
      <a
        href="#main"
        className="sr-only rounded-[8px] bg-[var(--color-ink)] px-4 py-2 text-[14px] text-[var(--color-paper)] focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50"
      >
        Skip to content
      </a>

      <header className="border-b border-[var(--color-rule)]">
        <div className="mx-auto flex w-full max-w-[1160px] flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4 sm:px-8">
          <Link
            href={marketingRoutes.landing}
            className="flex min-h-11 shrink-0 items-center gap-2 rounded-[6px] text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          >
            <FanMark size={22} />
            <span className="font-display text-[20px] tracking-[-0.02em]">Fanwise</span>
          </Link>

          <nav aria-label="Fanwise" className="ml-auto flex items-center gap-5 sm:gap-6">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="hidden text-[14px] text-[var(--color-ink-2)] underline-offset-4 hover:text-[var(--color-ink)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] sm:inline"
              >
                {link.label}
              </Link>
            ))}
            <ThemeToggle />
            <Link
              href={marketingRoutes.signIn}
              className="text-[14px] text-[var(--color-ink-2)] underline-offset-4 hover:text-[var(--color-ink)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
            >
              Sign in
            </Link>
            <ButtonLink href={marketingRoutes.signUp} variant="secondary" className="max-sm:hidden">
              Create your profile
            </ButtonLink>
          </nav>
        </div>
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer className="mt-24 border-t border-[var(--color-rule)]">
        <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-6 px-5 py-10 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link
              href={marketingRoutes.landing}
              className="flex items-center gap-2 text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
            >
              <FanMark size={18} />
              <span className="font-display text-[17px] tracking-[-0.02em]">Fanwise</span>
            </Link>
            <p className="text-[14px] text-[var(--color-ink-3)]">
              One creation. Everywhere it belongs.
            </p>
          </div>
          <nav aria-label="Fanwise footer" className="flex flex-wrap gap-x-6 gap-y-2">
            {FOOTER_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-[14px] text-[var(--color-ink-2)] underline-offset-4 hover:text-[var(--color-ink)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  )
}
