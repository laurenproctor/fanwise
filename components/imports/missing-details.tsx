import type { ListingGap } from "@/lib/imports/gaps"

/**
 * What the import still lacks, in two lists that answer the same question
 * from different sides.
 *
 * The first is Fanwise's, computed from the draft: each row names a thing a
 * listing of this kind needs and the upload or the words that supply it. The
 * second is the model's, as it was written: what it noticed the sources did
 * not say. The two are kept apart and labelled, because one is a rule and the
 * other an observation, and a creator should know which they are reading.
 */
export function MissingDetails({
  gaps,
  observations,
  mode,
}: {
  gaps: readonly ListingGap[]
  observations: readonly string[]
  mode: "link" | "content"
}) {
  if (gaps.length === 0 && observations.length === 0) return null
  const sources = mode === "link" ? "the page" : "your sources"

  return (
    <section
      aria-labelledby="import-missing-heading"
      className="flex flex-col gap-3 rounded-[16px] border border-[var(--color-rule)] bg-[var(--color-card)] px-5 py-4"
    >
      <h2 id="import-missing-heading" className="label-mono">
        What is still missing
      </h2>

      {gaps.length > 0 ? (
        <>
          <p className="text-[14px] leading-[1.55] text-[var(--color-ink-2)]">
            {sources.charAt(0).toUpperCase() + sources.slice(1)} did not give Fanwise enough to fill
            in everything a listing needs. Each item says what would.
          </p>
          <ul className="flex flex-col gap-2.5">
            {gaps.map((gap) => (
              <li key={gap.key} className="flex flex-col gap-0.5">
                <span className="text-[14px] font-medium text-[var(--color-ink)]">{gap.label}</span>
                <span className="text-[13px] leading-[1.5] text-[var(--color-ink-2)]">
                  {gap.how}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {observations.length > 0 ? (
        <div className="flex flex-col gap-1.5 border-t border-[var(--color-rule-2)] pt-3">
          <h3 className="text-[13px] font-medium text-[var(--color-ink)]">
            {mode === "link" ? "What the page did not say" : "What your sources did not say"}
          </h3>
          <ul className="flex flex-col gap-1.5">
            {observations.map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <span
                  aria-hidden
                  className="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full bg-[var(--color-ink-3)]"
                />
                <span className="text-[14px] leading-[1.5] text-[var(--color-ink-2)]">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
