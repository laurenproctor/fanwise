import { FONT_PROBLEM_TEXT } from "./detected"
import {
  FONT_SECTIONS,
  GRID_SHAPES,
  MIN_HERO_WIDTH,
  cropLoss,
  type ChannelDraftView,
  type DetectedFamily,
  type FontFileView,
  type FontProductValues,
  type FontSection,
  type SpecimenImageView,
  unlistedStyles,
} from "./workspace"
import type { FontMetadata } from "@/lib/products/metadata"

/**
 * Font listing readiness, as rules rather than conditions in a component.
 *
 * Every rule names the section and field it belongs to, how much it matters,
 * and what it blocks. The screen renders the list; it decides nothing. The
 * same function runs on the server before Publish Everywhere is allowed to
 * start, so the button and the action cannot disagree.
 *
 * Three severities, and the difference is the point:
 *
 *   blocker    publishing cannot start until it is fixed
 *   attention  worth fixing, counted in the percentage, blocks nothing
 *   optional   a recommendation; never counted, never blocking
 *
 * A blocker's scope says what it blocks. `all` stops Publish Everywhere. A
 * `channel` blocker is the channel's own requirement — that channel is skipped
 * and every other still publishes, which is what the run planner already does.
 *
 * Channel rules are not restated here. They arrive as each listing's evaluated
 * requirement results and are carried through, so a limit lives in exactly one
 * adapter.
 */

export type RuleSeverity = "blocker" | "attention" | "optional"

export type RuleScope =
  { kind: "all" } | { kind: "storefront" } | { kind: "channel"; channelName: string }

export interface ReadinessRule {
  key: string
  section: FontSection
  /** The DOM id of the control that fixes it, or null when there is no one control. */
  fieldId: string | null
  severity: RuleSeverity
  /** `problem` is something wrong; `missing` is something not yet provided. */
  tone: "missing" | "problem"
  scope: RuleScope
  label: string
  message: string
  satisfied: boolean
}

export type SectionStatus = "complete" | "incomplete" | "attention" | "error"

export interface FontReadiness {
  rules: ReadinessRule[]
  /** Unsatisfied rules, most severe first. */
  issues: ReadinessRule[]
  /** Blocker and attention rules satisfied, as a whole percentage. */
  percent: number
  /** Unsatisfied blockers that stop every channel. */
  blockingAll: ReadinessRule[]
  sections: Record<FontSection, SectionStatus>
  canPublish: boolean
}

export interface FontReadinessInput {
  values: FontProductValues
  metadata: FontMetadata
  files: readonly FontFileView[]
  family: DetectedFamily
  images: readonly SpecimenImageView[]
  channels: readonly ChannelDraftView[]
  /** A license file is attached to the product. */
  hasLicenseFile: boolean
}

/** Field ids, shared by the rules and the controls they point at. */
export const FIELD_IDS = {
  name: "font-family-name",
  canonicalTitle: "font-listing-title",
  slug: "font-listing-slug",
  shortDescription: "font-short-description",
  canonicalDescription: "font-full-description",
  tags: "font-tags",
  brandName: "font-designer",
  classification: "font-classification",
  version: "font-version",
  styles: "font-styles",
  fileDrop: "font-file-drop",
  fileList: "font-file-list",
  glyphCount: "font-glyph-count",
  scripts: "font-scripts",
  languages: "font-languages",
  imageDrop: "font-image-drop",
  imageDetails: "font-image-details",
  basePrice: "font-base-price",
  licenseTypes: "font-license-types",
  webLicense: "font-license-web",
  licenseSummary: "font-license-summary",
  eula: "font-eula",
  channelPricing: "font-channel-pricing",
  drafts: "font-drafts",
} as const

const ALL: RuleScope = { kind: "all" }

export function evaluateFontReadiness(input: FontReadinessInput): FontReadiness {
  const { values, metadata, files, family, images, channels } = input
  const rules: ReadinessRule[] = []
  const add = (rule: ReadinessRule) => rules.push(rule)

  const fontFiles = files.filter((file) => file.kind === "font")
  const readable = fontFiles.filter(
    (file) => file.state === "ready" && file.reading.kind === "font",
  )
  const unreadable = fontFiles.filter(
    (file) => file.state === "ready" && file.reading.kind === "problem",
  )
  const failed = files.filter((file) => file.state === "failed")
  const pending = files.filter((file) => file.state === "pending")
  const duplicates = files.filter((file) => file.duplicateOf !== null)
  const licenses = metadata.licenses ?? []
  const web = licenses.find((license) => license.kind === "web")

  /* ---------------------------------------------------------------- files */

  add({
    key: "files.present",
    section: "files",
    fieldId: FIELD_IDS.fileDrop,
    severity: "blocker",
    tone: "missing",
    scope: ALL,
    label: "Upload your font files",
    message: "Buyers receive these. Add at least one OTF, TTF, WOFF or WOFF2 file.",
    satisfied: readable.length > 0,
  })

  const firstUnreadable = unreadable[0]
  add({
    key: "files.unreadable",
    section: "files",
    fieldId: FIELD_IDS.fileList,
    severity: "blocker",
    tone: "problem",
    scope: ALL,
    label:
      unreadable.length === 1
        ? `Replace ${firstUnreadable!.filename}`
        : `Replace ${unreadable.length} unreadable font files`,
    message:
      firstUnreadable && firstUnreadable.reading.kind === "problem"
        ? FONT_PROBLEM_TEXT[firstUnreadable.reading.problem]
        : "Buyers would receive a file that does not open.",
    satisfied: unreadable.length === 0,
  })

  add({
    key: "files.failed",
    section: "files",
    fieldId: FIELD_IDS.fileList,
    severity: "attention",
    tone: "problem",
    scope: ALL,
    label: failed.length === 1 ? `Retry ${failed[0]!.filename}` : `Retry ${failed.length} uploads`,
    message: "These uploads did not finish. Upload them again or remove them.",
    satisfied: failed.length === 0,
  })

  add({
    key: "files.duplicates",
    section: "files",
    fieldId: FIELD_IDS.fileList,
    severity: "attention",
    tone: "problem",
    scope: ALL,
    label:
      duplicates.length === 1
        ? `Remove the duplicate ${duplicates[0]!.filename}`
        : `Remove ${duplicates.length} duplicate files`,
    message: "The same file is uploaded more than once, so buyers would download it twice.",
    satisfied: duplicates.length === 0,
  })

  if (pending.length > 0) {
    add({
      key: "files.processing",
      section: "files",
      fieldId: FIELD_IDS.fileList,
      severity: "optional",
      tone: "missing",
      scope: ALL,
      label:
        pending.length === 1 ? "1 file is processing" : `${pending.length} files are processing`,
      message: "Fanwise is checking the stored file. Details fill in when it finishes.",
      satisfied: false,
    })
  }

  /* --------------------------------------------------------------- family */

  add({
    key: "family.designer",
    section: "family",
    fieldId: FIELD_IDS.brandName,
    severity: "attention",
    tone: "missing",
    scope: ALL,
    label: "Add the designer or foundry",
    message: "Credits whoever designed or published the family, beside its name.",
    satisfied: values.brandName.trim().length > 0,
  })

  add({
    key: "family.classification",
    section: "family",
    fieldId: FIELD_IDS.classification,
    severity: "attention",
    tone: "missing",
    scope: ALL,
    label: "Choose a classification",
    message: "Buyers browse type by classification: serif, display, script and so on.",
    satisfied: metadata.classification !== undefined,
  })

  const styles = metadata.styles ?? []
  const detectedKeys = new Set(family.styles.map((style) => style.key))
  const orphaned = family.readCount > 0 ? styles.filter((s) => !detectedKeys.has(s.key)) : []

  add({
    key: "family.styles",
    section: "family",
    fieldId: FIELD_IDS.styles,
    severity: "attention",
    tone: "missing",
    scope: ALL,
    label: "List the styles in the family",
    message: "Upload font files and the styles fill in, or add them by hand.",
    satisfied: styles.length > 0,
  })

  add({
    key: "family.orphanedStyles",
    section: "family",
    fieldId: FIELD_IDS.styles,
    severity: "attention",
    tone: "problem",
    scope: ALL,
    label:
      orphaned.length === 1
        ? `${orphaned[0]!.name} has no font file`
        : `${orphaned.length} styles have no font file`,
    message: "Upload the file for each style, or remove the style from the family.",
    satisfied: orphaned.length === 0,
  })

  const unlisted = unlistedStyles(metadata, family)
  add({
    key: "family.unlistedStyles",
    section: "family",
    fieldId: FIELD_IDS.styles,
    severity: "attention",
    tone: "problem",
    scope: ALL,
    label:
      unlisted.length === 1
        ? `Add ${unlisted[0]!.name} to the family`
        : `Add ${unlisted.length} uploaded styles to the family`,
    message: "These faces are uploaded but not in the style list buyers see.",
    satisfied: unlisted.length === 0,
  })

  const productName = values.name.trim().toLowerCase()
  const mismatched =
    family.familyNames.length > 0 &&
    !family.familyNames.some((name) => name.trim().toLowerCase() === productName)
  add({
    key: "family.nameMatchesFiles",
    section: "family",
    fieldId: FIELD_IDS.name,
    severity: "optional",
    tone: "problem",
    scope: ALL,
    label: "Check the family name",
    message: `The font files name the family ${family.familyNames.map((n) => `“${n}”`).join(", ")}.`,
    satisfied: !mismatched,
  })

  add({
    key: "family.version",
    section: "family",
    fieldId: FIELD_IDS.version,
    severity: "optional",
    tone: "missing",
    scope: ALL,
    label: "Add a version",
    message: "Buyers use it to tell an update from the file they already have.",
    satisfied: values.version.trim().length > 0,
  })

  /* ------------------------------------------------------------- coverage */

  add({
    key: "coverage.glyphs",
    section: "coverage",
    fieldId: FIELD_IDS.glyphCount,
    severity: "attention",
    tone: "missing",
    scope: ALL,
    label: "Add the glyph count",
    message: "Detected from your font files, or entered by hand.",
    satisfied: metadata.glyphCount !== undefined,
  })

  add({
    key: "coverage.scripts",
    section: "coverage",
    fieldId: FIELD_IDS.scripts,
    severity: "attention",
    tone: "missing",
    scope: ALL,
    label: "Add supported scripts",
    message: "Buyers filter by script before they look at anything else.",
    satisfied: (metadata.scripts ?? []).length > 0,
  })

  add({
    key: "coverage.languages",
    section: "coverage",
    fieldId: FIELD_IDS.languages,
    severity: "optional",
    tone: "missing",
    scope: ALL,
    label: "List supported languages",
    message: "Optional. Helps a buyer confirm the accents they need are there.",
    satisfied: (metadata.languageSupport ?? []).length > 0,
  })

  /* --------------------------------------------------------------- basics */

  add({
    key: "basics.description",
    section: "basics",
    fieldId: FIELD_IDS.canonicalDescription,
    severity: "attention",
    tone: "missing",
    scope: ALL,
    label: "Write a description",
    message: "Every channel draft starts its description from this one.",
    satisfied: values.canonicalDescription.trim().length > 0,
  })

  add({
    key: "basics.shortDescription",
    section: "basics",
    fieldId: FIELD_IDS.shortDescription,
    severity: "optional",
    tone: "missing",
    scope: { kind: "storefront" },
    label: "Add a short description",
    message: "Shown under the name on your storefront preview and public page.",
    satisfied: values.shortDescription.trim().length > 0,
  })

  add({
    key: "basics.tags",
    section: "basics",
    fieldId: FIELD_IDS.tags,
    severity: "optional",
    tone: "missing",
    scope: ALL,
    label: "Add search tags",
    message: "Words a buyer would search for. Each channel draft keeps its own copy.",
    satisfied: (metadata.tags ?? []).length > 0,
  })

  /* --------------------------------------------------------------- images */

  const readyImages = images.filter((image) => image.state === "ready")
  add({
    key: "images.cover",
    section: "images",
    fieldId: FIELD_IDS.imageDrop,
    severity: "attention",
    tone: "missing",
    scope: ALL,
    label: "Add a cover image",
    message: "Storefront grids and search results lead with the first image.",
    satisfied: readyImages.length > 0,
  })

  const missingAlt = readyImages.filter((image) => image.altText.trim().length === 0)
  add({
    key: "images.altText",
    section: "images",
    fieldId: FIELD_IDS.imageDetails,
    severity: "optional",
    tone: "missing",
    scope: { kind: "storefront" },
    label: missingAlt.length === 1 ? "Describe 1 image" : `Describe ${missingAlt.length} images`,
    message: "Alt text is read aloud to buyers using a screen reader.",
    satisfied: missingAlt.length === 0,
  })

  const cropped = readyImages.filter(
    (image) =>
      image.width !== null &&
      image.height !== null &&
      GRID_SHAPES.every((shape) => cropLoss(image.width!, image.height!, shape.ratio) > 0.25),
  )
  const small = readyImages.filter((image) => image.width !== null && image.width < MIN_HERO_WIDTH)
  add({
    key: "images.shape",
    section: "images",
    fieldId: FIELD_IDS.imageDetails,
    severity: "optional",
    tone: "problem",
    scope: ALL,
    label: "Check image crops",
    message:
      cropped.length > 0
        ? "Some images lose more than a quarter of their area in both square and 4:3 grids."
        : `Some images are narrower than ${MIN_HERO_WIDTH}px and will look soft when enlarged.`,
    satisfied: cropped.length === 0 && small.length === 0,
  })

  /* ------------------------------------------------------------ licensing */

  add({
    key: "licensing.price",
    section: "licensing",
    fieldId: FIELD_IDS.basePrice,
    severity: "blocker",
    tone: "missing",
    scope: ALL,
    label: "Set a base price",
    message: "Channels start from this price. Enter 0 for a free font.",
    satisfied: values.basePrice !== null,
  })

  add({
    key: "licensing.types",
    section: "licensing",
    fieldId: FIELD_IDS.licenseTypes,
    severity: "blocker",
    tone: "missing",
    scope: ALL,
    label: "Choose the licenses you sell",
    message: "Turn on at least one: desktop, web, app or ePub.",
    satisfied: licenses.length > 0,
  })

  add({
    key: "licensing.summary",
    section: "licensing",
    fieldId: FIELD_IDS.licenseSummary,
    severity: "blocker",
    tone: "missing",
    scope: ALL,
    label: "Summarize the license terms",
    message: "Say what a buyer may and may not do. Every listing carries this.",
    satisfied: values.licenseSummary.trim().length > 0,
  })

  add({
    key: "licensing.webTerms",
    section: "licensing",
    fieldId: FIELD_IDS.webLicense,
    severity: "attention",
    // A problem rather than a gap: a web license is on and says nothing about
    // its limits, which is a license a buyer can read two ways.
    tone: "problem",
    scope: ALL,
    label: "Add web license terms",
    message: "A web license needs a monthly pageview limit or written terms.",
    satisfied: !web || web.monthlyPageviews !== undefined || (web.terms ?? "").trim().length > 0,
  })

  const hasWebFormat = files.some(
    (file) => file.state === "ready" && (file.format === "woff2" || file.format === "woff"),
  )
  add({
    key: "licensing.webFiles",
    section: "files",
    fieldId: FIELD_IDS.fileDrop,
    severity: "attention",
    tone: "missing",
    scope: ALL,
    label: "Add WOFF2 files for the web license",
    message: "Web licensees need webfont files. Upload WOFF2 alongside the desktop files.",
    satisfied: !web || readable.length === 0 || hasWebFormat,
  })

  const embeds = licenses.some((license) => license.kind === "web" || license.kind === "app")
  add({
    key: "licensing.embedding",
    section: "licensing",
    fieldId: FIELD_IDS.licenseTypes,
    severity: "attention",
    tone: "problem",
    scope: ALL,
    label: "Font files restrict embedding",
    message:
      "The files are marked restricted, which contradicts a web or app license. Re-export with embedding allowed.",
    satisfied: !embeds || !family.embeddingRestricted,
  })

  add({
    key: "licensing.eula",
    section: "licensing",
    fieldId: FIELD_IDS.eula,
    severity: "optional",
    tone: "missing",
    scope: ALL,
    label: "Attach a EULA",
    message: "A full license document, as a file or a link, alongside the summary.",
    satisfied: input.hasLicenseFile || metadata.eulaUrl !== undefined,
  })

  /* --------------------------------------------------------------- drafts */

  add({
    key: "drafts.channels",
    section: "drafts",
    fieldId: FIELD_IDS.drafts,
    severity: "attention",
    tone: "missing",
    scope: ALL,
    label: "Connect a channel",
    message: "Drafts are derived for each connected channel.",
    satisfied: channels.length > 0,
  })

  for (const channel of channels) {
    const scope: RuleScope = { kind: "channel", channelName: channel.channelName }

    if (channel.listingId === null) {
      add({
        key: `drafts.build.${channel.connectionId}`,
        section: "drafts",
        fieldId: FIELD_IDS.drafts,
        severity: "attention",
        tone: "missing",
        scope,
        label: `Build the ${channel.channelName} draft`,
        message: "Fanwise derives it from the product. Nothing is sent until you publish.",
        satisfied: false,
      })
      continue
    }

    for (const result of channel.results) {
      if (result.severity === "info") continue
      add({
        key: `drafts.${channel.connectionId}.${result.key}`,
        section: "drafts",
        fieldId: FIELD_IDS.drafts,
        severity: result.severity === "error" ? "blocker" : "attention",
        tone: "problem",
        scope,
        label: `${channel.channelName}: ${result.label}`,
        message: result.message ?? result.label,
        satisfied: result.satisfied,
      })
    }

    // An inherited price follows the product and cannot drift from it; a missing
    // product price is already the base-price blocker. Only a price customized
    // for one channel can quietly disagree with the product.
    if (channel.origins.price !== "customized") continue
    add({
      key: `licensing.channelPrice.${channel.connectionId}`,
      section: "licensing",
      fieldId: FIELD_IDS.channelPricing,
      severity: "attention",
      tone: "problem",
      scope,
      label: "Review marketplace pricing",
      message: `The ${channel.channelName} draft sells at its own price of ${channel.price} ${channel.currency}; the product is ${values.basePrice ?? "unpriced"}${values.basePrice === null ? "" : ` ${values.currency}`}.`,
      satisfied: values.basePrice !== null && channel.price === values.basePrice,
    })
  }

  return summarize(rules)
}

const SEVERITY_ORDER: Record<RuleSeverity, number> = { blocker: 0, attention: 1, optional: 2 }

function summarize(rules: ReadinessRule[]): FontReadiness {
  const counted = rules.filter((rule) => rule.severity !== "optional")
  const percent =
    counted.length === 0
      ? 100
      : Math.round((counted.filter((rule) => rule.satisfied).length / counted.length) * 100)

  const issues = rules
    .filter((rule) => !rule.satisfied)
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])

  const blockingAll = issues.filter(
    (rule) => rule.severity === "blocker" && rule.scope.kind === "all",
  )

  const sections = Object.fromEntries(
    FONT_SECTIONS.map((section) => [section, sectionStatus(issues, section)]),
  ) as Record<FontSection, SectionStatus>

  return { rules, issues, percent, blockingAll, sections, canPublish: blockingAll.length === 0 }
}

function sectionStatus(issues: readonly ReadinessRule[], section: FontSection): SectionStatus {
  const own = issues.filter((rule) => rule.section === section && rule.severity !== "optional")
  if (own.some((rule) => rule.severity === "blocker" && rule.tone === "problem")) return "error"
  if (own.some((rule) => rule.severity === "blocker")) return "incomplete"
  if (own.some((rule) => rule.tone === "missing")) return "incomplete"
  if (own.length > 0) return "attention"
  return "complete"
}

/** What a rule blocks, in words, for the issue list. */
export function scopeText(rule: ReadinessRule): string {
  if (rule.severity === "optional") return "Optional"
  if (rule.severity === "attention") {
    return rule.scope.kind === "channel"
      ? `Worth fixing for ${rule.scope.channelName}`
      : "Worth fixing"
  }
  switch (rule.scope.kind) {
    case "all":
      return "Blocks all publishing"
    case "storefront":
      return "Blocks your storefront"
    case "channel":
      return `Blocks ${rule.scope.channelName} only`
  }
}
