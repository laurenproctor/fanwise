import Link from "next/link"

/**
 * The root not-found boundary.
 *
 * This is where a workspace guard lands. `notFound()` thrown from
 * app/w/[slug]/layout.tsx cannot be caught by a not-found file nested inside
 * that same layout, because the layout is what failed to render, so it bubbles
 * to here.
 *
 * The wording is deliberately the same for a URL that never existed and a
 * workspace belonging to someone else. Distinguishing them would confirm that a
 * slug is real, which is exactly the probe this page has to defeat.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[460px] flex-col justify-center gap-4 px-6">
      <span className="label-mono">Not found</span>
      <h1 className="font-display text-3xl font-extralight tracking-[-0.03em]">
        This page does not exist
      </h1>
      <p className="text-[15px] text-[var(--color-ink-2)]">
        The address is wrong, or it belongs to someone else.
      </p>
      <Link
        href="/"
        className="text-[14px] text-[var(--color-accent)] underline underline-offset-4"
      >
        Back to your workspace
      </Link>
    </main>
  )
}
