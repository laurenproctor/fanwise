import {
  ANALYZING_STAGES,
  ANALYZING_STAGE_LABELS,
  type AnalyzingStage,
} from "@/lib/imports/machine"

/**
 * What is happening while a link is being read.
 *
 * **Staged, and deliberately not a percentage.** The work has no knowable
 * length: a page answers in 200ms or in nine seconds, and a determinate bar
 * over that is a number the screen invented. The one thing everybody remembers
 * is the bar that sat at 90%.
 *
 * So three named stages, each either done, running or waiting, and a bar that
 * travels without claiming a position. A stage is marked done only once the
 * next one has started — the reader never reports its own completion, because
 * the last stage's end is the answer arriving, and that is a different event.
 */
export function AnalyzingPanel({ stage }: { stage: AnalyzingStage }) {
  const current = ANALYZING_STAGES.indexOf(stage)

  return (
    <section
      aria-labelledby="import-analyzing-heading"
      className="flex flex-col gap-5 rounded-[16px] border border-[var(--color-rule)] bg-[var(--color-card)] px-6 py-7"
    >
      <h2 id="import-analyzing-heading" className="label-mono">
        Reading the link
      </h2>

      <div className="import-indeterminate h-[4px] w-full rounded-full" aria-hidden />

      <ol className="flex flex-col gap-3">
        {ANALYZING_STAGES.map((name, index) => {
          const done = index < current
          const running = index === current
          return (
            <li
              key={name}
              aria-current={running ? "step" : undefined}
              className="flex items-center gap-3"
            >
              <span
                aria-hidden
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] ${
                  done
                    ? "border-[var(--color-ok)] bg-[var(--color-ok)] text-[var(--color-on-action)]"
                    : running
                      ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                      : "border-[var(--color-rule)] text-[var(--color-ink-3)]"
                }`}
              >
                {done ? "✓" : index + 1}
              </span>
              <span
                className={`text-[14px] ${running ? "text-[var(--color-ink)]" : "text-[var(--color-ink-2)]"}`}
              >
                {ANALYZING_STAGE_LABELS[name]}
              </span>
              {/* The state as a word, so none of this depends on the colour. */}
              <span className="label-mono ml-auto">
                {done ? "Done" : running ? "Working" : "Waiting"}
              </span>
            </li>
          )
        })}
      </ol>

      <p className="text-[13px] leading-[1.55] text-[var(--color-ink-2)]">
        Fanwise reads the page from its own servers, signed out, and stores what it finds. It never
        runs anything it downloads.
      </p>
    </section>
  )
}
