/**
 * The four steps between an empty catalog and a live listing.
 *
 * Driven by one number, how many steps are done, which the caller reads from
 * real state. The first-run screen passes 0, because a workspace with no
 * products has done none of them. Nothing here infers progress on its own, so
 * the path cannot claim a step the data does not show.
 */
export const PUBLISH_STEPS = [
  { title: "Create a product", description: "Add your files, details and media." },
  { title: "Choose marketplaces", description: "Select where you want to sell." },
  { title: "Review your listings", description: "Check and customize each version." },
  { title: "Publish", description: "Go live and start selling." },
] as const

export type PublishStepState = "complete" | "current" | "upcoming"

/** Each step's state, given how many are done. Out-of-range counts are clamped. */
export function publishStepStates(completed: number): PublishStepState[] {
  const done = Math.min(Math.max(Math.floor(completed), 0), PUBLISH_STEPS.length)
  return PUBLISH_STEPS.map((_, index) =>
    index < done ? "complete" : index === done ? "current" : "upcoming",
  )
}

const STATE_LABELS: Record<PublishStepState, string> = {
  complete: "Complete",
  current: "Current step",
  upcoming: "Upcoming",
}

const MARKER: Record<PublishStepState, string> = {
  complete: "border-[var(--color-ink)] bg-transparent text-[var(--color-ink)]",
  current: "border-[var(--color-action)] bg-[var(--color-action)] text-[var(--color-on-action)]",
  upcoming: "border-[var(--color-rule)] bg-[var(--color-card)] text-[var(--color-ink-2)]",
}

export function PublishPath({ completed }: { completed: number }) {
  const states = publishStepStates(completed)
  const total = PUBLISH_STEPS.length

  return (
    <section aria-labelledby="publish-path-heading" className="flex flex-col gap-10 pt-12">
      <h2
        id="publish-path-heading"
        className="font-display text-[clamp(1.75rem,3.2vw,2.5rem)] font-extralight tracking-[-0.035em]"
      >
        Your path to publish
      </h2>

      {/*
        The four steps read left to right as one line of travel. Each step is a
        column with its marker above its words, so the text has the whole column
        to wrap into rather than a sliver beside the circle. Below 640px four
        columns leave too little of each, so there they stack.
      */}
      <ol className="flex flex-col gap-7 sm:flex-row sm:items-start sm:gap-0">
        {PUBLISH_STEPS.map((step, index) => {
          const state = states[index] ?? "upcoming"
          const last = index === total - 1

          return (
            <li
              key={step.title}
              aria-current={state === "current" ? "step" : undefined}
              className={`relative flex items-start gap-4 sm:flex-col sm:gap-3 ${last ? "sm:w-[22%] sm:shrink-0" : "sm:flex-auto sm:pr-5"}`}
            >
              {last ? null : (
                <span
                  aria-hidden="true"
                  className="absolute -bottom-7 left-[22px] top-12 w-px bg-[var(--color-rule)] sm:hidden"
                />
              )}
              <span className="flex shrink-0 items-center sm:w-full">
                <span
                  aria-hidden="true"
                  className={`tabular grid h-11 w-11 shrink-0 place-items-center rounded-full border text-[15px] xl:h-10 xl:w-10 xl:text-[14px] ${MARKER[state]}`}
                >
                  {state === "complete" ? <CheckIcon /> : index + 1}
                </span>
                {last ? null : (
                  <span
                    aria-hidden="true"
                    className="ml-3 hidden h-px min-w-3 flex-1 bg-[var(--color-rule)] sm:block"
                  />
                )}
              </span>
              <div className="flex min-w-0 flex-col gap-1 pt-2.5 sm:pt-0">
                <p
                  className={`text-[16px] font-medium xl:text-[15px] ${state === "upcoming" ? "text-[var(--color-ink-2)]" : "text-[var(--color-ink)]"}`}
                >
                  <span className="sr-only">{`${STATE_LABELS[state]}: `}</span>
                  {step.title}
                </p>
                <p className="text-[14px] text-[var(--color-ink-2)] xl:text-[13px]">
                  {step.description}
                </p>
              </div>
            </li>
          )
        })}
      </ol>

      <p className="flex items-center gap-3 text-[14px] text-[var(--color-ink-2)]">
        <span
          aria-hidden="true"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--color-paper-2)] text-[var(--color-ink)]"
        >
          <InfoIcon />
        </span>
        You can leave and return anytime. Progress saves automatically.
      </p>
    </section>
  )
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="m3.5 8.5 3 3 6-7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function InfoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.25" />
      <path d="M8 7.25v3.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      <circle cx="8" cy="5.1" r="0.8" fill="currentColor" />
    </svg>
  )
}
