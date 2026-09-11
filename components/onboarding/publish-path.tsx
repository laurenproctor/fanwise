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

// One width per possible count, spelled out so the stylesheet contains them.
const FILL = ["w-0", "w-1/4", "w-2/4", "w-3/4", "w-full"] as const

const MARKER: Record<PublishStepState, string> = {
  complete: "border-[var(--color-ink)] bg-transparent text-[var(--color-ink)]",
  current: "border-[var(--color-action)] bg-[var(--color-action)] text-[var(--color-on-action)]",
  upcoming: "border-[var(--color-rule)] bg-[var(--color-card)] text-[var(--color-ink-2)]",
}

export function PublishPath({ completed }: { completed: number }) {
  const states = publishStepStates(completed)
  const done = states.filter((state) => state === "complete").length
  const total = PUBLISH_STEPS.length

  return (
    <section aria-labelledby="publish-path-heading" className="flex flex-col gap-10 pt-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-10">
        <h2
          id="publish-path-heading"
          className="font-display text-[clamp(1.75rem,3.2vw,2.5rem)] font-extralight tracking-[-0.035em]"
        >
          Your path to publish
        </h2>
        <div className="flex items-center gap-4 sm:w-[45%] sm:max-w-[420px]">
          <p className="tabular shrink-0 text-[14px] text-[var(--color-ink-2)]">
            {`${done} of ${total} complete`}
          </p>
          {/* The sentence beside it is the accessible version of this line. */}
          <span
            aria-hidden="true"
            className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--color-rule-2)]"
          >
            <span className={`block h-full rounded-full bg-[var(--color-ink)] ${FILL[done]}`} />
          </span>
        </div>
      </div>

      {/*
        Across from 1280px, where the column is at its full 1112px and the four
        steps fit on one line each at 15 and 13px. Narrower than that they
        would wrap word by word, so they stack instead.
      */}
      <ol className="flex flex-col gap-7 xl:flex-row xl:items-start xl:gap-0">
        {PUBLISH_STEPS.map((step, index) => {
          const state = states[index] ?? "upcoming"
          const last = index === total - 1

          return (
            <li
              key={step.title}
              aria-current={state === "current" ? "step" : undefined}
              className={`relative flex items-start gap-4 xl:gap-3.5 ${last ? "" : "xl:flex-auto"}`}
            >
              {last ? null : (
                <span
                  aria-hidden="true"
                  className="absolute -bottom-7 left-[22px] top-12 w-px bg-[var(--color-rule)] xl:hidden"
                />
              )}
              <span
                aria-hidden="true"
                className={`tabular grid h-11 w-11 shrink-0 place-items-center rounded-full border text-[15px] xl:h-10 xl:w-10 xl:text-[14px] ${MARKER[state]}`}
              >
                {state === "complete" ? <CheckIcon /> : index + 1}
              </span>
              <div className="flex min-w-0 flex-col gap-1 pt-2.5 xl:pt-2">
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
              {last ? null : (
                <span
                  aria-hidden="true"
                  className="mr-4 mt-5 hidden h-px min-w-4 flex-1 bg-[var(--color-rule)] xl:block"
                />
              )}
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
