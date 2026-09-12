/**
 * The three things that happen after "Create draft", said once, quietly.
 *
 * A description of the journey, not a progress indicator: the first step is
 * marked because it is where the creator is about to begin, and nothing here
 * moves. The review screen's five-part readiness is the measure of a listing;
 * this is only the order of events.
 */
const STEPS = [
  { title: "Read your sources", body: "We’ll extract the key details." },
  { title: "Build the product draft", body: "We’ll organize and write it for you." },
  { title: "Review and complete", body: "Edit, make changes, and publish." },
] as const

export function JourneySteps() {
  return (
    <ol
      aria-label="What happens next"
      className="flex flex-col gap-5 border-t border-[var(--color-rule)] pt-6 sm:flex-row sm:items-center sm:gap-4"
    >
      {STEPS.map((step, index) => (
        <li
          key={step.title}
          className={`flex min-w-0 items-center gap-4 ${index === 0 ? "sm:flex-none" : "sm:flex-1"}`}
        >
          {index > 0 ? (
            <span
              aria-hidden
              className="hidden h-px min-w-6 flex-1 bg-[var(--color-rule)] sm:block"
            />
          ) : null}
          <span className="flex min-w-0 shrink-0 items-start gap-3">
            <span
              aria-hidden
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[13px] font-medium ${
                index === 0
                  ? "bg-[var(--color-blue)] text-[var(--color-on-action)]"
                  : "bg-[var(--color-paper-2)] text-[var(--color-ink-2)]"
              }`}
            >
              {index + 1}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5 lg:whitespace-nowrap">
              <span className="text-[14px] font-medium text-[var(--color-ink)]">{step.title}</span>
              <span className="text-[13px] text-[var(--color-ink-3)]">{step.body}</span>
            </span>
          </span>
        </li>
      ))}
    </ol>
  )
}
