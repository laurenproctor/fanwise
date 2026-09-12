import { InfoTip } from "@/components/ui/info-tip"
import type { ImportReadiness, ImportStep } from "@/lib/imports/readiness"
import { joinWords } from "@/lib/imports/prose"

/**
 * The authoritative summary of how far this import has got.
 *
 * Everything here is read from one `ImportReadiness`, which is computed by
 * `lib/imports/readiness.ts` from what was actually measured. The checklist
 * further down the page reads the same object. That is deliberate and it is the
 * point of the component: a bar and a list computed separately disagree
 * eventually, and a creator who catches that once stops believing either.
 *
 * Three things it refuses to do:
 *
 *   1. **No colour-only state.** Every step carries a word — Complete, Next
 *      step, Required — and a shape. The mint tick is confirmation of something
 *      already written down, never the only place it is written.
 *   2. **No invented precision.** Five steps divide 100 exactly, so the figure
 *      moves in twenties and never shows a number no step produced.
 *   3. **No threshold.** The percentage is display. `ready` is what gates the
 *      action, and it means every required step, not a high enough score.
 */
export function ReadinessRegion({ readiness }: { readiness: ImportReadiness }) {
  return (
    <section
      aria-labelledby="import-readiness-heading"
      className="grid gap-x-10 gap-y-8 rounded-[16px] border border-[var(--color-rule)] bg-[var(--color-card)] px-6 py-6 lg:grid-cols-[minmax(220px,290px)_minmax(0,1fr)] lg:items-center lg:px-8"
    >
      <div className="flex flex-col gap-1.5">
        <span className="flex items-baseline gap-1.5">
          <h2 id="import-readiness-heading" className="label-mono">
            Listing readiness
          </h2>
          <InfoTip term="readiness" />
        </span>

        <p
          className="tabular font-display text-[clamp(2.75rem,5vw,4rem)] font-extralight leading-[1] tracking-[-0.04em]"
          aria-hidden
        >
          {readiness.percent}%
        </p>

        {/*
          The bar is the accessible progress control, and its value text is the
          count rather than the figure: "2 of 5 steps complete" is what a
          creator can act on, and "40%" read aloud invites being heard as a
          grade.
        */}
        <div
          role="progressbar"
          aria-valuenow={readiness.completedCount}
          aria-valuemin={0}
          aria-valuemax={readiness.total}
          aria-valuetext={`${readiness.completedCount} of ${readiness.total} steps complete, ${readiness.percent} percent`}
          aria-labelledby="import-readiness-heading"
          className="mt-1 flex h-[4px] w-full gap-1 overflow-hidden rounded-full"
        >
          {readiness.steps.map((step) => (
            <span
              key={step.key}
              aria-hidden
              className={`h-full flex-1 rounded-full ${
                step.complete ? "bg-[var(--color-ok)]" : "bg-[var(--color-rule-2)]"
              }`}
            />
          ))}
        </div>

        <p className="mt-2 text-[15px] text-[var(--color-ink)]">
          {readiness.completedCount} of {readiness.total} steps complete
        </p>
        <p className="max-w-prose text-[14px] leading-[1.5] text-[var(--color-ink-2)]">
          {readiness.ready
            ? "Every required step is done. Review the marketplace drafts when you are ready."
            : summarize(readiness)}
        </p>
      </div>

      <ol className="grid gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-5">
        {readiness.steps.map((step, index) => (
          <StepMarker
            key={step.key}
            step={step}
            index={index}
            isNext={readiness.nextStep === step.key}
            isLast={index === readiness.steps.length - 1}
          />
        ))}
      </ol>
    </section>
  )
}

/** The unfinished steps, named, so the sentence says what to go and do. */
function summarize(readiness: ImportReadiness): string {
  const outstanding = readiness.steps.filter((step) => !step.complete).map((step) => step.label)
  if (outstanding.length === 0) return ""
  return `Add ${joinWords(outstanding).toLowerCase()} to review marketplace drafts.`
}

function StepMarker({
  step,
  index,
  isNext,
  isLast,
}: {
  step: ImportStep
  index: number
  isNext: boolean
  isLast: boolean
}) {
  const state = step.complete ? "Complete" : isNext ? "Next step" : "Required"

  return (
    <li
      /*
        aria-current marks the one step a creator should do next. Exactly one
        step can carry it, because `nextStep` is the first incomplete step and
        there is only ever one first.
      */
      aria-current={isNext ? "step" : undefined}
      className="relative flex min-w-0 items-start gap-3 lg:flex-col lg:items-stretch lg:gap-2.5"
    >
      <span className="relative flex shrink-0 items-center lg:w-full">
        <span
          className={`relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[12px] font-medium ${
            step.complete
              ? "border-[var(--color-ok)] bg-[var(--color-ok)] text-[var(--color-on-action)]"
              : isNext
                ? "border-[var(--color-ink)] bg-[var(--color-card)] text-[var(--color-ink)]"
                : "border-[var(--color-rule)] bg-[var(--color-card)] text-[var(--color-ink-3)]"
          }`}
        >
          {step.complete ? <TickGlyph /> : <span aria-hidden>{index + 1}</span>}
        </span>
        {/*
          The connector between markers, on the wide layout only. Decorative:
          the order is already carried by the list, and a line that had to be
          read would be a line a screen reader announced five times.
        */}
        {isLast ? null : (
          <span
            aria-hidden
            className={`absolute left-7 right-0 hidden h-px lg:block ${
              step.complete ? "bg-[var(--color-ok)]" : "bg-[var(--color-rule)]"
            }`}
          />
        )}
      </span>

      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[14px] font-medium text-[var(--color-ink)]">{step.label}</span>
        <span
          className={`label-mono ${
            step.complete
              ? "text-[var(--color-ok)]"
              : isNext
                ? "text-[var(--color-ink)]"
                : "text-[var(--color-ink-3)]"
          }`}
        >
          {state}
        </span>
      </span>
    </li>
  )
}

function TickGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M2.4 6.3 4.8 8.7 9.6 3.4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
