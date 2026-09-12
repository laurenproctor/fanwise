import type { EvidenceChange } from "@/lib/imports/view"

/**
 * What a re-read of the source turned up that the last one did not.
 *
 * Shown because replacing a link must never quietly rewrite a listing. It
 * cannot, structurally: evidence and suggestions live on the import, and
 * nothing reaches the canonical product without a save the creator pressed. This
 * is the visible half of that guarantee — the difference is put in front of
 * them, before and after, and they decide what to carry across.
 *
 * Deliberately not a diff of the listing. The listing is theirs and has not
 * changed; what changed is the page, and conflating the two would suggest their
 * work had been edited by something.
 */
export function SourceChanges({ changes }: { changes: readonly EvidenceChange[] }) {
  if (changes.length === 0) return null

  return (
    <section
      aria-labelledby="import-changes-heading"
      className="flex flex-col gap-3 rounded-[16px] border border-[var(--color-accent)] bg-[var(--color-card)] px-5 py-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="import-changes-heading" className="label-mono">
          What changed at the source
        </h2>
        <p className="text-[13px] leading-[1.5] text-[var(--color-ink-2)]">
          Your listing has not been touched. Edit any field to take the new wording.
        </p>
      </div>

      <ul className="flex flex-col divide-y divide-[var(--color-rule-2)]">
        {changes.map((change) => (
          <li key={change.field} className="flex flex-col gap-1.5 py-3">
            <span className="label-mono">{change.label}</span>
            <span className="flex flex-col gap-1 text-[13px] leading-[1.5]">
              <span className="text-[var(--color-ink-3)]">
                {/* Marked in words, so the comparison does not rest on order. */}
                <span className="font-mono text-[10px] uppercase tracking-[0.12em]">
                  Before
                </span>{" "}
                <span className="line-through">{change.before ?? "nothing"}</span>
              </span>
              <span className="text-[var(--color-ink)]">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em]">Now</span>{" "}
                {change.after ?? "nothing"}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
