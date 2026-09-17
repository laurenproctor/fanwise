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
import type { ProductAsset } from "@/lib/products/types"
import { behanceAccountHint, behanceSubmission } from "./account"
import { MINIMUM_PRICE, feeSentence } from "./fees"
import {
  ASSET_CATEGORY_LABELS,
  CREATIVE_FIELDS,
  LICENSE_TYPES,
  defaultAssetCategory,
  defaultCreativeFields,
  isCreativeField,
  isLicenseType,
  recommendedLicense,
} from "./fields"
import {
  CREATIVE_FIELDS_KEY,
  EXISTING_PROJECT_URL_KEY,
  HANDOFF_MODE_KEY,
  LICENSE_TYPE_KEY,
  buildBehanceHandoff,
  creativeFields,
  handoffMode,
} from "./handoff"
import { behanceMerchandising } from "./merchandising"

/**
 * Behance. The second assisted channel, and the first whose unit is a
 * portfolio project rather than a product.
 *
 * The field-level spec is docs/channels/behance.md. What is missing from this
 * file is the point: no publish, no update, no oauth. Behance's API is
 * read-only and closed, and Adobe's terms forbid the alternative, so Fanwise
 * composes the project and the asset, hands them over, and records what the
 * creator says happened, every row `self_reported`.
 *
 * One product becomes one project carrying one asset (§4). The handoff runs
 * in two modes, chosen on the listing: a new project, or an asset attached to
 * a project the creator already has.
 */

export const LIMITS = {
  titleMax: 60,
  tagsMax: 10,
  packageBytesMax: 500 * 1024 * 1024,
  /** The cover's minimum on Behance, and the build target at twice it. */
  coverMinWidth: 808,
  coverMinHeight: 632,
  coverWidth: 1616,
  coverHeight: 1264,
  projectImageEdge: 2800,
  projectImageBytesMax: 10 * 1024 * 1024,
  exampleImagesMax: 20,
} as const

/**
 * The file types the asset form accepts, from the "over 25" the help center
 * lists by example. A zip covers everything else, and a product delivered as
 * several files ships as one (§7).
 */
const ACCEPTED_EXTENSIONS = [
  "zip",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "svg",
  "psd",
  "ai",
  "pdf",
  "ttf",
  "otf",
  "woff",
  "woff2",
  "eps",
  "indd",
  "sketch",
  "fig",
  "xd",
  "abr",
  "obj",
  "fbx",
  "blend",
  "mp4",
  "mov",
  "mp3",
  "wav",
] as const

const DELIVERABLE_TYPES = ["deliverable", "archive"] as const

function deliverables(assets: readonly ProductAsset[]): ProductAsset[] {
  return assets.filter(
    (a) =>
      a.asset_state === "ready" && (DELIVERABLE_TYPES as readonly string[]).includes(a.asset_type),
  )
}

function extensionOf(filename: string): string {
  return filename.match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase() ?? ""
}

/**
 * The two shapes this channel adds to the derivative service (§8). Keyed as
 * shapes rather than as a channel, like every other spec in the catalog.
 *
 * The cover is cropped to Behance's 1.278:1 at twice the minimum, or at the
 * minimum itself when the source cannot fill the larger frame: the engine
 * refuses to enlarge, and a cover at the minimum beats no cover.
 */
export const COVER_SPEC: ImageSpec = {
  key: "cover-1616x1264",
  width: LIMITS.coverWidth,
  height: LIMITS.coverHeight,
  format: "jpeg",
  fit: "cover",
  focus: "attention",
}

export const COVER_SPEC_SMALL: ImageSpec = {
  key: "cover-808x632",
  width: LIMITS.coverMinWidth,
  height: LIMITS.coverMinHeight,
  format: "jpeg",
  fit: "cover",
  focus: "attention",
}

/** Project and example images: 2800 wide or smaller, under 10 MB, never cropped. */
export function projectImageSpec(mime: string | null): ImageSpec {
  const format = mime === "image/png" ? "png" : "jpeg"
  return {
    key: `fit-${LIMITS.projectImageEdge}-${format}`,
    width: LIMITS.projectImageEdge,
    height: LIMITS.projectImageEdge,
    format,
    fit: "inside",
    maxByteSize: LIMITS.projectImageBytesMax,
  }
}

function coverSpecFor(asset: ProductAsset): ImageSpec {
  const dimensions = readImageDimensions(asset.metadata)
  if (
    dimensions &&
    (dimensions.width < LIMITS.coverWidth || dimensions.height < LIMITS.coverHeight)
  ) {
    return COVER_SPEC_SMALL
  }
  return COVER_SPEC
}

function coverImage(subject: AdapterSubject): ProductAsset | undefined {
  return listingImages(subject).find((a) => a.asset_type === "cover_image")
}

/** Sources the engine can render: a GIF is never re-encoded, and a cover is never a GIF. */
function derivable(asset: ProductAsset): boolean {
  return (
    asset.mime_type !== null &&
    asset.mime_type.startsWith("image/") &&
    asset.mime_type !== "image/gif"
  )
}

const choices: readonly ListingChoiceSpec[] = [
  {
    kind: "single",
    key: HANDOFF_MODE_KEY,
    label: "How to submit",
    description: "One product becomes one project with one downloadable asset.",
    options: [
      { value: "new", label: "New project", hint: "Fanwise composes the project and the asset." },
      {
        value: "existing",
        label: "Existing project",
        hint: "You already have a project for this. Fanwise composes only the asset.",
      },
    ],
  },
  {
    kind: "text",
    key: EXISTING_PROJECT_URL_KEY,
    label: "The project's address",
    placeholder: "https://www.behance.net/gallery/…",
    maxLength: 500,
    showWhen: { key: HANDOFF_MODE_KEY, value: "existing" },
  },
  {
    kind: "multiple",
    key: CREATIVE_FIELDS_KEY,
    label: "Creative Fields",
    description:
      "Behance's own list. At least one is required to make a project public. Suggested from the product type; confirm or change them.",
    options: CREATIVE_FIELDS.map((f) => ({ value: f.label, label: f.label })),
  },
  {
    kind: "single",
    key: LICENSE_TYPE_KEY,
    label: "License type",
    description:
      "One of the two Behance offers. Recommended from the product's license summary; Fanwise never grants more than the product does.",
    options: LICENSE_TYPES.map((l) => ({ value: l.value, label: l.label, hint: l.hint })),
  },
]

/** docs/channels/behance.md §9, in its order. */
const requirements: readonly RequirementSpec[] = [
  {
    kind: "custom",
    key: "creative_field_mapped",
    label: "At least one Creative Field",
    description: "Behance refuses to make a project public without one.",
    severity: "error",
    evaluate(draft) {
      if (handoffMode(draft.metadata) === "existing") return { satisfied: true }
      const fields = creativeFields(draft.metadata)
      if (fields.length === 0) {
        return { satisfied: false, message: "Choose at least one Creative Field for the project." }
      }
      const unknown = fields.find((f) => !isCreativeField(f))
      if (unknown) {
        return {
          satisfied: false,
          message: `${unknown} is not a Creative Field this channel lists.`,
        }
      }
      return { satisfied: true }
    },
  },
  {
    kind: "enum",
    key: "category_mapped",
    label: "Asset category",
    description: "One of the five in Behance's dropdown.",
    severity: "error",
    field: "category",
    allowed: ASSET_CATEGORY_LABELS,
  },
  {
    kind: "custom",
    key: "license_selected",
    label: "License type",
    description: "Personal or Standard Commercial, chosen per asset.",
    severity: "error",
    evaluate(draft) {
      if (isLicenseType(draft.metadata[LICENSE_TYPE_KEY])) return { satisfied: true }
      return { satisfied: false, message: "Choose the license the asset is sold under." }
    },
  },
  {
    kind: "custom",
    key: "existing_project_url",
    label: "The existing project's address",
    description: "In existing-project mode, the project the asset is attached to.",
    severity: "error",
    evaluate(draft) {
      if (handoffMode(draft.metadata) !== "existing") return { satisfied: true }
      const raw = draft.metadata[EXISTING_PROJECT_URL_KEY]
      const parsed = behanceSubmission.parseUrl(typeof raw === "string" ? raw : "")
      return parsed.ok ? { satisfied: true } : { satisfied: false, message: parsed.message }
    },
  },
  {
    kind: "text",
    key: "title_present",
    label: "Title",
    description: "House limit of 60. Behance's own is unpublished.",
    severity: "error",
    field: "title",
    minLength: 3,
    maxLength: LIMITS.titleMax,
  },
  {
    kind: "custom",
    key: "price_present",
    label: "Price",
    description: "Free, or at least the card processor's minimum charge of 0.50.",
    severity: "error",
    evaluate(draft) {
      if (draft.price === null) {
        return {
          satisfied: false,
          message: "Price is required before you can submit your listing.",
        }
      }
      if (draft.price === 0 || draft.price >= MINIMUM_PRICE) return { satisfied: true }
      return {
        satisfied: false,
        message: `Set the price to at least ${MINIMUM_PRICE.toFixed(2)}, or to 0 to make it free.`,
      }
    },
  },
  {
    kind: "custom",
    key: "package_single_file",
    label: "One file for the asset",
    description: "An asset holds one file. Several files ship as one zip.",
    severity: "error",
    evaluate(_draft, subject) {
      const files = deliverables(subject.assets)
      if (files.length === 0) {
        return { satisfied: false, message: "Upload the file the buyer receives." }
      }
      if (files.length > 1) {
        return {
          satisfied: false,
          message: `There are ${files.length} buyer files. Combine them into one zip and upload that as the product's archive.`,
        }
      }
      return { satisfied: true }
    },
  },
  {
    kind: "custom",
    key: "package_size",
    label: "File under 500 MB",
    severity: "error",
    evaluate(_draft, subject) {
      const tooBig = deliverables(subject.assets).find(
        (f) => (f.byte_size ?? 0) > LIMITS.packageBytesMax,
      )
      if (!tooBig) return { satisfied: true }
      return { satisfied: false, message: `${tooBig.filename} is over Behance's 500 MB limit.` }
    },
  },
  {
    kind: "custom",
    key: "package_type",
    label: "A file type Behance accepts",
    description: "Any of the types Behance lists, or a zip.",
    severity: "error",
    evaluate(_draft, subject) {
      const bad = deliverables(subject.assets).find(
        (f) => !(ACCEPTED_EXTENSIONS as readonly string[]).includes(extensionOf(f.filename)),
      )
      if (!bad) return { satisfied: true }
      return {
        satisfied: false,
        message: `${bad.filename} is not a type Behance lists. Zip it and upload the zip.`,
      }
    },
  },
  {
    kind: "custom",
    key: "cover_image",
    label: "A cover image",
    description: "Required to make a project public. At least 808 × 632, JPEG or PNG, never a GIF.",
    severity: "error",
    evaluate(_draft, subject) {
      const cover = coverImage(subject)
      if (!cover) {
        return {
          satisfied: false,
          message: "A cover image is required before you can submit your listing.",
        }
      }
      if (!derivable(cover)) {
        return { satisfied: false, message: "Behance refuses a GIF as a cover. Use a JPEG or PNG." }
      }
      const dimensions = readImageDimensions(cover.metadata)
      if (
        dimensions &&
        (dimensions.width < LIMITS.coverMinWidth || dimensions.height < LIMITS.coverMinHeight)
      ) {
        return {
          satisfied: false,
          message: `The cover is ${dimensions.width} × ${dimensions.height}. Behance needs at least ${LIMITS.coverMinWidth} × ${LIMITS.coverMinHeight}.`,
        }
      }
      return { satisfied: true }
    },
  },
  {
    kind: "custom",
    key: "images_min",
    label: "At least three images",
    description: "The project canvas is judged before anything else is read.",
    severity: "error",
    evaluate(draft, subject) {
      if (handoffMode(draft.metadata) === "existing") return { satisfied: true }
      const count = listingImages(subject).length
      if (count >= 3) return { satisfied: true }
      return {
        satisfied: false,
        message: `Add ${3 - count} more image${3 - count === 1 ? "" : "s"}.`,
      }
    },
  },
  {
    kind: "custom",
    key: "image_format",
    label: "JPEG or PNG images",
    description: "Behance converts CMYK and refuses PDFs; Fanwise renders JPEG or PNG in sRGB.",
    severity: "error",
    evaluate(_draft, subject) {
      const bad = listingImages(subject).find(
        (a) => a.asset_type !== "cover_image" && !a.mime_type?.startsWith("image/"),
      )
      if (!bad) return { satisfied: true }
      return { satisfied: false, message: `${bad.filename} is not an image Behance can show.` }
    },
  },
  {
    kind: "custom",
    key: "cover_resolution",
    label: "Cover at twice the minimum",
    description: "1616 × 1264 or larger renders sharp on a retina grid.",
    severity: "warning",
    evaluate(_draft, subject) {
      const cover = coverImage(subject)
      const dimensions = cover ? readImageDimensions(cover.metadata) : null
      if (
        !dimensions ||
        (dimensions.width >= LIMITS.coverWidth && dimensions.height >= LIMITS.coverHeight)
      ) {
        return { satisfied: true }
      }
      return {
        satisfied: false,
        message: "The cover is under 1616 × 1264 and will be built at Behance's minimum.",
      }
    },
  },
  {
    kind: "text",
    key: "description_min",
    label: "A description a reader can use",
    severity: "warning",
    field: "description",
    minLength: 40,
  },
  {
    kind: "tags",
    key: "tag_count",
    label: "Five to ten tags",
    description: "Behance allows ten. Fewer than five leaves the project hard to find.",
    severity: "warning",
    minCount: 5,
    maxCount: LIMITS.tagsMax,
  },
  {
    kind: "tags",
    key: "tag_max",
    label: "No more than ten tags",
    description: "Behance's hard cap. The handoff copies the first ten.",
    severity: "error",
    maxCount: LIMITS.tagsMax,
  },
  {
    kind: "custom",
    key: "example_images_min",
    label: "Three example images on the asset",
    severity: "warning",
    evaluate(_draft, subject) {
      const examples = listingImages(subject).filter((a) => a.asset_type !== "cover_image").length
      if (examples >= 3) return { satisfied: true }
      return {
        satisfied: false,
        message: `Add ${3 - examples} more preview image${3 - examples === 1 ? "" : "s"} to show beside the download.`,
      }
    },
  },
  {
    kind: "custom",
    key: "net_proceeds",
    label: "What you receive",
    severity: "info",
    evaluate(draft) {
      if (draft.price === null) return { satisfied: true, message: "Set a price to see the fees." }
      return { satisfied: true, message: feeSentence(draft.price, draft.currency) }
    },
  },
  {
    kind: "custom",
    key: "payment_country",
    label: "Where Behance pays out",
    severity: "info",
    evaluate: () => ({
      satisfied: true,
      message:
        "Behance pays out by card processor in 40 countries and through PayPal elsewhere. Your Adobe ID, sign-in and bank must be in the same country.",
    }),
  },
]

export const behanceAdapter: ChannelAdapter = {
  key: "behance",
  name: "Behance",
  integrationType: "assisted",
  fields: ["title", "description", "shortDescription", "price", "category", "tags"],
  capabilities: {
    // Every false here is the permanent kind: the provider cannot. No write
    // API, and the terms forbid the alternative (docs/channels/behance.md §3).
    automaticPublish: false,
    automaticUpdate: false,
    metrics: false,
    transactions: false,
    digitalFileUpload: false,
    imageUpload: false,
    // Save keeps a project as a draft, set by the seller.
    drafts: true,
  },
  requirements,
  // Everything is by hand; a manual step tracks work outstanding after a
  // publication, and nothing here ever publishes.
  manualSteps: [],
  merchandising: behanceMerchandising,
  accountHint: behanceAccountHint,
  choices,
  submission: behanceSubmission,

  buildListing({ product }: AdapterSubject): ChannelListingDraft {
    return {
      // Title, descriptions and price are left empty: an empty field uses the
      // product's value when the listing is read (lib/channels/listings.ts).
      title: null,
      description: null,
      shortDescription: null,
      seoTitle: null,
      seoDescription: null,
      price: null,
      currency: product.currency,
      category: defaultAssetCategory(product.product_type),
      tags: [],
      metadata: {
        [HANDOFF_MODE_KEY]: "new",
        [CREATIVE_FIELDS_KEY]: defaultCreativeFields(product.product_type),
        [LICENSE_TYPE_KEY]: recommendedLicense(product.license_summary),
      },
    }
  },

  /**
   * One cover, cropped; every image once more at canvas size. The example
   * images on the asset are the previews at the same spec, so they are one
   * rendition each with two roles: the derivative is cached on (source, spec)
   * and the second role costs nothing.
   */
  handoffImages(subject: AdapterSubject): HandoffRenditionSpec[] {
    const out: HandoffRenditionSpec[] = []
    const cover = coverImage(subject)
    if (cover && derivable(cover)) {
      out.push({ source: cover, spec: coverSpecFor(cover), role: "cover", position: 0 })
    }
    const images = listingImages(subject).filter(derivable)
    images.forEach((asset, index) => {
      out.push({
        source: asset,
        spec: projectImageSpec(asset.mime_type),
        role: "project",
        position: index,
      })
    })
    images
      .filter((asset) => asset.asset_type !== "cover_image")
      .slice(0, LIMITS.exampleImagesMax)
      .forEach((asset, index) => {
        out.push({
          source: asset,
          spec: projectImageSpec(asset.mime_type),
          role: "example",
          position: index,
        })
      })
    return out
  },

  buildHandoff: buildBehanceHandoff,

  // No publish. No update. No unpublish. No oauth. Deliberately.
}

export { listingImageSlots }
