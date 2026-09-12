import Link from "next/link"
import { PublicShell } from "@/components/public/public-shell"
import { marketingRoutes } from "@/lib/routes"

/**
 * The public not-found page.
 *
 * Nested under `app/profile/[handle]` so a missing product still renders
 * inside the public shell rather than falling back to the root boundary,
 * which is written for a signed-in creator and offers to take them "back to
 * your workspace" — an odd thing to say to a stranger who followed a link.
 *
 * The wording is identical for a handle that never existed, one that is still
 * a draft, and one belonging to a profile that was unpublished this morning.
 * Distinguishing them would confirm that a handle is real and being worked on,
 * which is the probe this page exists to defeat.
 */
export default function PublicNotFound() {
  return (
    <PublicShell>
      <div className="mx-auto flex w-full max-w-[560px] flex-col items-start gap-4 px-5 py-28 sm:px-8">
        <span className="label-mono">Not found</span>
        <h1 className="font-display text-[36px] leading-[1.05] font-extralight tracking-[-0.04em]">
          This page does not exist
        </h1>
        <p className="text-[16px] text-[var(--color-ink-2)]">
          The address may be wrong, or the creator may have taken it down.
        </p>
        <Link
          href={marketingRoutes.landing}
          className="text-[15px] text-[var(--color-accent)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        >
          Go to Fanwise
        </Link>
      </div>
    </PublicShell>
  )
}
