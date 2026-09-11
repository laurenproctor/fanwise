"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { routes, workspaceSection, type WorkspaceSection } from "@/lib/routes"

const ITEMS: ReadonlyArray<{
  section: WorkspaceSection
  label: string
  href: (workspace: string) => string
}> = [
  { section: "products", label: "Products", href: routes.workspace },
  { section: "channels", label: "Channels", href: routes.channels },
  { section: "settings", label: "Settings", href: routes.settings },
]

/**
 * The workspace's three sections.
 *
 * A client component for one reason: a layout does not re-render on
 * navigation and is never told the path, so the current-page marker has to be
 * read in the browser. The marker is a rule under the label as well as a
 * colour, and `aria-current` says the same thing to assistive technology.
 */
export function WorkspaceNav({
  workspaceSlug,
  className = "",
}: {
  workspaceSlug: string
  className?: string
}) {
  const current = workspaceSection(usePathname(), workspaceSlug)

  return (
    <nav aria-label="Workspace" className={className}>
      <ul className="flex items-center gap-1">
        {ITEMS.map((item) => {
          const active = item.section === current
          return (
            <li key={item.section}>
              <Link
                href={item.href(workspaceSlug)}
                aria-current={active ? "page" : undefined}
                className={
                  "relative inline-flex min-h-11 items-center rounded-[6px] px-3 text-[14px] transition-colors " +
                  "after:pointer-events-none after:absolute after:inset-x-3 after:bottom-1 after:h-[1.5px] after:rounded-full " +
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] " +
                  (active
                    ? "text-[var(--color-ink)] after:bg-[var(--color-ink)]"
                    : "text-[var(--color-ink-2)] hover:text-[var(--color-ink)]")
                }
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
