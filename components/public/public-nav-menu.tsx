"use client"

import { useId } from "react"
import Link from "next/link"
import { ButtonLink } from "@/components/ui/button"
import { useDisclosure } from "@/components/ui/use-disclosure"
import { marketingRoutes } from "@/lib/routes"

/**
 * The public-page nav below 640px.
 *
 * The header used to hide its links at this width and show nothing in their
 * place, which left How it works, Pricing and Create your profile reachable
 * only from the footer. This is the same disclosure the marketing nav runs,
 * built from the shared tokens rather than marketing.css for the reason given
 * in public-shell.tsx: a creator's page is not a marketing page.
 */
export function PublicNavMenu({
  links,
}: {
  links: ReadonlyArray<{ label: string; href: string }>
}) {
  const { open, toggle, close, triggerRef, containerRef } = useDisclosure({ closeAbove: 640 })
  const panelId = useId()

  return (
    <div ref={containerRef} className="sm:hidden">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="inline-flex size-11 items-center justify-center rounded-[10px] border border-[var(--color-rule)] text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
      >
        <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          aria-hidden="true"
        >
          {open ? (
            <>
              <path d="M4 4l10 10" />
              <path d="M14 4L4 14" />
            </>
          ) : (
            <>
              <path d="M2.5 5h13" />
              <path d="M2.5 9h13" />
              <path d="M2.5 13h13" />
            </>
          )}
        </svg>
      </button>

      <div
        id={panelId}
        hidden={!open}
        className="absolute inset-x-4 z-50 mt-2 flex flex-col gap-0.5 rounded-[14px] border border-[var(--color-rule)] bg-[var(--color-paper)] p-2.5 shadow-[0_18px_44px_rgba(10,12,20,0.14)]"
      >
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            onClick={close}
            className="flex min-h-11 items-center rounded-[9px] px-3 text-[15px] text-[var(--color-ink-2)] hover:bg-[var(--color-paper-2)] hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          >
            {link.label}
          </Link>
        ))}
        <span aria-hidden="true" className="my-2 h-px bg-[var(--color-rule)]" />
        <Link
          href={marketingRoutes.signIn}
          onClick={close}
          className="flex min-h-11 items-center rounded-[9px] px-3 text-[15px] text-[var(--color-ink-2)] hover:bg-[var(--color-paper-2)] hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        >
          Sign in
        </Link>
        <ButtonLink
          href={marketingRoutes.signUp}
          variant="secondary"
          onClick={close}
          className="mt-1.5 w-full"
        >
          Create your profile
        </ButtonLink>
      </div>
    </div>
  )
}
