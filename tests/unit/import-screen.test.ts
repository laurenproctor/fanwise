import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

/*
  The detail screen is a client component: it reads the router to poll while a
  job is working, and it calls server actions. Neither exists in a node test, so
  both are replaced with the smallest thing that satisfies the import. What is
  under test here is what the screen renders, and rendering touches neither.
*/
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
}))
vi.mock("@/lib/imports/actions", () => ({
  discardImportAction: async () => ({ error: null }),
  retryImportAction: async () => ({ error: null }),
  saveImportDraftAction: async () => ({ error: null }),
}))

import { ImportDetail } from "@/app/[slug]/new/link/[importId]/import-detail"
import { ImportChrome } from "@/components/imports/import-chrome"
import { CompletionChecklist } from "@/components/imports/completion-checklist"
import { ImportFooter } from "@/components/imports/import-footer"
import { ListingDraftForm } from "@/components/imports/listing-draft-form"
import { OriginBadge } from "@/components/imports/origin-badge"
import { ReadinessRegion } from "@/components/imports/readiness-region"
import { SourceField } from "@/components/imports/source-field"
import { SourcePanel } from "@/components/imports/source-panel"
import { emptyListingDraft, markSuggestionsReviewed } from "@/lib/imports/draft"
import { importReducer, initialImportState, type ImportState } from "@/lib/imports/machine"
import { importReadiness, type ImportReadinessInput } from "@/lib/imports/readiness"
import { FIXTURE_SCENARIOS } from "./import-ui-fixtures"
import type { BuyerDeliverable, ListingDraft, SourceSnapshot } from "@/lib/imports/types"
import { routes } from "@/lib/routes"

/**
 * The import screen, rendered to markup.
 *
 * The browser half — clicking, typing, real viewports — is
 * tests/e2e/product-link-import.spec.ts. This half is fast and pins the things
 * that must be true of the markup itself: every source state produces a panel
 * with a way out of it, every indicator reads the one readiness object rather
 * than deciding for itself, and the marketplace action is inert below five of
 * five in logic and not only in styling.
 */

const SLUG = "laurens-studio-ab12"
const USER = "00000000-0000-4000-8000-000000000001"
const URL = "https://claude.ai/code/artifact/3f2e8c4e-7d4b-4e9b-b9a1-2c9f4e6a7d1c"

function render(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(element)
}

/** The text a reader sees. Splits on tags and keeps what lies between them. */
function textOf(markup: string): string {
  return markup
    .split(/<[^>]*>/)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

/**
 * Every React element in a tree, without rendering it.
 *
 * Needed because the gate is a handler, not a class name: the only way to prove
 * a disabled-looking button is actually inert is to find its `onClick` and call
 * it. The unit suite runs in node with no DOM, so the tree is walked directly.
 */
function walk(node: ReactNode, found: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, found)
    return found
  }
  if (!isValidElement(node)) return found
  found.push(node)
  const props = node.props as { children?: ReactNode }
  if (props.children !== undefined) walk(props.children, found)
  return found
}

/* ------------------------------------------------------------------ states */

function stateFor(scenario: keyof typeof FIXTURE_SCENARIOS): ImportState {
  const analyzing = importReducer(
    importReducer(importReducer(initialImportState(), { type: "urlChanged", url: URL }), {
      type: "submitted",
    }),
    { type: "validationPassed", url: URL },
  )
  return importReducer(analyzing, {
    type: "analysisSettled",
    analysis: FIXTURE_SCENARIOS[scenario],
  })
}

const STATES: Record<string, ImportState> = {
  empty: initialImportState(),
  validating: { status: "validating", url: URL },
  analyzing: { status: "analyzing", url: URL, stage: "reading" },
  analyzed: stateFor("artifact"),
  private: stateFor("login"),
  notFound: stateFor("missing"),
  unsupported: stateFor("unsupported"),
  failed: stateFor("failed"),
}

const RECOVERY_HANDLERS = {
  onReplaceLink: () => {},
  onRetry: () => {},
  manualHref: routes.newProduct(SLUG),
  pasteHref: `${routes.importProduct(SLUG)}?from=text`,
}

const SNAPSHOT: SourceSnapshot = (() => {
  const state = STATES.analyzed!
  if (state.status !== "analyzed") throw new Error("expected an analyzed fixture")
  return state.snapshot
})()

const ANALYZED_DRAFT: ListingDraft = (() => {
  const state = STATES.analyzed!
  if (state.status !== "analyzed") throw new Error("expected an analyzed fixture")
  return state.draft
})()

function readyFile(): BuyerDeliverable {
  return { id: "f1", filename: "type-scale-studio.zip", byteSize: 2_400_000, state: "ready" }
}

function inputs(overrides: Partial<ImportReadinessInput> = {}): ImportReadinessInput {
  return {
    snapshot: null,
    draft: emptyListingDraft(),
    deliverables: [],
    externalDelivery: null,
    license: null,
    rights: null,
    ...overrides,
  }
}

/** The props the detail screen takes, with an analyzed import in them. */
function detailProps() {
  return {
    workspaceSlug: SLUG,
    importId: "11111111-1111-4111-8111-111111111111",
    productSlug: "type-scale-studio",
    state: STATES.analyzed!,
    draft: ANALYZED_DRAFT,
    deliverables: [] as const,
    license: null,
    rights: null,
    missingInformation: [] as const,
    withheld: [] as const,
    aiUnavailable: false,
    productId: "22222222-2222-4222-8222-222222222222",
    changes: [] as const,
    sourceMode: "link" as const,
    canReplaceLink: true,
    sources: [] as const,
    conflicts: [] as const,
  }
}

const COMPLETE = inputs({
  snapshot: SNAPSHOT,
  draft: markSuggestionsReviewed(ANALYZED_DRAFT),
  deliverables: [readyFile()],
  license: { id: "commercial", name: "Commercial use", summary: "Use it in client work." },
  rights: {
    attestedAt: "2026-09-12T10:00:00.000Z",
    attestedBy: USER,
    attestationVersion: "2026-09-12.1",
  },
})

/* ------------------------------------------------------------------- page */

describe("the import page's frame", () => {
  const markup = render(createElement(ImportChrome, { workspaceSlug: SLUG }))
  const text = textOf(markup)

  it("says what it is, once, as the page's only h1", () => {
    expect(count(markup, "<h1")).toBe(1)
    expect(text).toContain("Import a product")
    expect(text).toContain(
      "Turn a product page, a document, or text you already have into an editable Fanwise listing.",
    )
  })

  it("puts the creator back in the catalog through a breadcrumb", () => {
    expect(markup).toContain('aria-label="Breadcrumb"')
    expect(markup).toContain(`href="${routes.workspace(SLUG)}"`)
    expect(text).toContain("Products / New product")
    // The current page is marked rather than linked: a link to here from here
    // is a link that does nothing.
    expect(markup).toContain('aria-current="page"')
  })

  it("asks for the whole window without touching the shared shell", () => {
    // The one opt-in. app/globals.css widens <main> for a page carrying this
    // and for no other, so no other route moves.
    expect(markup).toContain('data-workspace-canvas="full"')
  })

  it("is the frame both import screens use, so the two cannot drift apart", () => {
    // Rendered by the empty state and by the detail page. The assertion is
    // that there is one of it; the two pages importing it is the mechanism.
    expect(count(markup, "Import a product")).toBe(1)
  })
})

describe("the import detail screen", () => {
  const markup = render(createElement(ImportDetail, detailProps()))

  it("renders the frame, the source, the readiness and the draft together", () => {
    const text = textOf(markup)
    expect(text).toContain("Import a product")
    expect(text).toContain("Listing readiness")
    expect(text).toContain("Listing draft")
    expect(text).toContain("Complete your listing")
    expect(text).toContain("Nothing publishes until you approve it.")
  })

  it("never renders a frame, an object or an injected html string", () => {
    // Imported third-party content is read as text and rendered as text. The
    // production CSP forbids frames as well; this is the half that lives in the
    // code, so nobody later widens the policy to fix a blank box.
    expect(markup).not.toContain("<iframe")
    expect(markup).not.toContain("<object")
    expect(markup).not.toContain("<embed")
  })

  it("names what the page did not say, when the draft found gaps", () => {
    const withGaps = render(
      createElement(ImportDetail, {
        ...detailProps(),
        missingInformation: ["What file formats a buyer receives"],
      }),
    )
    expect(textOf(withGaps)).toContain("What the page did not say")
    expect(textOf(withGaps)).toContain("What file formats a buyer receives")
  })

  it("says which fields were held back, and why, rather than dropping them silently", () => {
    const withheld = render(
      createElement(ImportDetail, { ...detailProps(), withheld: ["longDescription"] }),
    )
    const text = textOf(withheld)
    expect(text).toContain("Held back")
    expect(text).toContain("longDescription")
    expect(text).toContain("a claim the page does not support")
  })

  it("says plainly when there was no model to draft with", () => {
    const noModel = render(createElement(ImportDetail, { ...detailProps(), aiUnavailable: true }))
    const text = textOf(noModel)
    expect(text).toContain("No draft was composed")
    expect(text).toContain("this deployment has no model configured")
  })
})

/* --------------------------------------------------------- source states */

describe("every source state", () => {
  it("renders a panel, in all eight of them", () => {
    for (const [name, state] of Object.entries(STATES)) {
      const markup = render(createElement(SourcePanel, { state, handlers: RECOVERY_HANDLERS }))
      expect(markup.length, `${name} rendered nothing`).toBeGreaterThan(0)
      expect(textOf(markup).length, `${name} rendered no text`).toBeGreaterThan(0)
    }
  })

  function sourceField(state: ImportState): string {
    return render(
      createElement(SourceField, {
        state,
        onUrlChange: () => {},
        onSubmit: () => {},
        onReplaceLink: () => {},
      }),
    )
  }

  it("names each settled state on the pill, in words rather than in colour", () => {
    const expected: Record<string, string> = {
      analyzing: "Analyzing",
      analyzed: "Analyzed",
      private: "Needs permission",
      notFound: "Not found",
      unsupported: "Unsupported",
      failed: "Could not finish",
    }

    for (const [name, word] of Object.entries(expected)) {
      expect(textOf(sourceField(STATES[name]!)), `${name} does not name its state`).toContain(word)
    }
  })

  it("says the state in the live region in every one of the eight", () => {
    // While the field is still editable there is no pill — the state is "you
    // have not pressed the button yet", and a badge saying so would be noise
    // beside the button itself. The live region carries it regardless, so a
    // screen reader user is told in all eight states rather than in six.
    const expected: Record<string, string> = {
      empty: "Source not analyzed.",
      validating: "Checking the link.",
      analyzing: "Reading the page. Still working.",
      analyzed: "Source analyzed.",
      private: "Source needs permission.",
      notFound: "Source not found.",
      unsupported: "Source unsupported.",
      failed: "Source could not finish.",
    }

    for (const [name, sentence] of Object.entries(expected)) {
      const markup = sourceField(STATES[name]!)
      expect(markup, `${name} has no live region`).toContain('role="status"')
      expect(markup, `${name} does not announce politely`).toContain('aria-live="polite"')
      expect(textOf(markup), `${name} does not announce its state`).toContain(sentence)
    }
  })

  it("offers the field while there is nothing to show, and the address once there is", () => {
    for (const name of ["empty", "validating"]) {
      const markup = render(
        createElement(SourceField, {
          state: STATES[name]!,
          onUrlChange: () => {},
          onSubmit: () => {},
          onReplaceLink: () => {},
        }),
      )
      expect(markup, name).toContain("<input")
      expect(textOf(markup), name).not.toContain("Replace link")
    }

    for (const name of ["analyzed", "private", "notFound", "unsupported", "failed"]) {
      const markup = render(
        createElement(SourceField, {
          state: STATES[name]!,
          onUrlChange: () => {},
          onSubmit: () => {},
          onReplaceLink: () => {},
        }),
      )
      expect(textOf(markup), name).toContain("Replace link")
      expect(textOf(markup), name).toContain(URL)
    }
  })

  it("reports progress while analyzing without claiming how much is left", () => {
    const markup = render(
      createElement(SourcePanel, { state: STATES.analyzing!, handlers: RECOVERY_HANDLERS }),
    )
    const text = textOf(markup)

    expect(text).toContain("Opening the link")
    expect(text).toContain("Reading the page")
    expect(text).toContain("Pulling out the details")
    // Each stage carries its own word, so none of this depends on the colour.
    expect(text).toContain("Done")
    expect(text).toContain("Working")
    expect(text).toContain("Waiting")
    // No percentage anywhere: the length of the work is not knowable.
    expect(text).not.toMatch(/\d+%/)
    expect(markup).not.toContain("aria-valuenow")
  })

  it("shows what was found, and where each fact came from, once analyzed", () => {
    const markup = render(
      createElement(SourcePanel, { state: STATES.analyzed!, handlers: RECOVERY_HANDLERS }),
    )
    const text = textOf(markup)

    expect(text).toContain("Type Scale Studio")
    expect(text).toContain("Captured Sep 12, 2026")
    // The kind is derived from the snapshot rather than carried as a fact, so
    // it is named once. It was named twice before anybody looked at the screen.
    expect(count(markup, "Claude Artifact")).toBe(1)
    // A snapshot, not a subscription, said where a creator will look for it.
    expect(text).toContain("Fanwise does not re-read this source")
  })

  it("gives every unhappy state a heading, a reason and a way out", () => {
    const expected: Record<string, string> = {
      private: "That link needs permission",
      notFound: "Nothing is published there",
      unsupported: "Fanwise cannot read that link yet",
      failed: "That did not finish",
    }

    for (const [name, heading] of Object.entries(expected)) {
      const markup = render(
        createElement(SourcePanel, { state: STATES[name]!, handlers: RECOVERY_HANDLERS }),
      )
      const text = textOf(markup)

      expect(text, name).toContain(heading)
      expect(text, name).toContain("What you can do")
      expect(text, name).toContain("Continue manually")
      expect(markup, name).toContain(`href="${routes.newProduct(SLUG)}"`)
      // Never a provider's own words. Rule 8: normalize, persist the original.
      expect(text, name).toContain("Fanwise never asks for your password")
    }
  })

  it("offers to publish a public link where that is the fix, and a retry where it is not", () => {
    const locked = textOf(
      render(createElement(SourcePanel, { state: STATES.private!, handlers: RECOVERY_HANDLERS })),
    )
    expect(locked).toContain("Publish a public link")
    expect(locked).not.toContain("Try again")

    const broke = textOf(
      render(createElement(SourcePanel, { state: STATES.failed!, handlers: RECOVERY_HANDLERS })),
    )
    expect(broke).toContain("Try again")
    expect(broke).toContain("Nothing was saved")
  })

  it("marks an unbuilt recovery rather than offering a control that does nothing", () => {
    const markup = render(
      createElement(SourcePanel, { state: STATES.private!, handlers: RECOVERY_HANDLERS }),
    )
    // Same treatment as components/onboarding/import-listing-action.tsx: still
    // in the tab order, and honest about not being there yet.
    expect(markup).toContain('aria-disabled="true"')
    expect(textOf(markup)).toContain("Not built yet")
  })
})

/* ------------------------------------------------------------- readiness */

describe("the readiness region", () => {
  it("is a progress control that reports the count, not the grade", () => {
    const readiness = importReadiness(inputs({ snapshot: SNAPSHOT }))
    const markup = render(createElement(ReadinessRegion, { readiness }))

    expect(markup).toContain('role="progressbar"')
    expect(markup).toContain('aria-valuenow="1"')
    expect(markup).toContain('aria-valuemin="0"')
    expect(markup).toContain('aria-valuemax="5"')
    expect(markup).toContain('aria-valuetext="1 of 5 steps complete, 20 percent"')
  })

  it("names all five steps and says the state of each in a word", () => {
    const readiness = importReadiness(inputs({ snapshot: SNAPSHOT }))
    const text = textOf(render(createElement(ReadinessRegion, { readiness })))

    for (const label of ["Source", "Listing", "Buyer files", "License", "Ownership"]) {
      expect(text).toContain(label)
    }
    expect(text).toContain("Complete")
    expect(text).toContain("Next step")
    expect(text).toContain("Required")
  })

  it("marks exactly one step as the current one", () => {
    for (const readiness of [
      importReadiness(inputs()),
      importReadiness(inputs({ snapshot: SNAPSHOT })),
      importReadiness({ ...COMPLETE, rights: null }),
    ]) {
      const markup = render(createElement(ReadinessRegion, { readiness }))
      expect(count(markup, 'aria-current="step"')).toBe(1)
    }
  })

  it("marks none once there is nothing left to do", () => {
    const markup = render(createElement(ReadinessRegion, { readiness: importReadiness(COMPLETE) }))
    expect(count(markup, 'aria-current="step"')).toBe(0)
    expect(textOf(markup)).toContain("Every required step is done")
  })

  it("shows the figure only in twenties, and reads the same object the checklist does", () => {
    const cases: Array<[ImportReadinessInput, string]> = [
      [inputs(), "0%"],
      [inputs({ snapshot: SNAPSHOT }), "20%"],
      [{ ...COMPLETE, license: null, rights: null }, "60%"],
      [COMPLETE, "100%"],
    ]
    for (const [input, figure] of cases) {
      const readiness = importReadiness(input)
      expect(textOf(render(createElement(ReadinessRegion, { readiness }))), figure).toContain(
        figure,
      )
    }
  })
})

/* ------------------------------------------------------------- checklist */

describe("the completion checklist", () => {
  const handlers = {
    onFilesChosen: async () => null,
    onRemoveFile: async () => null,
    onLicenseChosen: async () => null,
    onOwnershipConfirmed: async () => null,
    onOwnershipWithdrawn: async () => null,
    anchors: {
      source: "#import-source-region",
      listing: "#import-draft-heading",
      buyerFiles: null,
      license: null,
      ownership: null,
    },
  }

  function checklist(input: ImportReadinessInput) {
    return render(
      createElement(CompletionChecklist, {
        readiness: importReadiness(input),
        deliverables: [],
        license: null,
        rights: null,
        handlers,
      }),
    )
  }

  it("counts what is left, in the words the count needs", () => {
    expect(textOf(checklist(inputs()))).toContain("5 required items remaining")
    expect(textOf(checklist({ ...COMPLETE, rights: null }))).toContain("1 required item remaining")
    expect(textOf(checklist(COMPLETE))).toContain("Nothing left")
  })

  it("marks one next step and calls every remaining blocker required", () => {
    const markup = checklist(inputs({ snapshot: SNAPSHOT }))

    expect(count(markup, 'aria-current="step"')).toBe(1)
    expect(textOf(markup)).toContain("Next step")
    // Four blockers left after the source: each one says so.
    expect(count(markup, ">Required<")).toBe(4)
  })

  it("names the reason on each thing that is still blocking", () => {
    const text = textOf(checklist({ ...COMPLETE, license: null, rights: null }))

    expect(text).toContain("Choose license")
    expect(text).toContain("Confirm ownership")
    expect(text).toContain("No license chosen.")
    expect(text).toContain("You have not confirmed you can sell this.")
  })

  it("keeps a finished step listed when its control lives nowhere else", () => {
    // Buyer files, the license and the ownership confirmation are edited here
    // and only here, so hiding a finished row would take the only way to change
    // it back with it.
    const text = textOf(checklist(COMPLETE))

    expect(text).toContain("Upload customer files")
    expect(text).toContain("Choose license")
    expect(text).toContain("Confirm ownership")
    expect(text).toContain("Done")
    expect(text).not.toContain("Required")
  })

  it("drops a finished step whose control is elsewhere on the page", () => {
    // The source and the listing are acted on further up. A row for either is a
    // signpost, and a signpost to somewhere you have already been is clutter.
    const text = textOf(checklist({ ...COMPLETE, license: null }))

    expect(text).not.toContain("Add a source")
    expect(text).not.toContain("Complete the listing")
  })

  it("points at the region that owns a step while that step is blocking", () => {
    const markup = checklist(inputs())

    expect(textOf(markup)).toContain("Add a source")
    expect(markup).toContain('href="#import-source-region"')
  })

  it("opens one control at a time, and it is the next step's", () => {
    // Every panel open at once is a file picker, three license options and an
    // attestation stacked under a heading that says what is left, which is the
    // one thing a checklist has to stay readable enough to say.
    const markup = checklist({ ...COMPLETE, deliverables: [], license: null, rights: null })

    expect(count(markup, 'aria-expanded="true"')).toBe(1)
    expect(count(markup, 'aria-expanded="false"')).toBe(2)
    // Buyer files is the next step, so its control is the open one.
    expect(textOf(markup)).toContain("Upload files")
    expect(textOf(markup)).not.toContain("Extended commercial")
  })

  it("names each toggle for its own step", () => {
    const markup = checklist(inputs())

    for (const label of [
      "Show upload customer files",
      "Show choose license",
      "Show confirm ownership",
    ]) {
      expect(markup, label).toContain(`aria-label="${label}"`)
    }
  })

  it("gives a step with no panel no toggle at all", () => {
    // Source and listing are acted on elsewhere; their row is a signpost, and a
    // signpost does not expand.
    const markup = checklist(inputs())
    expect(markup).not.toContain('aria-label="Show add a source"')
    expect(markup).toContain('href="#import-source-region"')
  })

  it("keeps the checklist and the track in step, because both read one object", () => {
    const readiness = importReadiness(inputs({ snapshot: SNAPSHOT }))
    const track = textOf(render(createElement(ReadinessRegion, { readiness })))
    const list = textOf(
      render(
        createElement(CompletionChecklist, {
          readiness,
          deliverables: [],
          license: null,
          rights: null,
          handlers,
        }),
      ),
    )

    expect(track).toContain("1 of 5 steps complete")
    expect(list).toContain("4 required items remaining")
  })
})

/* ---------------------------------------------------------------- origin */

describe("observed facts and inferred suggestions", () => {
  it("uses different words for them, never different shades of one", () => {
    const observed = textOf(
      render(
        createElement(OriginBadge, {
          origin: { kind: "observed", from: "og" },
          field: "Description",
        }),
      ),
    )
    const suggested = textOf(
      render(
        createElement(OriginBadge, {
          origin: { kind: "suggested", reviewed: false },
          field: "Price",
        }),
      ),
    )

    expect(observed).toContain("From source")
    expect(observed).toContain("Fanwise read this from the page itself")
    expect(suggested).toContain("Suggested")
    expect(suggested).toContain("Needs review")
    expect(suggested).toContain("Fanwise worked this out from the source")
  })

  it("says nothing at all about a value the creator typed", () => {
    const markup = render(
      createElement(OriginBadge, { origin: { kind: "creator" }, field: "Description" }),
    )
    expect(markup).toBe("")
  })

  it("keeps the marker after review, and drops the warning", () => {
    const text = textOf(
      render(
        createElement(OriginBadge, {
          origin: { kind: "suggested", reviewed: true },
          field: "Tags",
        }),
      ),
    )
    expect(text).toContain("Suggested")
    expect(text).not.toContain("Needs review")
  })

  it("asks for a review on the draft form while one is outstanding", () => {
    const waiting = textOf(
      render(
        createElement(ListingDraftForm, {
          draft: ANALYZED_DRAFT,
          onFieldChange: () => {},
          onReviewSuggestions: () => {},
        }),
      ),
    )
    expect(waiting).toContain("Fanwise may repeat on other channels")
    expect(waiting).toContain("I have checked these")

    const done = textOf(
      render(
        createElement(ListingDraftForm, {
          draft: markSuggestionsReviewed(ANALYZED_DRAFT),
          onFieldChange: () => {},
          onReviewSuggestions: () => {},
        }),
      ),
    )
    expect(done).not.toContain("I have checked these")
  })
})

/* ------------------------------------------------------------------ gate */

describe("the marketplace review gate", () => {
  function footer(input: ImportReadinessInput, onReviewDrafts = () => {}) {
    return {
      readiness: importReadiness(input),
      saveStatus: "clean" as const,
      savedAt: null,
      onSaveDraft: () => {},
      onReviewDrafts,
    }
  }

  it("is marked unavailable, with the reason beside it, below five of five", () => {
    for (const input of [inputs(), inputs({ snapshot: SNAPSHOT }), { ...COMPLETE, rights: null }]) {
      const markup = render(createElement(ImportFooter, footer(input)))
      expect(markup).toContain('aria-disabled="true"')
      expect(markup).toContain('aria-describedby="import-review-blocked"')
      expect(textOf(markup)).toMatch(/Complete \d+ required items? to continue\./)
    }
  })

  it("refuses the action itself, not only its appearance", () => {
    // The claim under test: a caller that reaches the handler anyway — a
    // synthetic event, a stale render, an assistive client that ignores
    // aria-disabled — still cannot get through.
    const reached = vi.fn()
    const element = ImportFooter(footer({ ...COMPLETE, rights: null }, reached))
    const button = walk(element).find(
      (node) =>
        node.type === "button" ||
        (typeof node.props === "object" &&
          node.props !== null &&
          "children" in node.props &&
          node.props.children === "Review marketplace drafts"),
    )
    expect(button).toBeDefined()

    const onClick = (button!.props as { onClick?: () => void }).onClick
    expect(onClick).toBeTypeOf("function")
    onClick!()

    expect(reached).not.toHaveBeenCalled()
  })

  it("lets it through at five of five, and drops the reason", () => {
    const reached = vi.fn()
    const props = footer(COMPLETE, reached)

    const markup = render(createElement(ImportFooter, props))
    expect(markup).not.toContain('aria-disabled="true"')
    expect(markup).not.toContain("import-review-blocked")

    const element = ImportFooter(props)
    const button = walk(element).find(
      (node) =>
        typeof node.props === "object" &&
        node.props !== null &&
        "children" in node.props &&
        node.props.children === "Review marketplace drafts",
    )
    ;(button!.props as { onClick: () => void }).onClick()
    expect(reached).toHaveBeenCalledTimes(1)
  })

  it("always says what will not happen, whatever the readiness", () => {
    for (const input of [inputs(), COMPLETE]) {
      expect(textOf(render(createElement(ImportFooter, footer(input))))).toContain(
        "Nothing publishes until you approve it.",
      )
    }
  })

  it("keeps Save draft available from the first moment", () => {
    const markup = render(createElement(ImportFooter, footer(inputs())))
    const save = /<button[^>]*>Save draft<\/button>/.exec(markup)?.[0] ?? ""
    expect(save).not.toBe("")
    // The attribute, not the substring: the shared Button carries
    // `disabled:opacity-50` in its class list and always will.
    expect(save).not.toMatch(/\sdisabled(=|\s|>)/)
    expect(save).not.toContain('aria-disabled="true"')
  })
})

/* ------------------------------------------------------------ responsive */

describe("the layout at the widths the repository already tests", () => {
  const markup = render(createElement(ImportDetail, detailProps()))

  it("stacks to one column by default and splits only when there is room", () => {
    // The repository's breakpoints are sm/md/lg/xl. The working area is one
    // column at every width below xl, which is the 1280px case in
    // tests/e2e/catalog.spec.ts, and two above it.
    expect(markup).toContain("xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]")
    // No unprefixed multi-column grid anywhere: every split is opted into at a
    // breakpoint, so the narrow layout is the default rather than the override.
    expect(markup).not.toMatch(/(?:^|[\s"])grid-cols-(?!1\b)/)
  })

  it("gives both columns a zero minimum, which is what stops a grid blowing out", () => {
    // Without min-w-0 a grid child refuses to shrink below its content and the
    // page scrolls sideways. The e2e suite asserts the absence of that scroll;
    // this asserts the property that prevents it.
    expect(count(markup, "flex min-w-0 flex-col")).toBeGreaterThanOrEqual(2)
  })

  it("reflows the five-step rail rather than shrinking it", () => {
    const readiness = importReadiness(inputs({ snapshot: SNAPSHOT }))
    const rail = render(createElement(ReadinessRegion, { readiness }))
    expect(rail).toContain("sm:grid-cols-2")
    expect(rail).toContain("lg:grid-cols-5")
  })

  it("never sets a fixed width wider than a phone", () => {
    // 360px is the narrowest viewport the e2e suite uses.
    for (const match of markup.matchAll(/(?:min-)?w-\[(\d+)px\]/g)) {
      expect(Number(match[1]), `${match[0]} is wider than a phone`).toBeLessThanOrEqual(360)
    }
  })

  it("lets the source field and the footer become rows only when there is room", () => {
    expect(markup).toContain("sm:flex-row")
    expect(markup).toContain("lg:flex-row")
  })
})

describe("only the importer asks for the whole window", () => {
  /**
   * The browser used to measure `<main>` on three other workspace routes at
   * 1600px to prove none of them had been widened. What decides that is one CSS
   * rule keyed on one attribute, and who carries the attribute, so both are
   * read here. The importer's own widths and gutters are still measured in
   * product-link-import.spec.ts.
   */
  const ROOT = join(__dirname, "..", "..")

  function sourceFiles(dir: string): string[] {
    return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return sourceFiles(path)
      return /\.(tsx?|css)$/.test(entry.name) ? [path] : []
    })
  }

  it("is the one component that carries the wide-canvas attribute", () => {
    const carriers = [...sourceFiles("app"), ...sourceFiles("components"), ...sourceFiles("lib")]
      .filter((path) => readFileSync(join(ROOT, path), "utf8").includes("data-workspace-canvas"))
      .sort()

    expect(carriers).toEqual([
      join("app", "globals.css"),
      join("components", "imports", "import-chrome.tsx"),
    ])
  })

  it("widens only a main that directly holds that canvas, and leaves the reading column alone", () => {
    const css = readFileSync(join(ROOT, "app", "globals.css"), "utf8")
    const layout = readFileSync(join(ROOT, "app", "[slug]", "layout.tsx"), "utf8")

    expect(css).toMatch(
      /main:has\(> \[data-workspace-canvas="full"\]\) \{\s*max-width: none;\s*padding-inline: clamp\(1\.5rem, 4vw, 4rem\);/,
    )
    // Every other workspace route keeps the 1160px column and its 24px gutters.
    expect(layout).toContain('<main className="mx-auto w-full max-w-[1160px] px-6 py-10">')
  })
})
