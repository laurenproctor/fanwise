import Link from "next/link"
import { FanLines } from "@/components/ui/fan-lines"
import { routes } from "@/lib/routes"

/**
 * The builder's page header and its three-step progress, shared by every step
 * so the steps cannot drift apart in wording or order.
 */

export type BuilderStep = 1 | 2 | 3

const STEPS: Array<{ step: BuilderStep; label: string }> = [
  { step: 1, label: "Profile details" },
  { step: 2, label: "Manage products" },
  { step: 3, label: "Preview and publish" },
]

export function BuilderHeader({
  workspaceSlug,
  current,
}: {
  workspaceSlug: string
  current: BuilderStep
}) {
  return (
    <header className="relative isolate flex flex-col gap-6 overflow-hidden pt-2 pb-2">
      <FanLines className="-top-6 -right-6 -z-10 hidden h-[300px] w-[480px] opacity-50 lg:block" />
      <nav aria-label="Breadcrumb">
        <Link
          href={routes.settings(workspaceSlug)}
          className="label-mono underline-offset-4 hover:text-[var(--color-ink-2)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        >
          ← Settings
        </Link>
      </nav>
      <h1 className="font-display text-[44px] leading-[1.05] font-extralight tracking-[-0.04em] sm:text-[64px]">
        Public profile
      </h1>
      <p className="max-w-[62ch] text-[17px] text-[var(--color-ink-2)]">
        Create one shareable destination for your studio and products. Customers can browse what
        you&rsquo;ve published and choose where to buy it. Drafts, billing information, and account
        details always remain private.
      </p>
      <BuilderSteps current={current} />
    </header>
  )
}

export function BuilderSteps({ current }: { current: BuilderStep }) {
  return (
    <ol
      aria-label="Profile builder steps"
      className="flex flex-wrap items-center gap-x-4 gap-y-3 pt-2"
    >
      {STEPS.map(({ step, label }, index) => {
        const state = step < current ? "complete" : step === current ? "current" : "upcoming"
        return (
          <li
            key={step}
            aria-current={state === "current" ? "step" : undefined}
            className="flex items-center gap-3"
          >
            <span
              aria-hidden
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[14px] ${
                state === "current"
                  ? "bg-[var(--color-ink)] text-[var(--color-paper)]"
                  : state === "complete"
                    ? "border border-[var(--color-accent)] text-[var(--color-accent)]"
                    : "bg-[var(--color-paper-2)] text-[var(--color-ink-2)]"
              }`}
            >
              {state === "complete" ? <CheckGlyph /> : step}
            </span>
            <span
              className={`text-[15px] ${
                state === "upcoming" ? "text-[var(--color-ink-2)]" : "text-[var(--color-ink)]"
              }`}
            >
              {label}
              <span className="sr-only">
                {state === "complete" ? ", complete" : state === "current" ? ", current step" : ""}
              </span>
            </span>
            {index < STEPS.length - 1 ? (
              <span aria-hidden className="hidden h-px w-16 bg-[var(--color-rule)] sm:block" />
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

function CheckGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="m5 12.5 4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
