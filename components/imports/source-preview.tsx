import { OBSERVATION_ORIGIN_LABELS, type SourceSnapshot } from "@/lib/imports/types"
import { SOURCE_LABELS } from "@/lib/imports/sources/registry"

/**
 * What Fanwise found at the link, and the evidence for it.
 *
 * **Nothing here is a live rendering of the source, and nothing here loads a
 * remote image.** Two reasons, and both are load-bearing rather than
 * incidental:
 *
 *   - Imported third-party code must never execute in the authenticated
 *     Fanwise origin. There is no iframe, no `dangerouslySetInnerHTML`, no
 *     `eval`. The production CSP is already `frame-src 'none'` and
 *     `object-src 'none'`, so an iframe would not render either — this is the
 *     half of that rule that lives in the code, so nobody later widens the
 *     policy to "fix" a blank box.
 *   - `img-src` admits this origin, `data:`, `blob:` and the storage host. A
 *     remote `og:image` is a URL a stranger chose, and it is fetched
 *     server-side into `product_assets` when ingestion is wired, then served
 *     from storage like every other asset.
 *
 * So a tile shows text the reader captured, rendered as text, and says so.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/**
 * The capture date, in UTC.
 *
 * Not `toLocaleDateString`, which answers differently depending on the machine
 * running it, so the same snapshot would render one date in a test and another
 * in a browser an hour away.
 */
export function capturedLabel(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "Unknown date"
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`
}

export function SourcePreview({ snapshot }: { snapshot: SourceSnapshot }) {
  const [hero, ...rest] = snapshot.previews

  return (
    <section aria-labelledby="import-source-heading" className="flex flex-col gap-4">
      <h2 id="import-source-heading" className="label-mono">
        What Fanwise found
      </h2>

      <div className="overflow-hidden rounded-[16px] border border-[var(--color-rule)] bg-[var(--color-card)]">
        {/*
          A dark panel, which is the design system's floating-surface treatment
          and here doubles as a frame: it reads as a captured thing rather than
          as part of the page, which is exactly what it is.
        */}
        <div className="flex min-h-[260px] flex-col justify-center gap-4 bg-[var(--color-panel)] px-7 py-10 sm:px-10 sm:py-14">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-on-dark-2)]">
            Captured text
          </p>
          <p className="font-display text-[clamp(1.75rem,3.4vw,2.75rem)] font-light leading-[1.12] tracking-[-0.03em] text-balance text-[var(--color-on-dark)]">
            {snapshot.title ?? "This page did not give a title."}
          </p>
          {hero?.caption ? (
            <p className="max-w-[46ch] text-[15px] leading-[1.55] text-[var(--color-on-dark-2)]">
              {hero.caption}
            </p>
          ) : null}
        </div>

        {rest.length > 0 ? (
          <ul className="grid grid-cols-1 gap-px border-t border-[var(--color-rule)] bg-[var(--color-rule)] sm:grid-cols-3">
            {rest.map((preview) => (
              <li
                key={preview.id}
                className="flex min-h-[92px] flex-col justify-end gap-1.5 bg-[var(--color-card)] px-4 py-4"
              >
                <span className="label-mono">Also on the page</span>
                <span className="text-[13px] leading-[1.45] text-[var(--color-ink-2)]">
                  {preview.caption ?? preview.alt}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[var(--color-rule)] px-5 py-4">
          <EvidenceItem
            label={SOURCE_LABELS[snapshot.sourceKind]}
            hint="What kind of source this is."
          />
          {snapshot.facts.map((fact) => (
            <EvidenceItem
              key={fact.id}
              label={fact.label}
              hint={`Read from the ${OBSERVATION_ORIGIN_LABELS[fact.origin].toLowerCase()}.`}
            />
          ))}
          <EvidenceItem
            label={`Captured ${capturedLabel(snapshot.capturedAt)}`}
            hint="A snapshot, not a subscription. Fanwise does not re-read this source."
          />
        </ul>
      </div>

      {snapshot.description ? (
        <p className="max-w-prose text-[14px] leading-[1.6] text-[var(--color-ink-2)]">
          {snapshot.description}
        </p>
      ) : null}
    </section>
  )
}

function EvidenceItem({ label, hint }: { label: string; hint: string }) {
  return (
    <li className="flex items-center gap-2">
      <span aria-hidden className="h-[5px] w-[5px] shrink-0 rounded-full bg-[var(--color-ink-3)]" />
      <span className="text-[13px] text-[var(--color-ink-2)]">
        {label}
        <span className="sr-only"> — {hint}</span>
      </span>
    </li>
  )
}
