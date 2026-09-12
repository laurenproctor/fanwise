"use client"

import { useState } from "react"
import { FIELD_INPUT_CLASS } from "@/components/ui/field"
import { CUSTOM_LICENSE_ID, LICENSE_PRESETS, customLicense } from "@/lib/imports/deliverables"
import type { ImportReadiness, ImportStep, ImportStepKey } from "@/lib/imports/readiness"
import type { BuyerDeliverable, LicenseSelection } from "@/lib/imports/types"

/**
 * The actionable half of readiness: what is left, and the control to do it.
 *
 * The progress track above is the authoritative summary; this is the detail,
 * and both read the same `ImportReadiness`.
 *
 * **Which rows appear is a rule about where a step is done, not about whether
 * it is done.** Buyer files, the license and the ownership confirmation have
 * their controls here and nowhere else, so they stay listed after they are
 * satisfied — marked done, with the control still reachable. Hiding a finished
 * row would take the only way to change a license back with it, which is a
 * trap the e2e suite walked into before anybody else could. The source and the
 * listing are acted on further up the page, so those two appear only while they
 * are blocking and point at the region that owns them.
 *
 * Exactly one row is marked `Next step`, and it is `readiness.nextStep`: the
 * first incomplete step, so there can never be two. Every other incomplete row
 * is marked `Required`, because each one blocks.
 */

/**
 * The steps whose only control lives in this list.
 *
 * They stay listed once done, because the control is how a creator changes
 * their mind and there is nowhere else to do it. The other two are edited in
 * the source panel and the draft form, so a row for them is a signpost and
 * belongs only while the sign is needed.
 */
const ACTIONABLE_HERE: readonly ImportStepKey[] = ["buyerFiles", "license", "ownership"]

export interface ChecklistHandlers {
  onFilesChosen: (files: readonly { name: string; size: number }[]) => void
  onLicenseChosen: (license: LicenseSelection | null) => void
  onOwnershipConfirmed: () => void
  /** Where a source or listing row sends the creator. An in-page anchor. */
  anchors: Record<ImportStepKey, string | null>
}

export function CompletionChecklist({
  readiness,
  deliverables,
  license,
  handlers,
}: {
  readiness: ImportReadiness
  deliverables: readonly BuyerDeliverable[]
  license: LicenseSelection | null
  handlers: ChecklistHandlers
}) {
  const listed = readiness.steps.filter(
    (step) => ACTIONABLE_HERE.includes(step.key) || !step.complete,
  )

  return (
    <section
      aria-labelledby="import-checklist-heading"
      className="flex flex-col gap-4 border-t border-[var(--color-rule)] pt-6"
    >
      <div className="flex flex-col gap-1">
        <h2
          id="import-checklist-heading"
          className="font-display text-[20px] font-light tracking-[-0.02em]"
        >
          Complete your listing
        </h2>
        <p className="label-mono" role="status" aria-live="polite">
          {readiness.ready
            ? "Nothing left. Every required item is done."
            : `${readiness.remaining} required item${readiness.remaining === 1 ? "" : "s"} remaining`}
        </p>
      </div>

      {listed.length === 0 ? null : (
        <ul className="flex flex-col divide-y divide-[var(--color-rule-2)]">
          {listed.map((step) => (
            <ChecklistRow
              key={step.key}
              step={step}
              isNext={readiness.nextStep === step.key}
              deliverables={deliverables}
              license={license}
              handlers={handlers}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function ChecklistRow({
  step,
  isNext,
  deliverables,
  license,
  handlers,
}: {
  step: ImportStep
  isNext: boolean
  deliverables: readonly BuyerDeliverable[]
  license: LicenseSelection | null
  handlers: ChecklistHandlers
}) {
  return (
    <li
      aria-current={isNext ? "step" : undefined}
      className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:gap-4"
    >
      <span
        aria-hidden
        className={`mt-0.5 hidden h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] sm:grid ${
          step.complete
            ? "border-[var(--color-ok)] bg-[var(--color-ok)] text-[var(--color-on-action)]"
            : "border-[var(--color-rule)]"
        }`}
      >
        {step.complete ? "✓" : ""}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[15px] font-medium text-[var(--color-ink)]">{step.action}</span>
          {/*
            Both words on a blocker, never one or the other. "Next step" says
            where to start and "Required" says it blocks, and a row that is both
            needs to say both: a creator who reads only "Next step" has no idea
            it is not optional.
          */}
          {step.complete ? (
            <span className="rounded-[var(--radius-pill)] border border-[var(--color-ok)] px-2 py-[3px] font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink)]">
              Done
            </span>
          ) : (
            <>
              {isNext ? (
                <span className="rounded-[var(--radius-pill)] border border-[var(--color-ink)] px-2 py-[3px] font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink)]">
                  Next step
                </span>
              ) : null}
              <span className="rounded-[var(--radius-pill)] border border-[var(--color-bad)] px-2 py-[3px] font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink)]">
                Required
              </span>
            </>
          )}
        </span>
        <span className="text-[13px] leading-[1.5] text-[var(--color-ink-2)]">
          {step.description}
        </span>
        {step.blockedBy ? (
          <span className="text-[13px] leading-[1.5] text-[var(--color-ink)]">
            {step.blockedBy}
          </span>
        ) : null}
        <RowControl step={step} deliverables={deliverables} license={license} handlers={handlers} />
      </span>
    </li>
  )
}

function RowControl({
  step,
  deliverables,
  license,
  handlers,
}: {
  step: ImportStep
  deliverables: readonly BuyerDeliverable[]
  license: LicenseSelection | null
  handlers: ChecklistHandlers
}) {
  switch (step.key) {
    case "buyerFiles":
      return (
        <BuyerFilesControl deliverables={deliverables} onFilesChosen={handlers.onFilesChosen} />
      )
    case "license":
      return <LicenseControl license={license} onLicenseChosen={handlers.onLicenseChosen} />
    case "ownership":
      return <OwnershipControl onConfirm={handlers.onOwnershipConfirmed} />
    default: {
      const anchor = handlers.anchors[step.key]
      if (!anchor) return null
      return (
        <a
          href={anchor}
          className="mt-1 inline-flex min-h-11 items-center self-start text-[14px] font-medium text-[var(--color-accent)] underline underline-offset-4 hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--color-accent)]"
        >
          Go to {step.label.toLowerCase()}
        </a>
      )
    }
  }
}

function BuyerFilesControl({
  deliverables,
  onFilesChosen,
}: {
  deliverables: readonly BuyerDeliverable[]
  onFilesChosen: ChecklistHandlers["onFilesChosen"]
}) {
  return (
    <div className="mt-2 flex flex-col gap-2">
      {/*
        A label around the input rather than a button that clicks a hidden one:
        a real file input keeps the keyboard behaviour and the accessible name
        the browser already gives it.
      */}
      <label className="inline-flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--color-action)] bg-[var(--color-action)] px-[18px] text-[14px] font-medium text-[var(--color-on-action)] transition-colors hover:bg-[var(--color-action-hover)] focus-within:outline-2 focus-within:outline-offset-3 focus-within:outline-[var(--color-accent)]">
        <span>Upload files</span>
        <input
          type="file"
          multiple
          className="sr-only"
          onChange={(event) => {
            const chosen = Array.from(event.target.files ?? []).map((file) => ({
              name: file.name,
              size: file.size,
            }))
            if (chosen.length > 0) onFilesChosen(chosen)
          }}
        />
      </label>
      {deliverables.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {deliverables.map((file) => (
            <li key={file.id} className="text-[13px] text-[var(--color-ink-2)]">
              {file.filename}
              {/*
                Said plainly. Nothing has weighed these bytes on a server yet,
                and a row that read as confirmed would be the screen claiming a
                measurement it did not take.
              */}
              <span className="ml-2 font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--color-ink-3)]">
                Not verified yet
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function LicenseControl({
  license,
  onLicenseChosen,
}: {
  license: LicenseSelection | null
  onLicenseChosen: ChecklistHandlers["onLicenseChosen"]
}) {
  const [own, setOwn] = useState(license?.id === CUSTOM_LICENSE_ID)
  const [text, setText] = useState(license?.id === CUSTOM_LICENSE_ID ? license.summary : "")

  return (
    <div className="mt-2 flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2">
        <legend className="label-mono mb-1">Choose a license</legend>
        {LICENSE_PRESETS.map((preset) => (
          <label key={preset.id} className="flex cursor-pointer items-start gap-2.5 text-[14px]">
            <input
              type="radio"
              name="import-license"
              value={preset.id}
              checked={license?.id === preset.id}
              onChange={() => {
                setOwn(false)
                onLicenseChosen(preset)
              }}
              className="mt-1 accent-[var(--color-accent)]"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-[var(--color-ink)]">{preset.name}</span>
              <span className="text-[13px] leading-[1.45] text-[var(--color-ink-2)]">
                {preset.summary}
              </span>
            </span>
          </label>
        ))}
        <label className="flex cursor-pointer items-start gap-2.5 text-[14px]">
          <input
            type="radio"
            name="import-license"
            value={CUSTOM_LICENSE_ID}
            checked={own}
            onChange={() => {
              setOwn(true)
              onLicenseChosen(text.trim().length > 0 ? customLicense(text) : null)
            }}
            className="mt-1 accent-[var(--color-accent)]"
          />
          <span className="text-[var(--color-ink)]">Write my own terms</span>
        </label>
      </fieldset>

      {own ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="import-license-summary" className="label-mono">
            Your terms
          </label>
          <textarea
            id="import-license-summary"
            rows={3}
            value={text}
            maxLength={2000}
            onChange={(event) => {
              setText(event.target.value)
              onLicenseChosen(
                event.target.value.trim().length > 0 ? customLicense(event.target.value) : null,
              )
            }}
            placeholder="Say what a buyer may and may not do."
            className={`${FIELD_INPUT_CLASS} resize-y leading-[1.6]`}
          />
        </div>
      ) : null}
    </div>
  )
}

function OwnershipControl({ onConfirm }: { onConfirm: () => void }) {
  return (
    <div className="mt-2 flex flex-col gap-2">
      <p className="max-w-prose text-[13px] leading-[1.55] text-[var(--color-ink-2)]">
        Confirm you made this, or that you hold the rights to sell it. Fanwise records who confirmed
        and when.
      </p>
      <button
        type="button"
        onClick={onConfirm}
        className="inline-flex min-h-11 w-fit items-center rounded-[var(--radius-pill)] border border-[var(--color-ink)] px-[18px] text-[14px] font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-paper-2)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--color-accent)]"
      >
        I have the right to sell this
      </button>
    </div>
  )
}
