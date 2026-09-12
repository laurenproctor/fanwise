import type {
  ListingDraft,
  RecoveryOption,
  SourceAnalysis,
  SourceSnapshot,
} from "@/lib/imports/types"

/**
 * Sample states, for rendering the screen without a database.
 *
 * These used to drive the screen itself, before the pipeline existed. They now
 * do what they should always have done: give the component tests a settled
 * import of each shape to render, with a fixed timestamp so a render is
 * byte-identical between runs.
 *
 * They live in `tests/` rather than in `lib/` deliberately. A module called
 * "fixtures" sitting beside the real importers is how a later reader concludes
 * that importing is still fake.
 */

/** Fixed, so a rendered "Captured" line does not change between test runs. */
export const FIXTURE_CAPTURED_AT = "2026-09-12T09:20:00.000Z"

const RECOVERY: Record<string, RecoveryOption> = {
  publish: {
    action: "publish_public_link",
    label: "Publish a public link",
    description:
      "Open the artifact, use Share to publish it, and paste the public link it gives you.",
  },
  replace: {
    action: "replace_link",
    label: "Paste a different link",
    description: "Swap in a link anyone can open without signing in.",
  },
  paste: {
    action: "paste_code",
    label: "Paste the code instead",
    description: "Fanwise stores what you paste as a source file. It is never run.",
  },
  upload: {
    action: "upload_files",
    label: "Upload a ZIP or project",
    description: "Add the files directly. Fanwise stores them, and never unpacks or runs them.",
  },
  manual: {
    action: "continue_manually",
    label: "Continue manually",
    description: "Skip the source and write the listing yourself.",
  },
  retry: {
    action: "retry",
    label: "Try again",
    description: "Nothing was changed. The same link is read again.",
  },
}

function draft(overrides: Partial<ListingDraft> = {}): ListingDraft {
  return {
    title: { value: "Type Scale Studio", origin: { kind: "observed", from: "og" } },
    // Suggested, not observed: the page never named a Fanwise product type, so
    // this is a model's reading of it and has to be reviewed before it counts.
    productType: { value: "template", origin: { kind: "suggested", reviewed: false } },
    price: { value: "24", origin: { kind: "suggested", reviewed: false } },
    currency: { value: "USD", origin: { kind: "creator" } },
    description: {
      value:
        "A modern, easy-to-use tool for generating beautiful, modular type scales. Adjust your base size and scale ratio, preview in real time, and export ready-to-use styles for Figma, CSS, and more.",
      origin: { kind: "observed", from: "meta" },
    },
    tags: {
      value: ["typography", "design-tools", "figma", "css", "design-system"],
      origin: { kind: "suggested", reviewed: false },
    },
    ...overrides,
  }
}

function snapshot(overrides: Partial<SourceSnapshot> = {}): SourceSnapshot {
  return {
    sourceKind: "hosted_artifact",
    url: "https://claude.ai/code/artifact/3f2e8c4e-7d4b-4e9b-b9a1-2c9f4e6a7d1c",
    capturedAt: FIXTURE_CAPTURED_AT,
    title: "Type Scale Studio",
    description:
      "Generate modular type scales, preview them in real time, and export ready-to-use styles for any design system.",
    previews: [
      {
        id: "hero",
        alt: "Text captured from the source page",
        caption: "Beautiful, balanced type scales for modern products.",
      },
      {
        id: "p1",
        alt: "Second heading captured from the page",
        caption: "A better type scale in seconds.",
      },
      { id: "p2", alt: "Third heading captured from the page", caption: "Export to your stack." },
      {
        id: "p3",
        alt: "Fourth heading captured from the page",
        caption: "Base size, scale ratio, preview.",
      },
    ],
    facts: [{ id: "visibility", label: "Public preview", origin: "header" }],
    ...overrides,
  }
}

export const ANALYZED_ARTIFACT: SourceAnalysis = {
  outcome: "analyzed",
  snapshot: snapshot(),
  draft: draft(),
}

export const ANALYZED_WEBPAGE: SourceAnalysis = {
  outcome: "analyzed",
  snapshot: snapshot({
    sourceKind: "webpage",
    url: "https://example.com/products/aster-grotesk",
    title: "Aster Grotesk",
    description: "A six-weight grotesque for screens, with matching italics.",
    previews: [
      {
        id: "hero",
        alt: "Text captured from the source page",
        caption: "A six-weight grotesque for screens.",
      },
    ],
    facts: [{ id: "visibility", label: "Readable without signing in", origin: "header" }],
  }),
  draft: draft({
    title: { value: "Aster Grotesk", origin: { kind: "observed", from: "og" } },
    productType: { value: "font", origin: { kind: "suggested", reviewed: false } },
    description: {
      value: "A six-weight grotesque for screens, with matching italics.",
      origin: { kind: "observed", from: "og" },
    },
    tags: {
      value: ["font", "grotesque", "sans-serif"],
      origin: { kind: "suggested", reviewed: false },
    },
  }),
}

export const LOGIN_REQUIRED: SourceAnalysis = {
  outcome: "unavailable",
  reason: "login_required",
  message: "That link asks whoever opens it to sign in, so Fanwise cannot read it.",
  recoveries: [RECOVERY.publish!, RECOVERY.paste!, RECOVERY.upload!, RECOVERY.manual!],
}

export const ORGANIZATION_ONLY: SourceAnalysis = {
  outcome: "unavailable",
  reason: "organization_only",
  message: "That link is shared inside an organization only. Fanwise is not a member of it.",
  recoveries: [RECOVERY.publish!, RECOVERY.paste!, RECOVERY.upload!, RECOVERY.manual!],
}

export const NOT_FOUND: SourceAnalysis = {
  outcome: "unavailable",
  reason: "not_found",
  message: "Nothing is published at that link. It may have been deleted or renamed.",
  recoveries: [RECOVERY.replace!, RECOVERY.upload!, RECOVERY.manual!],
}

export const EXPIRED: SourceAnalysis = {
  outcome: "unavailable",
  reason: "expired",
  message: "That link has expired. Publish it again and paste the new one.",
  recoveries: [RECOVERY.publish!, RECOVERY.replace!, RECOVERY.manual!],
}

export const UNSUPPORTED: SourceAnalysis = {
  outcome: "unsupported",
  message: "Fanwise cannot read that kind of link yet. It reads public web pages and artifacts.",
  recoveries: [RECOVERY.replace!, RECOVERY.upload!, RECOVERY.manual!],
}

export const FAILED: SourceAnalysis = {
  outcome: "failed",
  message:
    "Fanwise could not finish reading that link. Nothing was saved, so trying again is safe.",
  recoveries: [RECOVERY.retry!, RECOVERY.manual!],
}

/**
 * The scenarios, by name.
 *
 * Exported so that tests name a state rather than constructing one, and so the
 * component suite and the reducer suite exercise the same objects the screen
 * does.
 */
export const FIXTURE_SCENARIOS = {
  artifact: ANALYZED_ARTIFACT,
  webpage: ANALYZED_WEBPAGE,
  login: LOGIN_REQUIRED,
  organization: ORGANIZATION_ONLY,
  missing: NOT_FOUND,
  expired: EXPIRED,
  unsupported: UNSUPPORTED,
  failed: FAILED,
} as const

export type FixtureScenario = keyof typeof FIXTURE_SCENARIOS
