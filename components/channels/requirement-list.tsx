import type { RequirementResult } from "@/lib/channels/types"

/**
 * The requirement list is the part a creator can act on, so unsatisfied rules
 * come first and each one says what is wrong rather than that something is.
 */
export function RequirementList({ results }: { results: RequirementResult[] }) {
  if (results.length === 0) return null

  const ordered = [...results].sort((a, b) => Number(a.satisfied) - Number(b.satisfied))

  return (
    <ul className="grid gap-2.5">
      {ordered.map((result) => (
        <li key={result.key} className="flex items-start gap-2.5">
          <span
            aria-hidden
            className={`mt-[6px] h-[6px] w-[6px] shrink-0 rounded-full ${
              result.satisfied
                ? "bg-[var(--color-ok)]"
                : result.severity === "error"
                  ? "bg-[var(--color-bad)]"
                  : "bg-[var(--color-warn)]"
            }`}
          />
          <span className="grid gap-0.5">
            <span className="text-[13.5px] text-[var(--color-ink)]">
              {result.label}
              {!result.satisfied && result.severity === "warning" ? (
                <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
                  optional
                </span>
              ) : null}
            </span>
            {!result.satisfied && result.message ? (
              <span className="text-[13px] text-[var(--color-ink-2)]">{result.message}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  )
}
