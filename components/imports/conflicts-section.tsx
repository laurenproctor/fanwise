import type { FactConflict } from "@/lib/imports/conflicts"

/**
 * Where the creator's sources disagree.
 *
 * Fanwise does not choose. Each reading is shown with the sources that gave it,
 * the draft leaves the value out, and the creator writes the one that is true
 * into the listing. A price can be set in the draft's price field; the rest
 * belong in the description, in the creator's own words.
 */
export function ConflictsSection({ conflicts }: { conflicts: readonly FactConflict[] }) {
  if (conflicts.length === 0) return null

  return (
    <section
      aria-labelledby="import-conflicts-heading"
      className="flex flex-col gap-3 rounded-[16px] border border-[var(--color-warn)] bg-[var(--color-card)] px-5 py-4"
    >
      <h2 id="import-conflicts-heading" className="label-mono">
        Your sources disagree
      </h2>
      <p className="text-[14px] leading-[1.55] text-[var(--color-ink-2)]">
        Fanwise did not pick one. The draft leaves these out; choose the true value and write it
        into the listing.
      </p>
      <dl className="flex flex-col gap-3">
        {conflicts.map((conflict) => (
          <div key={conflict.kind} className="flex flex-col gap-1">
            <dt className="text-[14px] font-medium text-[var(--color-ink)]">{conflict.label}</dt>
            <dd>
              <ul className="flex flex-col gap-1">
                {conflict.values.map((entry) => (
                  <li key={entry.value} className="text-[14px] text-[var(--color-ink-2)]">
                    <span className="font-mono text-[13px] text-[var(--color-ink)]">
                      {entry.value}
                    </span>{" "}
                    in {entry.sources.join(", ")}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
