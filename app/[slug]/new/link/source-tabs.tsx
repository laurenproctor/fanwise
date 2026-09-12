import Link from "next/link"
import { routes } from "@/lib/routes"

/**
 * The four ways in, as links rather than as client-side tabs.
 *
 * Each is an address, `?from=text` and so on, so a recovery on the review
 * screen can send a creator straight to "paste the text instead", the back
 * button does what it looks like it will, and nothing here needs JavaScript to
 * choose. `aria-current` marks the one on screen.
 */

export const IMPORT_FROM = ["link", "text", "pdf", "html"] as const
export type ImportFrom = (typeof IMPORT_FROM)[number]

export function importFromParam(value: string | string[] | undefined): ImportFrom {
  const first = Array.isArray(value) ? value[0] : value
  return (IMPORT_FROM as readonly string[]).includes(first ?? "") ? (first as ImportFrom) : "link"
}

const LABELS: Record<ImportFrom, string> = {
  link: "Link",
  text: "Paste text",
  pdf: "PDF",
  html: "HTML",
}

export function importFromHref(workspaceSlug: string, from: ImportFrom): string {
  const base = routes.importProduct(workspaceSlug)
  return from === "link" ? base : `${base}?from=${from}`
}

export function SourceTabs({
  workspaceSlug,
  current,
}: {
  workspaceSlug: string
  current: ImportFrom
}) {
  return (
    <nav aria-label="Import from" className="pb-6">
      <ul className="flex flex-wrap gap-2">
        {IMPORT_FROM.map((from) => {
          const active = from === current
          return (
            <li key={from}>
              <Link
                href={importFromHref(workspaceSlug, from)}
                aria-current={active ? "page" : undefined}
                scroll={false}
                className={`inline-flex min-h-11 items-center rounded-[var(--radius-pill)] border px-4 text-[14px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${
                  active
                    ? "border-[var(--color-action)] bg-[var(--color-action)] text-[var(--color-on-action)]"
                    : "border-[var(--color-rule)] bg-[var(--color-card)] text-[var(--color-ink-2)] hover:text-[var(--color-ink)]"
                }`}
              >
                {LABELS[from]}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
