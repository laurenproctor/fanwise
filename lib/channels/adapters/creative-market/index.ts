import { listingImages, listingImageSlots } from "@/lib/channels/images"
import type {
  AdapterSubject,
  ChannelAdapter,
  ChannelListingDraft,
  HandoffRenditionSpec,
  ListingChoiceSpec,
  RequirementSpec,
} from "@/lib/channels/types"
import { readImageDimensions } from "@/lib/products/image-metadata"
import type { ImageSpec } from "@/lib/products/derivatives"
import { PACKAGE_LIMITS } from "@/lib/products/package-spec"
import type { ProductAsset } from "@/lib/products/types"
import { readArchive } from "@/lib/fonts/detected"
import { creativeMarketAccountHint, creativeMarketSubmission } from "./account"
import { hasUnsafeSyntax, safePlainText, toSafeMarkdown, wordCount } from "./description"
import {
  CATEGORY_LABELS,
  FONT_LICENSE_SCOPES,
  INSTALLABLE_FONT_EXTENSIONS,
  LETTER_SET_EXTENSIONS,
  baseTier,
  defaultCategory,
  isCategory,
} from "./fields"
import {
  FONT_LICENSE_SCOPE_KEY,
  SUBCATEGORY_KEY,
  buildCreativeMarketHandoff,
  fontLicenseScope,
} from "./handoff"
import { creativeMarketMerchandising } from "./merchandising"
import { attachmentFiles, buyerFiles, creativeMarketPackage } from "./package"

/**
 * Creative Market. The first channel in the plan, and the archetype for
 * every assisted one.
 *
 * The field-level spec is docs/channels/creative-market.md. What is missing
 * from this file is the point: no publish, no update, no oauth. There is no
 * seller API, and the Terms of Use close browser automation in writing
 * (docs/channel-feasibility.md), so Fanwise builds the package, renders the
 * screenshots, composes the listing, hands it over in the editor's order, and
 * records what the creator says happened, every row `self_reported`.
 *
 * The category-drives-license rule is the part to get right (§4): choosing
 * Fonts swaps the whole price schema, and the requirements below read the
 * category before they read a price.
 */

export const LIMITS = {
  titleMax: 60,
  descriptionMinWords: 10,
  imagesMin: 3,
  imagesMax: 100,
  imageMinWidth: 910,
  imageMinHeight: 607,
  imageMaxWidth: 3640,
  imageMaxHeight: 10920,
  /** The build target, §8. */
  screenshotWidth: 1820,
  screenshotHeight: 1214,
  imageBytesMax: 10 * 1024 * 1024,
  imageBytesRecommended: 5 * 1024 * 1024,
  packageBytesMax: 4 * 1024 * 1024 * 1024,
  tagsMin: 1,
  tagsRecommendedMin: 5,
  tagsRecommendedMax: 10,
} as const

/**
 * The one shape this channel adds to the derivative service (§8): 3:2 at the
 * recommended size, JPEG under 5 MB, cropped to the frame with attention to
 * where the picture's interest is. Keyed as a shape, not as a channel.
 */
export const SCREENSHOT_SPEC: ImageSpec = {
  key: "cover-1820x1214",
  width: LIMITS.screenshotWidth,
  height: LIMITS.screenshotHeight,
  format: "jpeg",
  fit: "cover",
  focus: "attention",
  maxByteSize: LIMITS.imageBytesRecommended,
}

/** The same frame at the minimum, for a source that cannot fill the recommended one. */
export const SCREENSHOT_SPEC_SMALL: ImageSpec = {
  key: "cover-910x607",
  width: LIMITS.imageMinWidth,
  height: LIMITS.imageMinHeight,
  format: "jpeg",
  fit: "cover",
  focus: "attention",
  maxByteSize: LIMITS.imageBytesRecommended,
}

function screenshotSpecFor(asset: ProductAsset): ImageSpec {
  const dimensions = readImageDimensions(asset.metadata)
  if (
    dimensions &&
    (dimensions.width < LIMITS.screenshotWidth || dimensions.height < LIMITS.screenshotHeight)
  ) {
    return SCREENSHOT_SPEC_SMALL
  }
  return SCREENSHOT_SPEC
}

/** Sources the engine renders. A GIF is never re-encoded and is handed over as it is. */
function derivable(asset: ProductAsset): boolean {
  return asset.mime_type === "image/jpeg" || asset.mime_type === "image/png"
}

function isGif(asset: ProductAsset): boolean {
  return asset.mime_type === "image/gif"
}

function extensionOf(filename: string): string {
  return filename.match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase() ?? ""
}

/** Every file extension the buyer receives, loose files and inside a package alike. */
function buyerExtensions(assets: readonly ProductAsset[]): Set<string> {
  const out = new Set<string>()
  for (const file of buyerFiles(assets)) {
    const archive = readArchive(file.metadata)
    if (archive.kind === "archive") {
      for (const entry of archive.contents.entries) {
        if (entry.font) out.add(entry.font.format)
        else out.add(extensionOf(entry.path))
      }
    } else {
      out.add(extensionOf(file.filename))
    }
  }
  out.delete("")
  return out
}

function buyerBytes(assets: readonly ProductAsset[]): number {
  return [...buyerFiles(assets), ...attachmentFiles(assets)].reduce(
    (sum, a) => sum + (a.byte_size ?? 0),
    0,
  )
}

/** Tags that are the same search term written twice: case, plural, spacing. */
function tagStem(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .trim()
    .replace(/(ies)$/, "y")
    .replace(/(s)$/, "")
}

const choices: readonly ListingChoiceSpec[] = [
  {
    kind: "text",
    key: SUBCATEGORY_KEY,
    label: "Subcategory",
    description:
      "Creative Market's subcategory tree is not published. Pick it on the form and record it here so the handoff shows it.",
    placeholder: "Sans Serif",
    maxLength: 80,
  },
  {
    kind: "single",
    key: FONT_LICENSE_SCOPE_KEY,
    label: "Font license pricing",
    description:
      "For the Fonts category only. Creative Market prices a family and a single weight differently.",
    options: FONT_LICENSE_SCOPES.map((s) => ({ value: s.value, label: s.label, hint: s.hint })),
  },
]

/** docs/channels/creative-market.md §9, in its order. */
const requirements: readonly RequirementSpec[] = [
  {
    kind: "enum",
    key: "category_selected",
    label: "Category",
    description:
      "One of Creative Market's nine. Locked first: it decides the license and price structure.",
    severity: "error",
    field: "category",
    allowed: CATEGORY_LABELS,
  },
  {
    kind: "custom",
    key: "category_matches_files",
    label: "Files fit the category",
    description: "Fonts means installable OTF or TTF. An EPS or AI letter set is not a font there.",
    severity: "error",
    evaluate(draft, subject) {
      if (draft.category !== "Fonts") return { satisfied: true }
      const extensions = buyerExtensions(subject.assets)
      if (extensions.size === 0) return { satisfied: true }
      const installable = (INSTALLABLE_FONT_EXTENSIONS as readonly string[]).some((e) =>
        extensions.has(e),
      )
      if (installable) return { satisfied: true }
      const letterSet = (LETTER_SET_EXTENSIONS as readonly string[]).some((e) => extensions.has(e))
      return {
        satisfied: false,
        message: letterSet
          ? "An EPS or AI letter set cannot be listed under Fonts. Choose Graphics, or upload the OTF or TTF files."
          : "The Fonts category needs an OTF or TTF file buyers can install.",
      }
    },
  },
  {
    kind: "custom",
    key: "package_format",
    label: "A file to package",
    description: "Fanwise zips the buyer files with a README and the license documents.",
    severity: "error",
    evaluate(_draft, subject) {
      if (buyerFiles(subject.assets).length > 0) return { satisfied: true }
      return {
        satisfied: false,
        message: "Upload the file buyers receive. Fanwise packages it as a zip.",
      }
    },
  },
  {
    kind: "custom",
    key: "package_size",
    label: "Package under 4 GB",
    severity: "error",
    evaluate(_draft, subject) {
      const bytes = buyerBytes(subject.assets)
      if (bytes > LIMITS.packageBytesMax) {
        return { satisfied: false, message: "The files are over Creative Market's 4 GB limit." }
      }
      if (bytes > PACKAGE_LIMITS.maxInputBytes) {
        return {
          satisfied: false,
          message: `Fanwise builds packages up to ${Math.round(PACKAGE_LIMITS.maxInputBytes / (1024 * 1024))} MB. These files are larger.`,
        }
      }
      return { satisfied: true }
    },
  },
  {
    kind: "text",
    key: "title_present",
    label: "Product name",
    description: "House limit of 60. Creative Market's own is unpublished.",
    severity: "error",
    field: "title",
    minLength: 3,
    maxLength: LIMITS.titleMax,
  },
  {
    kind: "custom",
    key: "title_no_shop_name",
    label: "No shop name in the title",
    description: "The name reads on its own in search; the shop is shown beside it.",
    severity: "error",
    evaluate(draft, subject) {
      const brand = subject.product.brand_name?.trim().toLowerCase()
      const title = draft.title?.trim().toLowerCase() ?? ""
      if (!brand || brand.length < 3 || !title.includes(brand)) return { satisfied: true }
      return {
        satisfied: false,
        message: `Take “${subject.product.brand_name!.trim()}” out of the product name.`,
      }
    },
  },
  {
    kind: "custom",
    key: "description_min_words",
    label: "Description of at least 10 words",
    severity: "error",
    evaluate(draft) {
      const words = wordCount(safePlainText(toSafeMarkdown(draft.description)))
      if (words >= LIMITS.descriptionMinWords) return { satisfied: true }
      return {
        satisfied: false,
        message:
          words === 0
            ? "Description is required before you can submit your listing."
            : `The description has ${words} words. Creative Market needs at least ${LIMITS.descriptionMinWords}.`,
      }
    },
  },
  {
    kind: "custom",
    key: "description_markdown_safe",
    label: "Description in Creative Market's subset",
    description:
      "Bold, italic, bulleted lists and a rule. Headings, links, tables and numbered lists are converted.",
    severity: "error",
    evaluate(draft) {
      if (!hasUnsafeSyntax(toSafeMarkdown(draft.description))) return { satisfied: true }
      return {
        satisfied: false,
        message: "The description still holds formatting Creative Market renders as text.",
      }
    },
  },
  {
    kind: "custom",
    key: "images_min",
    label: "At least three screenshots",
    description: "Creative Market takes two media items; Fanwise asks for three images.",
    severity: "error",
    evaluate(_draft, subject) {
      const count = listingImages(subject).filter((a) => derivable(a) || isGif(a)).length
      if (count >= LIMITS.imagesMin) return { satisfied: true }
      const more = LIMITS.imagesMin - count
      return { satisfied: false, message: `Add ${more} more image${more === 1 ? "" : "s"}.` }
    },
  },
  {
    kind: "custom",
    key: "image_dimensions",
    label: "Images at least 910 × 607",
    description:
      "Screenshots are built at 1820 × 1214, or at the minimum when the source cannot fill it. Nothing is enlarged.",
    severity: "error",
    evaluate(_draft, subject) {
      for (const image of listingImages(subject)) {
        const d = readImageDimensions(image.metadata)
        if (!d) continue
        if (d.width < LIMITS.imageMinWidth || d.height < LIMITS.imageMinHeight) {
          return {
            satisfied: false,
            message: `${image.filename} is ${d.width} × ${d.height}. Creative Market needs at least ${LIMITS.imageMinWidth} × ${LIMITS.imageMinHeight}.`,
          }
        }
        if (isGif(image) && (d.width > LIMITS.imageMaxWidth || d.height > LIMITS.imageMaxHeight)) {
          return {
            satisfied: false,
            message: `${image.filename} is larger than ${LIMITS.imageMaxWidth} × ${LIMITS.imageMaxHeight}, and a GIF cannot be resized.`,
          }
        }
      }
      return { satisfied: true }
    },
  },
  {
    kind: "custom",
    key: "image_format",
    label: "JPG, PNG or GIF images",
    severity: "error",
    evaluate(_draft, subject) {
      const bad = listingImages(subject).find((a) => !derivable(a) && !isGif(a))
      if (!bad) return { satisfied: true }
      return { satisfied: false, message: `${bad.filename} is not a JPG, PNG or GIF.` }
    },
  },
  {
    kind: "custom",
    key: "image_size_max",
    label: "Images under 10 MB",
    description: "Rendered screenshots land under 5 MB. A GIF is handed over as uploaded.",
    severity: "error",
    evaluate(_draft, subject) {
      const big = listingImages(subject).find(
        (a) => isGif(a) && (a.byte_size ?? 0) > LIMITS.imageBytesMax,
      )
      if (!big) return { satisfied: true }
      return { satisfied: false, message: `${big.filename} is over Creative Market's 10 MB limit.` }
    },
  },
  {
    kind: "custom",
    key: "price_floor",
    label: "Price at or above the floor",
    description:
      "Creative Market refuses a price under its floor for the category and license. A low canonical price is flagged, never raised.",
    severity: "error",
    evaluate(draft, subject) {
      if (draft.price === null) {
        return {
          satisfied: false,
          message: "Price is required before you can submit your listing.",
        }
      }
      if (!isCategory(draft.category)) return { satisfied: true }
      const tier = baseTier(
        draft.category,
        subject.product.product_type,
        fontLicenseScope(draft.metadata),
      )
      if (tier.floor === null || draft.price >= tier.floor) return { satisfied: true }
      return {
        satisfied: false,
        message: `${tier.label} must be at least ${tier.floor.toFixed(2)} USD on Creative Market. The price is ${draft.price.toFixed(2)}.`,
      }
    },
  },
  {
    kind: "custom",
    key: "ai_disclosure_set",
    label: "Generative AI disclosure answered",
    description: "Creative Market requires a yes or no. Answered on the product, never composed.",
    severity: "error",
    evaluate(_draft, subject) {
      if (
        subject.product.made_with_generative_ai !== null &&
        subject.product.made_with_generative_ai !== undefined
      ) {
        return { satisfied: true }
      }
      return {
        satisfied: false,
        message:
          "Answer the generative AI question on the product before you can submit your listing.",
      }
    },
  },
  {
    kind: "tags",
    key: "tags_min",
    label: "At least one search tag",
    severity: "error",
    minCount: LIMITS.tagsMin,
  },
  {
    kind: "custom",
    key: "image_size",
    label: "Images under 5 MB",
    severity: "warning",
    evaluate(_draft, subject) {
      const big = listingImages(subject).find(
        (a) => isGif(a) && (a.byte_size ?? 0) > LIMITS.imageBytesRecommended,
      )
      if (!big) return { satisfied: true }
      return {
        satisfied: false,
        message: `${big.filename} is over the 5 MB Creative Market recommends.`,
      }
    },
  },
  {
    kind: "tags",
    key: "tag_count",
    label: "Five to ten search tags",
    severity: "warning",
    minCount: LIMITS.tagsRecommendedMin,
    maxCount: LIMITS.tagsRecommendedMax,
  },
  {
    kind: "custom",
    key: "tag_quality",
    label: "No near-duplicate tags",
    severity: "warning",
    evaluate(draft) {
      const seen = new Map<string, string>()
      for (const tag of draft.tags) {
        const stem = tagStem(tag)
        const earlier = seen.get(stem)
        if (earlier !== undefined && earlier !== tag) {
          return {
            satisfied: false,
            message: `“${tag}” repeats “${earlier}”. Search treats them as one.`,
          }
        }
        seen.set(stem, tag)
      }
      return { satisfied: true }
    },
  },
  {
    kind: "custom",
    key: "font_license_file",
    label: "A license document with the font",
    description: "Not required by Creative Market. Buyers expect one, and the package includes it.",
    severity: "warning",
    evaluate(draft, subject) {
      if (draft.category !== "Fonts") return { satisfied: true }
      if (subject.assets.some((a) => a.asset_state === "ready" && a.asset_type === "license")) {
        return { satisfied: true }
      }
      return {
        satisfied: false,
        message: "Upload a license file so the package carries the terms.",
      }
    },
  },
  {
    kind: "custom",
    key: "mixed_content_license",
    label: "Mixed content",
    severity: "info",
    evaluate(draft, subject) {
      const extensions = buyerExtensions(subject.assets)
      const hasFont = (INSTALLABLE_FONT_EXTENSIONS as readonly string[]).some((e) =>
        extensions.has(e),
      )
      const hasGraphic = ["png", "jpg", "jpeg", "svg", "eps", "ai", "psd", "pdf"].some((e) =>
        extensions.has(e),
      )
      if (draft.category === "Fonts" && hasGraphic) {
        return {
          satisfied: true,
          message:
            "A font product with graphics grants the chosen font license plus a Commercial License on the graphics.",
        }
      }
      if (draft.category !== null && draft.category !== "Fonts" && hasFont) {
        return {
          satisfied: true,
          message:
            "A product with fonts inside grants the chosen tier plus a Desktop License on the fonts.",
        }
      }
      return { satisfied: true }
    },
  },
  {
    kind: "custom",
    key: "theme_license",
    label: "WordPress themes",
    severity: "info",
    evaluate(_draft, subject) {
      if (subject.product.product_type !== "theme") return { satisfied: true }
      return {
        satisfied: true,
        message:
          "A WordPress theme is sold under GPL 2.0 alone on Creative Market, with no tier to choose.",
      }
    },
  },
]

export const creativeMarketAdapter: ChannelAdapter = {
  key: "creative_market",
  name: "Creative Market",
  integrationType: "assisted",
  fields: ["title", "description", "price", "category", "tags", "seoTitle", "seoDescription"],
  capabilities: {
    // Every false here is the permanent kind: the provider cannot. No seller
    // API, and the terms forbid the alternative (docs/channels/creative-market.md §3).
    automaticPublish: false,
    automaticUpdate: false,
    metrics: false,
    transactions: false,
    digitalFileUpload: false,
    imageUpload: false,
    // Creative Market's own Draft state, set by the seller.
    drafts: true,
  },
  requirements,
  manualSteps: [],
  merchandising: creativeMarketMerchandising,
  accountHint: creativeMarketAccountHint,
  choices,
  submission: creativeMarketSubmission,

  buildListing({ product }: AdapterSubject): ChannelListingDraft {
    return {
      // Title, description and price are left empty: an empty field uses the
      // product's value when the listing is read (lib/channels/listings.ts).
      title: null,
      description: null,
      shortDescription: null,
      seoTitle: null,
      seoDescription: null,
      price: null,
      currency: product.currency,
      category: defaultCategory(product.product_type),
      tags: [],
      metadata: {
        [SUBCATEGORY_KEY]: null,
        [FONT_LICENSE_SCOPE_KEY]: "family",
      },
    }
  },

  /** Every image once, at the recommended frame, in channel order. A GIF is passed through. */
  handoffImages(subject: AdapterSubject): HandoffRenditionSpec[] {
    return listingImages(subject)
      .slice(0, LIMITS.imagesMax)
      .flatMap((asset, position) =>
        derivable(asset)
          ? [{ source: asset, spec: screenshotSpecFor(asset), role: "screenshot", position }]
          : [],
      )
  },

  handoffPackage: creativeMarketPackage,
  buildHandoff: buildCreativeMarketHandoff,

  // No publish. No update. No unpublish. No oauth. Deliberately.
}

export { listingImageSlots }
