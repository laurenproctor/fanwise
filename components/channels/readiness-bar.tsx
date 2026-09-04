import { readinessPercent } from "@/lib/channels/readiness"
import type { Readiness } from "@/lib/channels/types"

/**
 * Deterministic readiness, shown as what it is: how many blocking rules are
 * resolved. Not a score a model produced, and not a percentage anyone should
 * read as "nearly publishable" — the bar is context, the list underneath is the
 * actionable part.
 */
export function ReadinessBar({ readiness }: { readiness: Readiness }) {
  const percent = readinessPercent(readiness)

  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="label-mono">
          {readiness.ready
            ? "Ready"
            : `${readiness.errorsResolved} of ${readiness.errorsTotal} resolved`}
        </span>
        <span className="tabular font-mono text-[12px] text-[var(--color-ink-3)]">{percent}%</span>
      </div>
      <div
        className="h-[3px] w-full overflow-hidden rounded-full bg-[var(--color-rule-2)]"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Channel readiness"
      >
        <div
          className={`h-full transition-[width] ${
            readiness.ready ? "bg-[var(--color-ok)]" : "bg-[var(--color-accent)]"
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}
