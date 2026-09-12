import Link from "next/link"
import type { ReactNode } from "react"
import { routes } from "@/lib/routes"

/**
 * The frame both import screens sit in.
 *
 * The empty state and the detail page are different components with different
 * data and different interactivity, and they are the same page to a creator:
 * same heading, same sentence under it, same way back to the catalog. Shared
 * so that "same" is a fact rather than an intention — two copies of a heading
 * drift, and the one that drifts is the one nobody is looking at.
 *
 * `data-workspace-canvas="full"` is the one opt-in that widens `<main>`. One
 * selector in app/globals.css reads it and nothing else in the app sets it, so
 * no other route moves. See the note there.
 */
export function ImportChrome({
  workspaceSlug,
  children,
}: {
  workspaceSlug: string
  /** Optional, so the frame can be rendered and asserted on by itself. */
  children?: ReactNode
}) {
  return (
    <div data-workspace-canvas="full" className="flex flex-col">
      <nav aria-label="Breadcrumb" className="pb-6">
        <ol className="flex flex-wrap items-center gap-2 text-[14px]">
          <li>
            <Link
              href={routes.workspace(workspaceSlug)}
              className="rounded-[4px] text-[var(--color-ink-2)] underline underline-offset-4 hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--color-accent)]"
            >
              Products
            </Link>
          </li>
          <li aria-hidden className="text-[var(--color-ink-3)]">
            /
          </li>
          {/* Marked rather than linked: a link to here from here does nothing. */}
          <li aria-current="page" className="text-[var(--color-ink)]">
            New product
          </li>
        </ol>
      </nav>

      <header className="flex flex-col gap-3 pb-8">
        <h1 className="font-display text-[clamp(2.25rem,4.4vw,3.5rem)] font-extralight leading-[1.02] tracking-[-0.04em]">
          Import a product
        </h1>
        <p className="max-w-[52ch] text-[clamp(1rem,1.4vw,1.125rem)] leading-[1.5] text-[var(--color-ink-2)]">
          Turn a product page, a document, or text you already have into an editable Fanwise
          listing.
        </p>
      </header>

      {children}
    </div>
  )
}
