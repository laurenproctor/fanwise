import {
  formatHandoffPrice,
  textStep,
  type HandoffFile,
  type HandoffStep,
} from "@/lib/channels/handoff"
import type { HandoffInput, HandoffRendition } from "@/lib/channels/types"
import { readPackageManifest } from "@/lib/products/package-spec"
import { parseMetadata } from "@/lib/products/metadata"
import { safeMarkdownToHtml, safePlainText, toSafeMarkdown, wordCount } from "./description"
import {
  baseTier,
  fontTiers,
  isCategory,
  isFontLicenseScope,
  licenseShapeFor,
  standardTiers,
  type FontLicenseScope,
  type Tier,
} from "./fields"

/**
 * The handoff, ordered to Creative Market's editor. docs/channels/creative-market.md §10.
 *
 * Their documented order: category, files, name, description, screenshots,
 * prices, tags, set Live, Save all Changes. The generative AI disclosure sits
 * with the description on the observed form. Each step is its own section
 * so the panel numbers them as the spec draws them, and the creator moves
 * top to bottom in both windows.
 */

export const SUBCATEGORY_KEY = "subcategory"
export const FONT_LICENSE_SCOPE_KEY = "fontLicenseScope"

export const SECTIONS = {
  category: "Category",
  files: "Product files",
  name: "Product name",
  description: "Description",
  screenshots: "Screenshots",
  prices: "Prices",
  tags: "Tags",
  disclosure: "Generative AI disclosure",
  search: "Search engine listing",
  live: "Set live",
} as const

export function fontLicenseScope(metadata: Record<string, unknown>): FontLicenseScope {
  const raw = metadata[FONT_LICENSE_SCOPE_KEY]
  return isFontLicenseScope(raw) ? raw : "family"
}

export function subcategory(metadata: Record<string, unknown>): string | null {
  const raw = metadata[SUBCATEGORY_KEY]
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null
}

/** `01-`, `02-`: the upload order is the filename order, and the first is the thumbnail. */
function numbered(position: number, filename: string): string {
  return `${String(position + 1).padStart(2, "0")}-${filename}`
}

/** Creative Market prices in USD whatever the listing's currency says, so the floor is quoted in it. */
function floorNote(tier: Tier): string {
  if (tier.floor === null) return "Creative Market publishes no floor for this category."
  const amount = `${tier.floor.toFixed(2)} USD`
  return tier.verified
    ? `Creative Market's floor is ${amount}.`
    : `The application form showed ${amount}; unconfirmed from a live shop.`
}

/**
 * The screenshots in channel order: a rendition where the engine built one,
 * the source itself for a GIF, which is handed over as uploaded.
 */
export function screenshotFiles(input: HandoffInput): HandoffFile[] {
  const byPosition = new Map<number, HandoffRendition>()
  for (const r of input.renditions) if (r.role === "screenshot") byPosition.set(r.position, r)
  const out: HandoffFile[] = []
  // Positions count the ready images only, which is what `handoffImages` counted:
  // the page lists every slot, and an upload still in flight must not shift
  // the numbering of the ones that are done.
  input.images
    .filter((image) => image.ready)
    .forEach((image, position) => {
      const rendition = byPosition.get(position)
      if (rendition) {
        if (rendition.asset && rendition.asset.asset_state === "ready") {
          const name = numbered(position, rendition.asset.filename)
          out.push({ assetId: rendition.asset.id, filename: name, downloadAs: name })
        }
        return
      }
      if (/\.gif$/i.test(image.filename)) {
        const name = numbered(position, image.filename)
        out.push({ assetId: image.assetId, filename: name, downloadAs: name })
      }
    })
  return out
}

export function buildCreativeMarketHandoff(input: HandoffInput): HandoffStep[] {
  const { draft, subject } = input
  const metadata = draft.metadata
  const steps: HandoffStep[] = []
  const category = isCategory(draft.category) ? draft.category : null
  const sub = subcategory(metadata)

  // 1. Category
  steps.push(
    category
      ? {
          kind: "copy",
          key: "category",
          label: "Category",
          section: SECTIONS.category,
          value: sub ? `${category} › ${sub}` : category,
          multiline: false,
          note: "Locked first. This sets the license and price structure.",
        }
      : { kind: "missing", key: "category", label: "Category", section: SECTIONS.category },
  )

  // 2. Product files
  const pkg = input.package ?? null
  if (pkg?.asset) {
    const manifest = readPackageManifest(pkg.asset.metadata)
    const size = pkg.asset.byte_size ?? 0
    const mb =
      size >= 1024 * 1024
        ? `${(size / (1024 * 1024)).toFixed(0)} MB`
        : `${Math.ceil(size / 1024)} KB`
    const summary = manifest
      ? `Contains ${manifest.entryCount} file${manifest.entryCount === 1 ? "" : "s"}: ${manifest.entries.slice(0, 6).join(", ")}${manifest.entryCount > 6 ? ", …" : ""}.`
      : ""
    steps.push({
      kind: "files",
      key: "package",
      label: "Package",
      section: SECTIONS.files,
      files: [
        { assetId: pkg.asset.id, filename: pkg.spec.filename, downloadAs: pkg.spec.filename },
      ],
      note: `${mb}. ${summary} Upload this one zip as the product file.`.trim(),
    })
  } else {
    steps.push({ kind: "missing", key: "package", label: "Package", section: SECTIONS.files })
  }

  // 3. Product name
  steps.push(textStep("title", "Product name", draft.title, false, SECTIONS.name))

  // 4. Description, formatted for a rich-text editor with the words as fallback
  const safe = toSafeMarkdown(draft.description)
  const plain = safePlainText(safe)
  steps.push(
    plain.trim().length === 0
      ? { kind: "missing", key: "description", label: "Description", section: SECTIONS.description }
      : {
          kind: "copy",
          key: "description",
          label: "Description",
          section: SECTIONS.description,
          value: plain,
          html: safeMarkdownToHtml(safe),
          multiline: true,
          note: `${wordCount(plain)} words. Copies as formatted text: bold, italics and bulleted lists survive, nothing else does.`,
        },
  )

  // 5. Screenshots
  const screenshots = screenshotFiles(input)
  steps.push(
    screenshots.length === 0
      ? { kind: "missing", key: "screenshots", label: "Screenshots", section: SECTIONS.screenshots }
      : {
          kind: "files",
          key: "screenshots",
          label: "Screenshots",
          section: SECTIONS.screenshots,
          files: screenshots,
          note: "Upload in filename order. The first becomes the thumbnail.",
        },
  )

  // 6. Prices: the listing's price is the first tier; the rest are the form's
  // own fields, with the floor beside each so nothing is typed under it.
  if (category) {
    const shape = licenseShapeFor(category)
    const scope = fontLicenseScope(metadata)
    const tiers =
      shape === "font" ? fontTiers(scope) : standardTiers(category, subject.product.product_type)
    const base = baseTier(category, subject.product.product_type, scope)
    const fontPrices = new Map<string, number>()
    if (shape === "font") {
      const meta = parseMetadata(subject.product.metadata)
      if (meta.kind === "font") {
        for (const license of meta.licenses ?? []) {
          if (license.price !== undefined) fontPrices.set(license.kind, license.price)
        }
      }
    }
    for (const tier of tiers) {
      const label =
        shape === "font"
          ? `${tier.label} (${scope === "family" ? "family" : "individual weight"})`
          : tier.label
      const price =
        tier.key === base.key
          ? draft.price
          : shape === "font"
            ? (fontPrices.get(tier.key) ?? null)
            : null
      steps.push(
        price === null
          ? {
              kind: "note",
              key: `price_${tier.key}`,
              label,
              section: SECTIONS.prices,
              text:
                tier.key === base.key
                  ? "Set the listing's price first."
                  : `Type this price on Creative Market. ${floorNote(tier)}`,
            }
          : {
              kind: "copy",
              key: `price_${tier.key}`,
              label: `${label}, ${draft.currency}`,
              section: SECTIONS.prices,
              value: formatHandoffPrice(price),
              multiline: false,
              note: floorNote(tier),
            },
      )
    }
  } else {
    steps.push({ kind: "missing", key: "price_base", label: "Prices", section: SECTIONS.prices })
  }

  // 7. Tags
  steps.push(
    textStep(
      "tags",
      "Search tags",
      draft.tags.length > 0 ? draft.tags.join(", ") : null,
      false,
      SECTIONS.tags,
    ),
  )

  // 8. Generative AI disclosure, from the product record
  const disclosure = subject.product.made_with_generative_ai
  steps.push(
    disclosure === null || disclosure === undefined
      ? { kind: "missing", key: "disclosure", label: "Answer", section: SECTIONS.disclosure }
      : {
          kind: "note",
          key: "disclosure",
          label: `Answer: ${disclosure ? "Yes" : "No"}`,
          section: SECTIONS.disclosure,
          text: "Taken from the product record. Change it there, not here.",
        },
  )

  // 9. Search engine listing, optional
  if (draft.seoTitle?.trim() || draft.seoDescription?.trim()) {
    if (draft.seoTitle?.trim()) {
      steps.push(textStep("seo_title", "Page title", draft.seoTitle, false, SECTIONS.search))
    }
    if (draft.seoDescription?.trim()) {
      steps.push(
        textStep(
          "seo_description",
          "Meta description",
          draft.seoDescription,
          true,
          SECTIONS.search,
        ),
      )
    }
  }

  // 10. Live
  steps.push({
    kind: "submit",
    key: "submit",
    label: "Set the product Live, then Save all Changes",
    section: SECTIONS.live,
    text: "Creative Market puts a saved product live at once; there is no review queue. Then paste the listing's address below. Fanwise sends nothing to Creative Market.",
  })

  return steps
}
