"use client"

import { useId, useState, useTransition } from "react"
import { FIELD_INPUT_CLASS } from "@/components/ui/field"
import { FormError } from "@/components/ui/form-error"
import {
  CUSTOM_LICENSE_ID,
  LICENSE_CATALOG,
  RIGHTS_ATTESTATION_TEXT,
  RIGHTS_DISCLAIMER,
  THIRD_PARTY_HINT,
  THIRD_PARTY_PROMPT,
} from "@/lib/imports/licenses"
import type { ImportReadiness, ImportStep, ImportStepKey } from "@/lib/imports/readiness"
import { ASSET_STATE_LABELS } from "@/lib/products/types"
import type { BuyerDeliverable, LicenseSelection, RightsAttestation } from "@/lib/imports/types"

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
 *
 * **One row's control is open at a time**, and by default it is the next step's.
 * Every control open at once is three license options, a file picker and an
 * attestation stacked under a heading that says what is left, and the list of
 * what is left stops being readable — which is the one job a checklist has.
 *
 * Which row that is has one rule: the creator's own choice if they have made
 * one, and otherwise the next step. So the list opens on the thing to do
 * without anybody choosing anything, advances as steps are satisfied, and stops
 * moving the moment a creator opens a row themselves.
 *
 * The consequence worth naming: satisfying the open step advances the list, so
 * the control that satisfied it collapses. That is the intended reading — the
 * row keeps a `Done` badge, it is one chevron from being reopened, and the
 * alternative is a `Next step` badge pointing at one row while a finished one
 * sits open below it.
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
  /** Uploads through the pipeline the product page already uses. */
  onFilesChosen: (files: readonly File[]) => Promise<string | null>
  onRemoveFile: (assetId: string) => Promise<string | null>
  onLicenseChosen: (licenseId: string, customSummary: string | null) => Promise<string | null>
  onOwnershipConfirmed: (thirdPartyComponents: string | null) => Promise<string | null>
  onOwnershipWithdrawn: () => Promise<string | null>
  /** Where a source or listing row sends the creator. An in-page anchor. */
  anchors: Record<ImportStepKey, string | null>
}

export function CompletionChecklist({
  readiness,
  deliverables,
  license,
  rights,
  handlers,
}: {
  readiness: ImportReadiness
  deliverables: readonly BuyerDeliverable[]
  license: LicenseSelection | null
  rights: RightsAttestation | null
  handlers: ChecklistHandlers
}) {
  const listed = readiness.steps.filter(
    (step) => ACTIONABLE_HERE.includes(step.key) || !step.complete,
  )

  const [opened, setOpened] = useState<ImportStepKey | null>(null)
  const openKey = opened ?? readiness.nextStep

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
              isOpen={openKey === step.key}
              onToggle={() => setOpened(openKey === step.key ? null : step.key)}
              deliverables={deliverables}
              license={license}
              rights={rights}
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
  isOpen,
  onToggle,
  deliverables,
  license,
  rights,
  handlers,
}: {
  step: ImportStep
  isNext: boolean
  isOpen: boolean
  onToggle: () => void
  deliverables: readonly BuyerDeliverable[]
  license: LicenseSelection | null
  rights: RightsAttestation | null
  handlers: ChecklistHandlers
}) {
  const panelId = useId()
  const hasPanel = ACTIONABLE_HERE.includes(step.key)

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
        {hasPanel && !isOpen ? null : (
          <div id={hasPanel ? panelId : undefined}>
            <RowControl
              step={step}
              deliverables={deliverables}
              license={license}
              rights={rights}
              handlers={handlers}
            />
          </div>
        )}
      </span>

      {hasPanel ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          aria-controls={panelId}
          /*
            Named for the step, not "Expand". A column of identical toggles is a
            column a screen reader user cannot tell apart, which is the same
            mistake as an unlabelled icon one step later.
          */
          aria-label={`${isOpen ? "Hide" : "Show"} ${step.action.toLowerCase()}`}
          className="ml-auto inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--color-ink-2)] transition-colors hover:bg-[var(--color-paper-2)] hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        >
          <ChevronGlyph open={isOpen} />
        </button>
      ) : null}
    </li>
  )
}

function ChevronGlyph({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={open ? "rotate-180" : ""}
    >
      <path
        d="m4 6 4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function RowControl({
  step,
  deliverables,
  license,
  rights,
  handlers,
}: {
  step: ImportStep
  deliverables: readonly BuyerDeliverable[]
  license: LicenseSelection | null
  rights: RightsAttestation | null
  handlers: ChecklistHandlers
}) {
  switch (step.key) {
    case "buyerFiles":
      return <BuyerFilesControl deliverables={deliverables} handlers={handlers} />
    case "license":
      return <LicenseControl license={license} handlers={handlers} />
    case "ownership":
      return <OwnershipControl rights={rights} handlers={handlers} />
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

/**
 * The files buyers receive.
 *
 * Uploads run through exactly the pipeline the product page uses: the server
 * mints a signed URL, the browser pushes the bytes straight to storage, and a
 * job measures what actually landed. Nothing the browser claims about a file
 * survives that, which is why a row is not `ready` until the job has been.
 *
 * **Replacing is additive, and that is what makes it safe.** A new file is
 * uploaded beside the old one, and the old one cannot be removed while it is
 * the only measured file — the server refuses. So a replacement that fails
 * leaves the original exactly where it was, without anything having to
 * remember to put it back.
 *
 * A source link never counts here. `readiness.ts` measures `ready` deliverable
 * rows and nothing else, so a public demo cannot satisfy this step however
 * complete the rest of the import looks.
 */
function BuyerFilesControl({
  deliverables,
  handlers,
}: {
  deliverables: readonly BuyerDeliverable[]
  handlers: ChecklistHandlers
}) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pending, startTransition] = useTransition()
  const hasReady = deliverables.some((file) => file.state === "ready")

  return (
    <div className="mt-2 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {/*
          A label around the input rather than a button that clicks a hidden
          one: a real file input keeps the keyboard behaviour and the accessible
          name the browser already gives it.
        */}
        <label
          className={`inline-flex min-h-11 w-fit items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--color-action)] bg-[var(--color-action)] px-[18px] text-[14px] font-medium text-[var(--color-on-action)] transition-colors hover:bg-[var(--color-action-hover)] focus-within:outline-2 focus-within:outline-offset-3 focus-within:outline-[var(--color-accent)] ${
            busy || pending ? "cursor-wait opacity-70" : "cursor-pointer"
          }`}
        >
          <span>
            {busy ? "Uploading\u2026" : hasReady ? "Upload a replacement" : "Upload files"}
          </span>
          <input
            type="file"
            multiple
            disabled={busy || pending}
            className="sr-only"
            onChange={(event) => {
              const chosen = Array.from(event.target.files ?? [])
              event.target.value = ""
              if (chosen.length === 0) return
              setError(null)
              setBusy(true)
              void handlers.onFilesChosen(chosen).then((message) => {
                setBusy(false)
                setError(message)
              })
            }}
          />
        </label>
        {hasReady ? (
          <span className="text-[13px] text-[var(--color-ink-2)]">
            The new file is added beside this one. Remove the old one once it is ready.
          </span>
        ) : null}
      </div>

      <FormError message={error} />

      {deliverables.length > 0 ? (
        <ul className="flex flex-col divide-y divide-[var(--color-rule-2)]">
          {deliverables.map((file) => (
            <li key={file.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="min-w-0 flex-1 truncate text-[14px] text-[var(--color-ink)]">
                {file.filename}
              </span>
              <span className="tabular font-mono text-[12px] text-[var(--color-ink-3)]">
                {formatBytes(file.byteSize)}
              </span>
              <FileState state={file.state} />
              <button
                type="button"
                disabled={pending}
                /*
                  Named for its file. A column of identical "Remove" buttons is
                  a column a screen reader user cannot tell apart, which is the
                  same mistake as an unlabelled icon one step later.
                */
                aria-label={`Remove ${file.filename}`}
                onClick={() => {
                  setError(null)
                  startTransition(() => {
                    void handlers.onRemoveFile(file.id).then(setError)
                  })
                }}
                className="min-h-11 rounded-[6px] text-[13px] text-[var(--color-ink-2)] underline underline-offset-4 hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--color-accent)]"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/** The three states a stored file can be in, as a word and a shape. */
function FileState({ state }: { state: BuyerDeliverable["state"] }) {
  const tone =
    state === "ready"
      ? "border-[var(--color-ok)] text-[var(--color-ok)]"
      : state === "failed"
        ? "border-[var(--color-bad)] text-[var(--color-ink)]"
        : "border-[var(--color-warn)] text-[var(--color-ink-2)]"

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${tone}`}
    >
      <span aria-hidden className="h-[5px] w-[5px] rounded-full bg-current" />
      {state === "pending" ? "Checking" : ASSET_STATE_LABELS[state]}
    </span>
  )
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "\u2014"
  const units = ["B", "KB", "MB", "GB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

/**
 * Choosing a licence.
 *
 * The catalogue is code and the version is read from it server-side, never sent
 * from here: a version is a claim about which wording Fanwise showed, and a
 * browser that supplied one could record that a creator accepted terms they
 * never saw.
 *
 * **Nothing is inferred from the page.** A source that says "royalty-free" does
 * not preselect anything; the claims check already refuses to let a model write
 * licence terms, and this is the other half of the same rule. A licence is a
 * decision, and the creator makes it here.
 */
function LicenseControl({
  license,
  handlers,
}: {
  license: LicenseSelection | null
  handlers: ChecklistHandlers
}) {
  const [own, setOwn] = useState(license?.id === CUSTOM_LICENSE_ID)
  const [text, setText] = useState(license?.id === CUSTOM_LICENSE_ID ? license.summary : "")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const choose = (licenseId: string, customSummary: string | null) => {
    setError(null)
    startTransition(() => {
      void handlers.onLicenseChosen(licenseId, customSummary).then(setError)
    })
  }

  return (
    <div className="mt-2 flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2" disabled={pending}>
        <legend className="label-mono mb-1">Choose a licence</legend>
        {LICENSE_CATALOG.map((entry) => (
          <label key={entry.id} className="flex cursor-pointer items-start gap-2.5 text-[14px]">
            <input
              type="radio"
              name="import-license"
              value={entry.id}
              checked={license?.id === entry.id}
              onChange={() => {
                setOwn(false)
                choose(entry.id, null)
              }}
              className="mt-1 accent-[var(--color-accent)]"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-[var(--color-ink)]">{entry.name}</span>
              <span className="text-[13px] leading-[1.45] text-[var(--color-ink-3)]">
                {entry.hint}
              </span>
              <span className="text-[13px] leading-[1.45] text-[var(--color-ink-2)]">
                {entry.summary}
              </span>
            </span>
          </label>
        ))}
        <label className="flex cursor-pointer items-start gap-2.5 text-[14px]">
          <input
            type="radio"
            name="import-license"
            value={CUSTOM_LICENSE_ID}
            checked={own || license?.id === CUSTOM_LICENSE_ID}
            onChange={() => setOwn(true)}
            className="mt-1 accent-[var(--color-accent)]"
          />
          <span className="text-[var(--color-ink)]">Write my own terms</span>
        </label>
      </fieldset>

      {own || license?.id === CUSTOM_LICENSE_ID ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="import-license-summary" className="label-mono">
            Your terms
          </label>
          <textarea
            id="import-license-summary"
            rows={3}
            value={text}
            maxLength={2000}
            onChange={(event) => setText(event.target.value)}
            placeholder="Say what a buyer may and may not do."
            className={`${FIELD_INPUT_CLASS} resize-y leading-[1.6]`}
          />
          <button
            type="button"
            disabled={pending || text.trim().length === 0}
            onClick={() => choose(CUSTOM_LICENSE_ID, text)}
            className="inline-flex min-h-11 w-fit items-center rounded-[var(--radius-pill)] border border-[var(--color-ink)] px-[18px] text-[14px] font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-paper-2)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Use these terms
          </button>
        </div>
      ) : null}

      {license?.version ? (
        <p className="text-[13px] text-[var(--color-ink-3)]">
          Recorded as {license.name}, version {license.version}.
        </p>
      ) : null}

      <FormError message={error} />
    </div>
  )
}

/**
 * The creator's statement about rights, and the second disclosure beside it.
 *
 * Two questions asked together because they are answered together, and recorded
 * together: who said it, when, which wording, and what they declared. The user
 * id comes from the session rather than the form.
 *
 * `RIGHTS_DISCLAIMER` is rendered every time and is not decoration. Fanwise is
 * collecting a statement, not making a determination, and the place to say so
 * is where the statement is made.
 */
function OwnershipControl({
  rights,
  handlers,
}: {
  rights: RightsAttestation | null
  handlers: ChecklistHandlers
}) {
  const [agreed, setAgreed] = useState(rights !== null)
  const [components, setComponents] = useState(rights?.thirdPartyComponents ?? "")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (rights) {
    return (
      <div className="mt-2 flex flex-col gap-2">
        <p className="max-w-prose text-[14px] leading-[1.55] text-[var(--color-ink)]">
          “{RIGHTS_ATTESTATION_TEXT}”
        </p>
        <p className="text-[13px] text-[var(--color-ink-3)]">
          Recorded {new Date(rights.attestedAt).toISOString().slice(0, 10)}, wording{" "}
          {rights.attestationVersion}.
          {rights.thirdPartyComponents
            ? ` Third-party components declared: ${rights.thirdPartyComponents}`
            : rights.thirdPartyDeclaredAt
              ? " You declared no third-party components."
              : ""}
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null)
            startTransition(() => {
              void handlers.onOwnershipWithdrawn().then(setError)
            })
          }}
          className="min-h-11 w-fit rounded-[6px] text-[13px] text-[var(--color-ink-2)] underline underline-offset-4 hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--color-accent)]"
        >
          Withdraw this statement
        </button>
        <FormError message={error} />
      </div>
    )
  }

  return (
    <div className="mt-2 flex flex-col gap-3">
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(event) => setAgreed(event.target.checked)}
          className="mt-1 accent-[var(--color-accent)]"
        />
        <span className="max-w-prose text-[14px] leading-[1.55] text-[var(--color-ink)]">
          {RIGHTS_ATTESTATION_TEXT}
        </span>
      </label>

      <div className="flex flex-col gap-2">
        <label htmlFor="import-third-party" className="text-[14px] text-[var(--color-ink)]">
          {THIRD_PARTY_PROMPT}
        </label>
        <textarea
          id="import-third-party"
          rows={2}
          value={components}
          maxLength={4000}
          aria-describedby="import-third-party-hint"
          onChange={(event) => setComponents(event.target.value)}
          placeholder="Inter (SIL Open Font License), photos from Unsplash…"
          className={`${FIELD_INPUT_CLASS} resize-y leading-[1.6]`}
        />
        <span id="import-third-party-hint" className="text-[13px] text-[var(--color-ink-3)]">
          {THIRD_PARTY_HINT}
        </span>
      </div>

      <p className="max-w-prose text-[13px] leading-[1.55] text-[var(--color-ink-3)]">
        {RIGHTS_DISCLAIMER}
      </p>

      <button
        type="button"
        disabled={!agreed || pending}
        onClick={() => {
          setError(null)
          startTransition(() => {
            void handlers
              .onOwnershipConfirmed(components.trim().length > 0 ? components : null)
              .then(setError)
          })
        }}
        className="inline-flex min-h-11 w-fit items-center rounded-[var(--radius-pill)] border border-[var(--color-ink)] px-[18px] text-[14px] font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-paper-2)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        Confirm and continue
      </button>
      <FormError message={error} />
    </div>
  )
}
