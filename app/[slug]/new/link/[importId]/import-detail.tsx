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
  confirmOwnershipAction,
  discardImportAction,
  removeDeliverableAction,
  replaceSourceAction,
  retryImportAction,
  retrySourceAction,
  reviewMarketplaceDraftsAction,
  saveImportDraftAction,
  setLicenseAction,
  withdrawOwnershipAction,
} from "@/lib/imports/actions"
import { uploadProductFile } from "@/lib/products/upload-client"
import type { EvidenceChange, SourceSummary } from "@/lib/imports/view"
import type { FactConflict } from "@/lib/imports/conflicts"
import { SourcesSection } from "@/components/imports/sources-section"
import { ConflictsSection } from "@/components/imports/conflicts-section"
import { SourceChanges } from "@/components/imports/source-changes"
import { ReplaceSourceDialog } from "@/components/imports/replace-source"
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
  /** The product id, for minting an upload the pipeline already understands. */
  productId: string
  /** What a re-read turned up that the previous reading did not. */
  changes: readonly EvidenceChange[]
  /** A link, or text or a file the creator handed over. */
  sourceMode: "link" | "content"
  /** Whether this import has a link that can be swapped for another. */
  canReplaceLink: boolean
  /** Every source, with its status and any recovery. */
  sources: readonly SourceSummary[]
  /** Facts the readable sources state differently. */
  conflicts: readonly FactConflict[]
}

export function ImportDetail(props: ImportDetailProps) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  /*
    Edits, not a copy. The listing draft is the one thing held here, because it
    is typed continuously and saved in one go. The licence, the files and the
    attestation each write themselves the moment they are chosen, so they are
    read from the server and never mirrored: there is no window in which the
    screen and the database could disagree about them.
  */
  const [edits, setEdits] = useState<Partial<ListingDraft>>({})
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("clean")
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [blocked, setBlocked] = useState<string | null>(null)
  const [replacing, setReplacing] = useState(false)

  // Memoized so that the readiness and the handlers below do not see a new
  // object on every render for a draft that has not changed.
  const draft: ListingDraft = useMemo(() => ({ ...props.draft, ...edits }), [props.draft, edits])
  const license = props.license
  const rights = props.rights

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
    // The server now holds what was typed, so the override stops being one.
    setEdits({})
    startTransition(() => router.refresh())
    return true
  }, [draft, license, rights, props.workspaceSlug, props.importId, router])

  /** Runs a server action, then re-reads, so readiness comes from what is stored. */
  const afterAction = useCallback(
    (message: string | null): string | null => {
      if (message === null) startTransition(() => router.refresh())
      return message
    },
    [router],
  )

  /**
   * One file, through the pipeline the product page already uses.
   *
   * `uploadProductFile` is shared with the asset manager and is the only place
   * in the application where the browser fetches during an upload — a signed
   * URL the server just handed it. The import feature never calls `fetch`
   * itself, and a boundary test holds it to that: the rule being protected is
   * that no browser ever fetches a URL that came out of an imported page.
   */
  const uploadOne = useCallback(
    async (file: File): Promise<string | null> => {
      const result = await uploadProductFile({
        workspaceSlug: props.workspaceSlug,
        productId: props.productId,
        assetType: "deliverable",
        file,
      })
      return result.error
    },
    [props.workspaceSlug, props.productId],
  )

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
          onReplaceLink={() => setReplacing(true)}
          mode={props.sourceMode}
          canReplaceLink={props.canReplaceLink}
        />
        {replacing && props.canReplaceLink ? (
          <ReplaceSourceDialog
            currentUrl={props.state.url}
            onCancel={() => setReplacing(false)}
            onReplace={async (url: string) => {
              const result = await replaceSourceAction(props.workspaceSlug, props.importId, url)
              if (result.error === null) {
                setReplacing(false)
                startTransition(() => router.refresh())
              }
              return result.error
            }}
            onDiscard={() => {
              void discardImportAction(props.workspaceSlug, props.importId)
            }}
          />
        ) : null}
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
              onReplaceLink: () => setReplacing(true),
              onRetry: () => {
                void retryImportAction(props.workspaceSlug, props.importId).then(() =>
                  startTransition(() => router.refresh()),
                )
              },
              manualHref: routes.product(props.workspaceSlug, props.productSlug),
              pasteHref: routes.importProduct(props.workspaceSlug),
            }}
            mode={props.sourceMode}
          />
          {props.sources.length > 1 || props.sourceMode === "content" ? (
            <SourcesSection
              sources={props.sources}
              onRetry={(sourceId) => {
                void retrySourceAction(props.workspaceSlug, props.importId, sourceId).then(() =>
                  startTransition(() => router.refresh()),
                )
              }}
            />
          ) : null}
          <ConflictsSection conflicts={props.conflicts} />
          {props.changes.length > 0 ? <SourceChanges changes={props.changes} /> : null}
          {props.aiUnavailable ? <NoModelNotice mode={props.sourceMode} /> : null}
          {props.missingInformation.length > 0 ? (
            <MissingInformation items={props.missingInformation} mode={props.sourceMode} />
          ) : null}
          {props.withheld.length > 0 ? (
            <Withheld fields={props.withheld} mode={props.sourceMode} />
          ) : null}
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
            rights={rights}
            handlers={{
              onFilesChosen: async (files) => {
                for (const file of files) {
                  const message = await uploadOne(file)
                  if (message) return afterAction(message)
                }
                return afterAction(null)
              },
              onRemoveFile: async (assetId) =>
                afterAction(
                  (await removeDeliverableAction(props.workspaceSlug, props.importId, assetId))
                    .error,
                ),
              onLicenseChosen: async (licenseId, customSummary) =>
                afterAction(
                  (
                    await setLicenseAction(props.workspaceSlug, props.importId, {
                      licenseId,
                      customSummary,
                    })
                  ).error,
                ),
              onOwnershipConfirmed: async (thirdPartyComponents) =>
                afterAction(
                  (
                    await confirmOwnershipAction(props.workspaceSlug, props.importId, {
                      thirdPartyComponents,
                    })
                  ).error,
                ),
              onOwnershipWithdrawn: async () =>
                afterAction(
                  (await withdrawOwnershipAction(props.workspaceSlug, props.importId)).error,
                ),
              anchors,
            }}
          />
        </div>
      </div>

      <ImportFooter
        readiness={readiness}
        saveStatus={saveStatus}
        savedAt={savedAt}
        blockedReason={blocked}
        onSaveDraft={() => void save()}
        onReviewDrafts={() => {
          /*
            Save first, then ask the server whether the five steps are actually
            done. The screen can show 100% from unsaved typing; only the
            database can say whether it is true, and this is the last place to
            ask before a creator is handed to the publishing flow.
          */
          void save().then(async (saved) => {
            if (!saved) return
            const outcome = await reviewMarketplaceDraftsAction(props.workspaceSlug, props.importId)
            if (outcome.kind === "ready") {
              // The product page, which is where channel drafts have always
              // been built and reviewed. No second marketplace surface.
              router.push(outcome.href)
              return
            }
            setBlocked(outcome.kind === "blocked" ? outcome.reason : outcome.message)
          })
        }}
      />
    </ImportChrome>
  )
}

function NoModelNotice({ mode }: { mode: "link" | "content" }) {
  return (
    <section className="flex flex-col gap-2 rounded-[16px] border border-[var(--color-rule)] bg-[var(--color-card)] px-5 py-4">
      <h2 className="label-mono">No draft was composed</h2>
      <p className="text-[14px] leading-[1.55] text-[var(--color-ink-2)]">
        Fanwise read the {mode === "link" ? "page" : "sources"} and saved what it found, but this
        deployment has no model configured, so nothing was proposed. The details are yours to write,
        and everything on the left is what the {mode === "link" ? "page" : "sources"} actually said.
      </p>
    </section>
  )
}

function MissingInformation({
  items,
  mode,
}: {
  items: readonly string[]
  mode: "link" | "content"
}) {
  return (
    <section className="flex flex-col gap-2 rounded-[16px] border border-[var(--color-rule)] bg-[var(--color-card)] px-5 py-4">
      <h2 className="label-mono">
        {mode === "link" ? "What the page did not say" : "What your sources did not say"}
      </h2>
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
function Withheld({ fields, mode }: { fields: readonly string[]; mode: "link" | "content" }) {
  return (
    <section className="flex flex-col gap-2 rounded-[16px] border border-[var(--color-warn)] bg-[var(--color-card)] px-5 py-4">
      <h2 className="label-mono">Held back</h2>
      <p className="text-[14px] leading-[1.55] text-[var(--color-ink-2)]">
        Fanwise did not offer a suggestion for {fields.join(", ")}, because what it wrote made a
        claim the {mode === "link" ? "page" : "sources"} does not support — about files,
        compatibility, licensing, support, ownership or resale. Those are yours to state.
      </p>
    </section>
  )
}
