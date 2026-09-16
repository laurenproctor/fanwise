import { markdownToPlainText } from "@/lib/text/markdown"
import { METADATA_KIND_BY_PRODUCT_TYPE } from "@/lib/products/metadata"
import { detailFieldsFor, DETAIL_LABELS } from "./facts"
import type { DraftDetails } from "./draft-output"
import type { BuyerDeliverable, ListingDraft } from "./types"

/**
 * What an import still lacks, and what would supply it.
 *
 * The five readiness steps say whether the import may go on to marketplace
 * drafts. This is the other question a creator asks of the screen: "why is
 * the listing thin, and what do I give Fanwise to fix it?" A model answers it
 * in `missingInformation` with whatever it noticed; this answers it the same
 * way every time, from what the draft and the product actually hold, and says
 * for each gap which upload or which sentence closes it.
 *
 * Pure and total. The same draft always yields the same gaps, in the same
 * order, and none of them is a required field: those are `listingIssues`, and
 * naming them twice would be two lists that disagree about one thing.
 */

export interface ListingGap {
  readonly key: string
  /** What is missing, as a noun. */
  readonly label: string
  /** How to supply it: the upload or the words that close the gap. */
  readonly how: string
}

export interface ListingGapsInput {
  readonly draft: ListingDraft
  readonly deliverables: readonly BuyerDeliverable[]
  /** Cover and preview images the product holds, in any state. */
  readonly imageCount: number
}

/** Below this many words of description, a buyer is being told very little. */
const THIN_DESCRIPTION_WORDS = 60

const FILES_HOW: Record<ReturnType<typeof kindOf>, string> = {
  font: "Upload the OTF, TTF or WOFF files. Fanwise reads the styles, formats, glyph count and language coverage from them.",
  template: "Upload the template files a buyer receives.",
  raster: "Upload the files a buyer receives.",
  generic: "Upload the files a buyer receives.",
}

const DETAIL_HOW: Record<ReturnType<typeof kindOf>, string> = {
  font: "Upload the font files and Fanwise reads it from them, or state it in a pasted description or a recording.",
  template: "State it in a pasted description, a PDF or a recording.",
  raster: "State it in a pasted description, a PDF or a recording.",
  generic: "",
}

function kindOf(draft: ListingDraft) {
  const type = draft.productType.value
  return type ? METADATA_KIND_BY_PRODUCT_TYPE[type] : "generic"
}

/** Detail fields grouped so one gap names one thing a buyer asks about. */
const DETAIL_GAPS: ReadonlyArray<{
  key: string
  label: string
  fields: ReadonlyArray<keyof DraftDetails>
}> = [
  { key: "styles", label: DETAIL_LABELS.styleCount, fields: ["styleCount", "styleNames"] },
  { key: "formats", label: DETAIL_LABELS.fontFormats, fields: ["fontFormats"] },
  { key: "glyphs", label: DETAIL_LABELS.glyphCount, fields: ["glyphCount"] },
  { key: "coverage", label: "Language coverage", fields: ["scripts", "languages"] },
  { key: "classification", label: DETAIL_LABELS.classification, fields: ["classification"] },
  { key: "software", label: DETAIL_LABELS.software, fields: ["software"] },
  { key: "pages", label: DETAIL_LABELS.pageCount, fields: ["pageCount"] },
  { key: "dimensions", label: DETAIL_LABELS.dimensions, fields: ["dimensions"] },
  { key: "fileFormats", label: DETAIL_LABELS.fileFormats, fields: ["fileFormats"] },
  { key: "items", label: DETAIL_LABELS.itemCount, fields: ["itemCount"] },
]

function isEmpty(value: DraftDetails[keyof DraftDetails]): boolean {
  return value === null || (Array.isArray(value) && value.length === 0)
}

export function listingGaps(input: ListingGapsInput): ListingGap[] {
  const { draft, deliverables, imageCount } = input
  const gaps: ListingGap[] = []
  const kind = kindOf(draft)

  if (!deliverables.some((file) => file.state === "ready")) {
    gaps.push({ key: "files", label: "Buyer files", how: FILES_HOW[kind] })
  }

  if (imageCount === 0) {
    gaps.push({
      key: "images",
      label: "Preview images",
      how: "Upload a cover image and previews on the product page. The source offered none Fanwise could import.",
    })
  }

  if (draft.shortDescription.value.trim().length === 0) {
    gaps.push({
      key: "shortDescription",
      label: "Short description",
      how: "One or two sentences for the listing card and the public page's summary. Fanwise proposes one from a fuller source.",
    })
  }

  const words = markdownToPlainText(draft.description.value).split(/\s+/).filter(Boolean).length
  if (words > 0 && words < THIN_DESCRIPTION_WORDS) {
    gaps.push({
      key: "description",
      label: "A fuller description",
      how: "Paste the product's own page text, add a PDF or HTML specimen, or record yourself describing it, and Fanwise composes from all of it.",
    })
  }

  if (draft.tags.value.length === 0) {
    gaps.push({
      key: "tags",
      label: "Tags",
      how: "Search keywords a buyer would type. Fanwise proposes them from the sources; add a fuller source or type a few.",
    })
  }

  const type = draft.productType.value
  if (type) {
    const held = new Set(detailFieldsFor(type))
    for (const gap of DETAIL_GAPS) {
      const relevant = gap.fields.filter((field) => held.has(field))
      if (relevant.length === 0) continue
      if (relevant.every((field) => isEmpty(draft.details.value[field]))) {
        gaps.push({ key: gap.key, label: gap.label, how: DETAIL_HOW[kind] })
      }
    }
  }

  return gaps
}
