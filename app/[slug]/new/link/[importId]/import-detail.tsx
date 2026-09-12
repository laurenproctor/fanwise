"use client"

import { useCallback, useEffect, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import type { SaveStatus } from "@/components/ui/save-status"
import { CompletionChecklist } from "@/components/imports/completion-checklist"
import { ImportChrome } from "@/components/imports/import-chrome"
import { ImportFooter } from "@/components/imports/import-footer"
import { ListingDraftForm } from "@/components/imports/listing-draft-form"
import { ReadinessRegion } from "@/components/imports/readiness-region"
import { SourceField } from "@/components/imports/source-field"
import { SourcePanel } from "@/components/imports/source-panel"
import {
  discardImportAction,
  retryImportAction,
  saveImportDraftAction,
} from "@/lib/imports/actions"
import { markSuggestionsReviewed, setListingField } from "@/lib/imports/draft"
import type { ImportState } from "@/lib/imports/machine"
import { importReadiness, type ImportStepKey } from "@/lib/imports/readiness"
import type {
  BuyerDeliverable,
  LicenseSelection,
  ListingDraft,
  ListingFieldKey,
  RightsAttestation,
} from "@/lib/imports/types"
import { routes } from "@/lib/routes"

/**
 * One import, on screen.
 *
 * The server renders the state; this keeps the creator's unsaved edits and asks
 * the server again while the reading is still happening. Everything it renders
 * is a component from the previous phase, taking the same props it always did,
 * so the whole presentation layer is unchanged by the arrival of a real
 * pipeline behind it.
 *
 * **Refreshing never discards an edit, and no effect copies the server into
 * state.** Only the creator's own changes are held here; the value rendered is
 * the server's with those laid over it. So a poll arriving mid-sentence updates
 * the source panel and the readiness and cannot touch the field being typed
 * into, a saved edit stops being an override the moment the server agrees with
 * it, and there is no `useEffect` that could get the precedence wrong.
 */

/** How often to ask again while a read is in flight. */
const POLL_MS = 1_500

export interface ImportDetailProps {
  workspaceSlug: string
  importId: string
  productSlug: string
  state: ImportState
  draft: ListingDraft
  deliverables: readonly BuyerDeliverable[]
  license: LicenseSelection | null
  rights: RightsAttestation | null
  missingInformation: readonly string[]
  withheld: readonly string[]
  /** True when the page was read and no model was configured to draft from it. */
  aiUnavailable: boolean
}

export function ImportDetail(props: ImportDetailProps) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  /*
    Edits, not a copy. `undefined` means "no opinion, use what the server said",
    which is why the license and rights overrides are three-valued: null is a
    real choice a creator can make and has to be distinguishable from silence.
  */
  const [edits, setEdits] = useState<Partial<ListingDraft>>({})
  const [licenseEdit, setLicenseEdit] = useState<LicenseSelection | null | undefined>(undefined)
  const [rightsEdit, setRightsEdit] = useState<RightsAttestation | null | undefined>(undefined)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("clean")
  const [savedAt, setSavedAt] = useState<number | null>(null)

  // Memoized so that the readiness and the handlers below do not see a new
  // object on every render for a draft that has not changed.
  const draft: ListingDraft = useMemo(() => ({ ...props.draft, ...edits }), [props.draft, edits])
  const license = licenseEdit === undefined ? props.license : licenseEdit
  const rights = rightsEdit === undefined ? props.rights : rightsEdit

  const busy = props.state.status === "analyzing"

  /*
    Ask again while the job is working. `router.refresh()` re-runs the server
    component, so the source panel, the evidence and the readiness all arrive
    from the database rather than from a second client-side copy of the rules.
  */
  useEffect(() => {
    if (!busy) return
    const timer = setInterval(() => startTransition(() => router.refresh()), POLL_MS)
    return () => clearInterval(timer)
  }, [busy, router])

  const readiness = useMemo(
    () =>
      importReadiness({
        snapshot: props.state.status === "analyzed" ? props.state.snapshot : null,
        draft,
        deliverables: props.deliverables,
        // Always null: the canonical product model has no external-delivery
        // type. See ImportReadinessInput for why the branch exists anyway.
        externalDelivery: null,
        license,
        rights,
      }),
    [props.state, props.deliverables, draft, license, rights],
  )

  const setDraft = useCallback((next: ListingDraft) => {
    setSaveStatus("dirty")
    setEdits(next)
  }, [])

  const onFieldChange = useCallback(
    <K extends ListingFieldKey>(key: K, value: ListingDraft[K]["value"]) => {
      setDraft(setListingField(draft, key, value))
    },
    [draft, setDraft],
  )

  const save = useCallback(async () => {
    setSaveStatus("saving")
    const accepted: Record<string, { origin: string }> = {}
    for (const key of ["title", "productType", "price", "description", "tags"] as const) {
      const origin = draft[key].origin
      if (origin.kind !== "creator") accepted[key] = { origin: origin.kind }
    }

    const result = await saveImportDraftAction(props.workspaceSlug, props.importId, {
      title: draft.title.value,
      productType: draft.productType.value ?? "other",
      price: draft.price.value,
      currency: draft.currency.value,
      description: draft.description.value,
      accepted,
      licenseSummary: license?.summary ?? null,
      confirmRights: rights !== null,
    })

    if (result.error) {
      setSaveStatus("error")
      return false
    }
    setSaveStatus("saved")
    setSavedAt(Date.now())
    // The server now holds what was typed, so the overrides stop being one.
    setEdits({})
    setLicenseEdit(undefined)
    setRightsEdit(undefined)
    startTransition(() => router.refresh())
    return true
  }, [draft, license, rights, props.workspaceSlug, props.importId, router])

  const anchors: Record<ImportStepKey, string | null> = {
    source: "#import-source-region",
    listing: "#import-draft-heading",
    buyerFiles: null,
    license: null,
    ownership: null,
  }

  return (
    <ImportChrome workspaceSlug={props.workspaceSlug}>
      <div id="import-source-region" className="flex flex-col gap-8">
        <SourceField
          state={props.state}
          onUrlChange={() => {}}
          onSubmit={() => {}}
          onReplaceLink={() => {
            void discardImportAction(props.workspaceSlug, props.importId)
          }}
        />
        <ReadinessRegion readiness={readiness} />
      </div>

      {/*
        Two columns where there is room, one sequence where there is not. The
        source comes first in the source order, because reading what Fanwise
        found before editing what it proposed is the order the screen is about.
      */}
      <div className="mt-10 grid items-start gap-x-12 gap-y-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <SourcePanel
            state={props.state}
            handlers={{
              onReplaceLink: () => {
                void discardImportAction(props.workspaceSlug, props.importId)
              },
              onRetry: () => {
                void retryImportAction(props.workspaceSlug, props.importId).then(() =>
                  startTransition(() => router.refresh()),
                )
              },
              manualHref: routes.product(props.workspaceSlug, props.productSlug),
            }}
          />
          {props.aiUnavailable ? <NoModelNotice /> : null}
          {props.missingInformation.length > 0 ? (
            <MissingInformation items={props.missingInformation} />
          ) : null}
          {props.withheld.length > 0 ? <Withheld fields={props.withheld} /> : null}
        </div>

        <div className="flex min-w-0 flex-col gap-8">
          <ListingDraftForm
            draft={draft}
            onFieldChange={onFieldChange}
            onReviewSuggestions={() => setDraft(markSuggestionsReviewed(draft))}
          />
          <CompletionChecklist
            readiness={readiness}
            deliverables={props.deliverables}
            license={license}
            handlers={{
              onFilesChosen: () => {
                // Uploading a buyer file from this screen is the next phase:
                // it needs a signed upload and a finalize job, which exist, and
                // a place on this screen to report progress, which does not.
                setSaveStatus("dirty")
              },
              onLicenseChosen: (chosen) => {
                setSaveStatus("dirty")
                setLicenseEdit(chosen)
              },
              onOwnershipConfirmed: () => {
                setSaveStatus("dirty")
                /*
                  A local placeholder only. The attestation that counts is
                  written by the save action from the signed-in user id: a
                  browser saying who confirmed is not evidence of anything.
                */
                setRightsEdit({ attestedAt: new Date().toISOString(), attestedBy: "pending-save" })
              },
              anchors,
            }}
          />
        </div>
      </div>

      <ImportFooter
        readiness={readiness}
        saveStatus={saveStatus}
        savedAt={savedAt}
        onSaveDraft={() => void save()}
        onReviewDrafts={() => void save()}
      />
    </ImportChrome>
  )
}

function NoModelNotice() {
  return (
    <section className="flex flex-col gap-2 rounded-[16px] border border-[var(--color-rule)] bg-[var(--color-card)] px-5 py-4">
      <h2 className="label-mono">No draft was composed</h2>
      <p className="text-[14px] leading-[1.55] text-[var(--color-ink-2)]">
        Fanwise read the page and saved what it found, but this deployment has no model configured,
        so nothing was proposed. The details are yours to write, and everything on the left is what
        the page actually said.
      </p>
    </section>
  )
}

function MissingInformation({ items }: { items: readonly string[] }) {
  return (
    <section className="flex flex-col gap-2 rounded-[16px] border border-[var(--color-rule)] bg-[var(--color-card)] px-5 py-4">
      <h2 className="label-mono">What the page did not say</h2>
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2.5">
            <span
              aria-hidden
              className="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full bg-[var(--color-ink-3)]"
            />
            <span className="text-[14px] leading-[1.5] text-[var(--color-ink-2)]">{item}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Fields a model proposed and the claims check refused to offer.
 *
 * Named rather than silently dropped. A creator who sees "Fanwise did not
 * suggest a description" and no reason concludes the feature is broken; one who
 * sees why concludes, correctly, that it was being careful.
 */
function Withheld({ fields }: { fields: readonly string[] }) {
  return (
    <section className="flex flex-col gap-2 rounded-[16px] border border-[var(--color-warn)] bg-[var(--color-card)] px-5 py-4">
      <h2 className="label-mono">Held back</h2>
      <p className="text-[14px] leading-[1.55] text-[var(--color-ink-2)]">
        Fanwise did not offer a suggestion for {fields.join(", ")}, because what it wrote made a
        claim the page does not support — about files, compatibility, licensing, support, ownership
        or resale. Those are yours to state.
      </p>
    </section>
  )
}
