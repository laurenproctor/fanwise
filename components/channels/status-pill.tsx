import type { ListingLiveness } from "@/lib/publishing/manual-steps"
import { LIVENESS_LABELS } from "@/lib/publishing/manual-steps"

/**
 * What a listing's state is, said in one pill.
 *
 * docs/design-system.md: state must be readable from form as well as colour, so
 * every pill carries a dot and a word, and the semantic colour is spent on the
 * border and the dot rather than on the text. Coloured text on paper is the
 * variant that fails a contrast check and reads as decoration.
 *
 * `published_not_live` is the one worth looking at twice. It is deliberately
 * not green and deliberately not an error: the product is on the channel and
 * the creator has one thing left to do. ADR 0001 asks that nothing report a
 * product as live until it is, and a pill that said "Published" in green would
 * be exactly that.
 */
const TONE: Record<ListingLiveness, string> = {
  unpublished: "border-[var(--color-rule)] text-[var(--color-ink-3)]",
  publishing: "border-[var(--color-accent)] text-[var(--color-accent)]",
  published_not_live: "border-[var(--color-warn)] text-[var(--color-ink)]",
  live: "border-[var(--color-ok)] text-[var(--color-ok)]",
  failed: "border-[var(--color-bad)] text-[var(--color-ink)]",
}

export function StatusPill({ liveness }: { liveness: ListingLiveness }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${TONE[liveness]}`}
    >
      <span
        className={`h-[5px] w-[5px] rounded-full ${
          liveness === "published_not_live"
            ? "bg-[var(--color-warn)]"
            : liveness === "failed"
              ? "bg-[var(--color-bad)]"
              : "bg-current"
        }`}
        aria-hidden
      />
      {LIVENESS_LABELS[liveness]}
    </span>
  )
}
