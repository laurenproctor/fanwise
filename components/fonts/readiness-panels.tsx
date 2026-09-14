"use client"

import { FONT_SECTIONS, FONT_SECTION_LABELS, type FontSection } from "@/lib/fonts/workspace"
import { scopeText, type FontReadiness, type ReadinessRule } from "@/lib/fonts/readiness"
import { StatusIcon, STATUS_TEXT } from "./controls"

/**
 * The left column: the seven sections, each with its state, and how ready the
 * listing is overall.
 *
 * A list of buttons rather than links. Choosing a section swaps the editor in
 * place and records the choice in the URL with `replaceState`, so it neither
 * reloads nor stacks a history entry per click; the address still reopens the
 * same section.
 */
export function SectionNav({
  current,
  readiness,
  onSelect,
}: {
  current: FontSection
  readiness: FontReadiness
  onSelect: (section: FontSection) => void
}) {
  const needsWork = readiness.issues.filter((rule) => rule.severity !== "optional").length

  return (
    <div className="flex flex-col gap-8">
      <nav aria-label="Listing sections" className="flex flex-col gap-3">
        <h2 className="label-mono">Listing</h2>
        <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
          {FONT_SECTIONS.map((section) => {
            const active = section === current
            const status = readiness.sections[section]
            return (
              <li key={section} className="shrink-0">
                <button
                  type="button"
                  aria-current={active ? "true" : undefined}
                  onClick={() => onSelect(section)}
                  className={`relative flex w-full min-h-10 items-center gap-3 rounded-[8px] px-3 text-left text-[14.5px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)] ${
                    active
                      ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] before:absolute before:inset-y-1.5 before:left-0 before:w-[2px] before:rounded-full before:bg-[var(--color-accent)]"
                      : "text-[var(--color-ink)] hover:bg-[var(--color-paper-2)]"
                  }`}
                >
                  <StatusIcon status={status} announce={false} />
                  <span className="whitespace-nowrap">
                    {FONT_SECTION_LABELS[section]}
                    <span className="sr-only"> ({STATUS_TEXT[status].toLowerCase()})</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      <section
        aria-labelledby="font-readiness-heading"
        className="hidden flex-col gap-2.5 border-t border-[var(--color-rule)] pt-5 lg:flex"
      >
        <h2 id="font-readiness-heading" className="label-mono">
          Listing readiness
        </h2>
        <p className="font-display text-[22px] font-light tracking-[-0.02em] tabular-nums">
          {readiness.percent}% ready
        </p>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={readiness.percent}
          aria-label="Listing readiness"
          className="h-2 overflow-hidden rounded-full bg-[var(--color-rule-2)]"
        >
          <div
            className="h-full rounded-full bg-[var(--color-accent)] transition-[width] motion-reduce:transition-none"
            style={{ width: `${readiness.percent}%` }}
          />
        </div>
        <p className="text-[13.5px] text-[var(--color-ink-2)]">
          {readiness.blockingAll.length > 0
            ? `${readiness.blockingAll.length} ${readiness.blockingAll.length === 1 ? "detail blocks" : "details block"} publishing.`
            : needsWork > 0
              ? `${needsWork} ${needsWork === 1 ? "detail needs" : "details need"} attention.`
              : "Everything is in place."}
        </p>
      </section>
    </div>
  )
}

const RULE_STATUS: Record<ReadinessRule["severity"], "error" | "attention" | "incomplete"> = {
  blocker: "error",
  attention: "attention",
  optional: "incomplete",
}

/**
 * Under the preview: the verdict, then every open issue as a way to fix it.
 *
 * Each issue says what is wrong, what it blocks, and opens the field that fixes
 * it. Optional recommendations are listed after the rest and collapsed, so a
 * suggestion never reads as a reason the button is disabled.
 */
export function ReadinessIssues({
  readiness,
  publishBlockedReason,
  onOpen,
}: {
  readiness: FontReadiness
  /**
   * Why Publish is disabled, from the same decision the button makes. The
   * verdict here never says "ready" beside a button that is not: a product can
   * clear every rule of its own while every connected channel still refuses it.
   */
  publishBlockedReason: string | null
  onOpen: (rule: ReadinessRule) => void
}) {
  const required = readiness.issues.filter((rule) => rule.severity !== "optional")
  const optional = readiness.issues.filter((rule) => rule.severity === "optional")
  const blocked = readiness.blockingAll.length > 0
  const unavailable = blocked || publishBlockedReason !== null

  return (
    <section
      aria-labelledby="font-issues-heading"
      className="flex flex-col gap-3 border-t border-[var(--color-rule)] pt-5"
    >
      <div className="flex items-start gap-3">
        <StatusIcon
          status={unavailable ? "error" : required.length > 0 ? "attention" : "complete"}
          size={24}
        />
        <div className="flex flex-col gap-0.5">
          <h2 id="font-issues-heading" className="label-mono">
            {unavailable ? "Not ready to publish" : "Ready to publish"}
          </h2>
          <p className="text-[14px] text-[var(--color-ink-2)]">
            {blocked
              ? "Fix the items marked as blocking and Publish becomes available."
              : publishBlockedReason
                ? `${publishBlockedReason} Each channel’s own blockers are listed below.`
                : required.length > 0
                  ? "Publishing is available. These details are still worth fixing."
                  : "Every required detail is in place."}
          </p>
        </div>
      </div>

      {required.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {required.map((rule) => (
            <IssueItem key={rule.key} rule={rule} onOpen={onOpen} />
          ))}
        </ul>
      ) : null}

      {optional.length > 0 ? (
        <details className="group">
          <summary className="cursor-pointer text-[13.5px] text-[var(--color-ink-2)] hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]">
            {optional.length} optional {optional.length === 1 ? "suggestion" : "suggestions"}
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {optional.map((rule) => (
              <IssueItem key={rule.key} rule={rule} onOpen={onOpen} />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  )
}

function IssueItem({
  rule,
  onOpen,
}: {
  rule: ReadinessRule
  onOpen: (rule: ReadinessRule) => void
}) {
  const status = RULE_STATUS[rule.severity]
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(rule)}
        className="group/issue flex w-full items-start gap-3 rounded-[8px] px-1 py-1.5 text-left hover:bg-[var(--color-paper-2)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)]"
      >
        <StatusIcon status={status} size={20} announce={false} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1 text-[14px] underline decoration-[var(--color-rule)] underline-offset-4 group-hover/issue:decoration-[var(--color-ink)]">
            {rule.label}
            <span aria-hidden className="text-[var(--color-ink-3)]">
              ›
            </span>
          </span>
          <span className="text-[12.5px] text-[var(--color-ink-3)]">
            {rule.message} <span className="text-[var(--color-ink-2)]">{scopeText(rule)}.</span>
          </span>
        </span>
        <span className="sr-only">
          {rule.severity === "optional" ? "Optional" : STATUS_TEXT[status]}. Opens{" "}
          {FONT_SECTION_LABELS[rule.section]}.
        </span>
      </button>
    </li>
  )
}

/** The collapsed rows under the editor: every other section at a glance. */
export function SectionSummaries({
  current,
  readiness,
  summaries,
  onSelect,
}: {
  current: FontSection
  readiness: FontReadiness
  summaries: Record<FontSection, string>
  onSelect: (section: FontSection) => void
}) {
  return (
    <nav aria-label="Other sections" className="border-t border-[var(--color-rule)]">
      <ul className="flex flex-col divide-y divide-[var(--color-rule-2)]">
        {FONT_SECTIONS.filter((section) => section !== current).map((section) => (
          <li key={section}>
            <button
              type="button"
              onClick={() => onSelect(section)}
              className="grid w-full grid-cols-[1rem_minmax(0,11rem)_minmax(0,1fr)_auto] items-center gap-3 py-2.5 text-left hover:bg-[var(--color-paper-2)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-accent)]"
            >
              <span aria-hidden className="text-[var(--color-ink-3)]">
                ›
              </span>
              <span className="text-[14.5px]">{FONT_SECTION_LABELS[section]}</span>
              <span className="truncate text-[13px] text-[var(--color-ink-3)]">
                {summaries[section]}
              </span>
              <StatusIcon status={readiness.sections[section]} />
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
