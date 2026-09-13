"use client"

import type { SourceSummary } from "@/lib/imports/view"
import { SOURCE_TYPE_LABELS } from "@/lib/imports/view"
import { SourceGlyph } from "./composer/source-pill"

/**
 * Every source of this import, and what became of each.
 *
 * Compact on purpose: this is where a creator learns that the PDF was read and
 * the link was not, not a console of jobs. A source that failed says why in
 * Fanwise's words, and offers "Try again" only when trying again could change
 * the answer.
 */

const DOT: Record<SourceSummary["tone"], string> = {
  ok: "bg-[var(--color-ok)]",
  busy: "bg-[var(--color-accent)]",
  bad: "bg-[var(--color-bad)]",
}

export function SourcesSection({
  sources,
  onRetry,
}: {
  sources: readonly SourceSummary[]
  onRetry: (sourceId: string) => void
}) {
  if (sources.length === 0) return null

  return (
    <section aria-labelledby="import-sources-heading" className="flex flex-col gap-2">
      <h2 id="import-sources-heading" className="label-mono">
        {sources.length === 1 ? "Your source" : `Your sources · ${sources.length}`}
      </h2>
      <ul className="flex flex-col divide-y divide-[var(--color-rule-2)] rounded-[16px] border border-[var(--color-rule)] bg-[var(--color-card)]">
        {sources.map((source) => (
          <li key={source.id} className="flex flex-col gap-1 px-4 py-3">
            <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <SourceGlyph type={source.type} />
              <span
                className="min-w-0 flex-1 truncate text-[14px] text-[var(--color-ink)]"
                title={source.label}
              >
                {source.label}
              </span>
              <span className="label-mono">{SOURCE_TYPE_LABELS[source.type]}</span>
              <span className="flex items-center gap-1.5 text-[13px] text-[var(--color-ink-2)]">
                <span
                  aria-hidden
                  className={`h-[6px] w-[6px] rounded-full ${DOT[source.tone]} ${
                    source.tone === "busy" ? "animate-pulse motion-reduce:animate-none" : ""
                  }`}
                />
                {source.statusWord}
              </span>
              {source.retryable ? (
                <button
                  type="button"
                  onClick={() => onRetry(source.id)}
                  aria-label={`Try ${source.label} again`}
                  className="inline-flex min-h-11 items-center rounded-[6px] px-1 text-[14px] font-medium text-[var(--color-accent)] underline underline-offset-4 hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                >
                  Try again
                </button>
              ) : null}
            </span>
            {source.message ? (
              <p className="pl-7 text-[13px] leading-[1.5] text-[var(--color-ink-2)]">
                {source.message}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
