import Link from "next/link"

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--color-accent)]"

/**
 * The secondary way in: bring a listing that is already live somewhere.
 *
 * No import flow exists. Until one does, this says so rather than pointing
 * somewhere nearby: a link to the channels page would read as "import is over
 * there", and it is not. `href` is the whole switch, so the day an import route
 * exists the page passes it and this becomes a real link.
 *
 * aria-disabled rather than disabled, so the control stays in the tab order and
 * a keyboard or screen reader user learns it is coming instead of never finding
 * it. "Coming soon" is its accessible description as well as its visible label.
 */
export function ImportListingAction({ href }: { href: string | null }) {
  if (href) {
    return (
      <Link
        href={href}
        className={`inline-flex min-h-11 items-center rounded-[6px] text-[15px] font-medium text-[var(--color-accent)] underline underline-offset-4 hover:text-[var(--color-ink)] ${FOCUS}`}
      >
        Import a live listing
      </Link>
    )
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <button
        type="button"
        aria-disabled="true"
        aria-describedby="import-listing-availability"
        title="Importing a live listing is not available yet."
        className={`inline-flex min-h-11 cursor-not-allowed items-center rounded-[6px] text-[15px] font-medium text-[var(--color-ink-2)] ${FOCUS}`}
      >
        Import a live listing
      </button>
      <span
        id="import-listing-availability"
        className="rounded-[var(--radius-pill)] border border-[var(--color-rule)] px-2 py-[3px] font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-2)]"
      >
        Coming soon
      </span>
    </span>
  )
}
