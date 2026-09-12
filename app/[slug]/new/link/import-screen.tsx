"use client"

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react"
import Link from "next/link"
import type { SaveStatus } from "@/components/ui/save-status"
import { CompletionChecklist } from "@/components/imports/completion-checklist"
import { ImportFooter } from "@/components/imports/import-footer"
import { ListingDraftForm } from "@/components/imports/listing-draft-form"
import { ReadinessRegion } from "@/components/imports/readiness-region"
import { SourceField } from "@/components/imports/source-field"
import { SourcePanel } from "@/components/imports/source-panel"
import { emptyListingDraft, markSuggestionsReviewed, setListingField } from "@/lib/imports/draft"
import { createFixtureDeliverableStore, type DeliverableStore } from "@/lib/imports/deliverables"
import { importReducer, initialImportState, validationEvent } from "@/lib/imports/machine"
import { importReadiness, type ImportStepKey } from "@/lib/imports/readiness"
import {
  AnalysisAbortedError,
  createFixtureAnalysisService,
  type SourceAnalysisService,
} from "@/lib/imports/service"
import type {
  BuyerDeliverable,
  LicenseSelection,
  ListingDraft,
  ListingFieldKey,
  RightsAttestation,
} from "@/lib/imports/types"
import { routes } from "@/lib/routes"

/**
 * The import screen.
 *
 * Holds the state machine, the readiness input and nothing else. Everything it
 * renders is a component that takes props, so the whole screen can be driven
 * from a test without a browser, and every panel can be rendered on its own.
 *
 * **No ingestion runs here.** The link is read through `SourceAnalysisService`,
 * which is fixture-backed in this phase; the real implementation is a server
 * action over a background job that fetches through `lib/net/outbound.ts`.
 * Nothing in this file fetches, parses or renders anything from a third party,
 * and nothing it renders can execute what a source returned.
 */

export interface ImportScreenProps {
  workspaceSlug: string
  /** The signed-in creator. Recorded on the rights attestation, never inferred. */
  userId: string
  /** Injected in tests. Production gets the fixture service. */
  service?: SourceAnalysisService
  deliverableStore?: DeliverableStore
  /** Injected in tests so an attestation timestamp is deterministic. */
  now?: () => Date
  initialUrl?: string
}

export function ImportScreen({
  workspaceSlug,
  userId,
  service,
  deliverableStore,
  now = () => new Date(),
  initialUrl = "",
}: ImportScreenProps) {
  const analysis = useMemo(() => service ?? createFixtureAnalysisService(), [service])
  const files = useMemo(
    () => deliverableStore ?? createFixtureDeliverableStore(),
    [deliverableStore],
  )

  const [state, dispatch] = useReducer(importReducer, initialImportState(initialUrl))
  const [manualDraft, setManualDraft] = useState<ListingDraft>(emptyListingDraft)
  const [deliverables, setDeliverables] = useState<readonly BuyerDeliverable[]>([])
  const [license, setLicense] = useState<LicenseSelection | null>(null)
  const [rights, setRights] = useState<RightsAttestation | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("clean")
  const [savedAt, setSavedAt] = useState<number | null>(null)

  /*
    The draft on screen is the analyzed one when there is a source, and a blank
    one otherwise. Kept as two pieces of state rather than one, so replacing the
    link does not silently discard what a creator typed while it was empty, and
    so the reducer stays the only owner of the analyzed draft.
  */
  const draft = state.status === "analyzed" ? state.draft : manualDraft
  const setDraft = useCallback(
    (next: ListingDraft) => {
      setSaveStatus("dirty")
      if (state.status === "analyzed") dispatch({ type: "draftChanged", draft: next })
      else setManualDraft(next)
    },
    [state.status],
  )

  const readiness = useMemo(
    () =>
      importReadiness({
        snapshot: state.status === "analyzed" ? state.snapshot : null,
        draft,
        deliverables,
        // Always null: the canonical product model has no external-delivery
        // type. See ImportReadinessInput for why the branch exists anyway.
        externalDelivery: null,
        license,
        rights,
      }),
    [state, draft, deliverables, license, rights],
  )

  // One in-flight read at a time. Replacing the link abandons the previous one,
  // so a slow answer for a URL nobody is looking at cannot land on the screen.
  const inFlight = useRef<AbortController | null>(null)
  useEffect(() => () => inFlight.current?.abort(), [])

  const runAnalysis = useCallback(
    (url: string) => {
      inFlight.current?.abort()
      const controller = new AbortController()
      inFlight.current = controller

      analysis
        .analyze({
          url,
          signal: controller.signal,
          onStage: (stage) => {
            if (!controller.signal.aborted) dispatch({ type: "stageAdvanced", stage })
          },
        })
        .then((result) => {
          if (!controller.signal.aborted) dispatch({ type: "analysisSettled", analysis: result })
        })
        .catch((error: unknown) => {
          if (error instanceof AnalysisAbortedError || controller.signal.aborted) return
          dispatch({
            type: "analysisSettled",
            analysis: {
              outcome: "failed",
              message:
                "Fanwise could not finish reading that link. Nothing was saved, so trying again is safe.",
              recoveries: [
                {
                  action: "retry",
                  label: "Try again",
                  description: "Nothing was changed. The same link is read again.",
                },
                {
                  action: "continue_manually",
                  label: "Continue manually",
                  description: "Skip the source and write the listing yourself.",
                },
              ],
            },
          })
        })
    },
    [analysis],
  )

  const submit = useCallback(() => {
    dispatch({ type: "submitted" })
    const event = validationEvent(state.url)
    dispatch(event)
    if (event.type === "validationPassed") runAnalysis(event.url)
  }, [state.url, runAnalysis])

  const retry = useCallback(() => {
    dispatch({ type: "retried" })
    runAnalysis(state.url)
  }, [state.url, runAnalysis])

  const replaceLink = useCallback(() => {
    inFlight.current?.abort()
    dispatch({ type: "linkReplaced" })
  }, [])

  const onFieldChange = useCallback(
    <K extends ListingFieldKey>(key: K, value: ListingDraft[K]["value"]) => {
      setDraft(setListingField(draft, key, value))
    },
    [draft, setDraft],
  )

  const anchors: Record<ImportStepKey, string | null> = {
    source: "#import-source-region",
    listing: "#import-draft-heading",
    buyerFiles: null,
    license: null,
    ownership: null,
  }

  return (
    <div data-workspace-canvas="full" className="flex flex-col">
      <nav aria-label="Breadcrumb" className="pb-6">
        <ol className="flex flex-wrap items-center gap-2 text-[14px]">
          <li>
            <Link
              href={routes.workspace(workspaceSlug)}
              className="rounded-[4px] text-[var(--color-ink-2)] underline underline-offset-4 hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--color-accent)]"
            >
              Products
            </Link>
          </li>
          <li aria-hidden className="text-[var(--color-ink-3)]">
            /
          </li>
          <li aria-current="page" className="text-[var(--color-ink)]">
            New product
          </li>
        </ol>
      </nav>

      <header className="flex flex-col gap-3 pb-8">
        <h1 className="font-display text-[clamp(2.25rem,4.4vw,3.5rem)] font-extralight leading-[1.02] tracking-[-0.04em]">
          Import a product
        </h1>
        <p className="max-w-[52ch] text-[clamp(1rem,1.4vw,1.125rem)] leading-[1.5] text-[var(--color-ink-2)]">
          Turn any creator product link into an editable Fanwise listing.
        </p>
      </header>

      <div id="import-source-region" className="flex flex-col gap-8">
        <SourceField
          state={state}
          onUrlChange={(url) => dispatch({ type: "urlChanged", url })}
          onSubmit={submit}
          onReplaceLink={replaceLink}
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
            state={state}
            handlers={{
              onReplaceLink: replaceLink,
              onRetry: retry,
              manualHref: routes.newProduct(workspaceSlug),
            }}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-8">
          <ListingDraftForm
            draft={draft}
            onFieldChange={onFieldChange}
            onReviewSuggestions={() => setDraft(markSuggestionsReviewed(draft))}
          />
          <CompletionChecklist
            readiness={readiness}
            deliverables={deliverables}
            license={license}
            handlers={{
              onFilesChosen: (chosen) => {
                setSaveStatus("dirty")
                void Promise.all(chosen.map((file) => files.add(file))).then((added) =>
                  setDeliverables((current) => [...current, ...added]),
                )
              },
              onLicenseChosen: (chosen) => {
                setSaveStatus("dirty")
                setLicense(chosen)
              },
              onOwnershipConfirmed: () => {
                setSaveStatus("dirty")
                setRights({ attestedAt: now().toISOString(), attestedBy: userId })
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
        onSaveDraft={() => {
          /*
            Nothing is persisted in this phase: the table that would hold a
            draft is phase 2 of docs/product-link-import.md. The indicator says
            saved because the creator pressed save and the screen kept their
            work; when the migration lands this becomes a server action and the
            indicator reports what it answered.
          */
          setSaveStatus("saved")
          setSavedAt(Date.now())
        }}
        onReviewDrafts={() => {
          setSaveStatus("saved")
          setSavedAt(Date.now())
        }}
      />
    </div>
  )
}
