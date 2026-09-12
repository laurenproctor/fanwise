import { Tip } from "@/components/ui/info-tip"
import { OBSERVATION_ORIGIN_LABELS, type FieldOrigin } from "@/lib/imports/types"

/**
 * Where a field's value came from, said beside the field.
 *
 * The one thing this screen must never blur. A value the source stated and a
 * value a model proposed look identical in an input, and treating them the same
 * is how an invention becomes a fact: an unreviewed suggestion that reached the
 * canonical product would enter the FactSheet, and every later generation for
 * every other channel would be free to restate it (architecture invariant 5).
 *
 * So the two get different words, not different shades. `From source` names the
 * tag it was read from in its tip; `Suggested` says a model wrote it, and says
 * `Needs review` until a person has looked. A field the creator typed carries
 * nothing, because the absence of a claim is the honest marker for their own
 * words.
 */
export function OriginBadge({ origin, field }: { origin: FieldOrigin; field: string }) {
  if (origin.kind === "creator") return null

  if (origin.kind === "observed") {
    return (
      <span className="inline-flex items-center gap-1.5 align-middle">
        <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border border-[var(--color-rule)] px-2 py-[3px] font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-2)]">
          <CheckGlyph />
          From source
        </span>
        <Tip
          label="From source"
          triggerLabel={`Where the ${field.toLowerCase()} came from`}
          body={`Fanwise read this from the page itself (${OBSERVATION_ORIGIN_LABELS[origin.from].toLowerCase()}). It is what the source said, not something Fanwise worked out.`}
        />
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      <span
        className={`inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border px-2 py-[3px] font-mono text-[10px] uppercase tracking-[0.12em] ${
          origin.reviewed
            ? "border-[var(--color-rule)] text-[var(--color-ink-2)]"
            : "border-[var(--color-warn)] text-[var(--color-ink)]"
        }`}
      >
        <PenGlyph />
        Suggested
        {origin.reviewed ? null : (
          <>
            {/* A dot alone would carry this in colour only. The word carries it. */}
            <span aria-hidden className="text-[var(--color-ink-3)]">
              ·
            </span>
            Needs review
          </>
        )}
      </span>
      <Tip
        label="Suggested"
        triggerLabel={`Where the ${field.toLowerCase()} came from`}
        body={
          origin.reviewed
            ? "Fanwise worked this out from the source rather than reading it there, and you have reviewed it. It stays marked so the next person can see who wrote it."
            : "Fanwise worked this out from the source rather than reading it there. Check it before continuing: anything you accept here, Fanwise may repeat on other channels."
        }
      />
    </span>
  )
}

function CheckGlyph() {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path
        d="M1.5 5.2 3.9 7.6 8.5 2.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PenGlyph() {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path
        d="M6.6 1.4 8.6 3.4 3.6 8.4H1.6V6.4z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}
