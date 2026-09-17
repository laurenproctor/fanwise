import { z } from "zod"
import { ChannelError, normalized } from "@/lib/channels/errors"
import { listingImages } from "@/lib/channels/images"
import { readConnectionCredentials } from "@/lib/credentials"
import type {
  AdapterSubject,
  ChannelAdapter,
  ChannelListingDraft,
  PublishContext,
  PublishResult,
  RequirementSpec,
} from "@/lib/channels/types"
import type { ImageSpec } from "@/lib/products/derivatives"
import { channelImage, type ImagePolicy } from "@/lib/channels/image-policy"
import type { ProductAsset } from "@/lib/products/types"
import { CATEGORY_LABELS, categoryPath, defaultCategoryLabel } from "./categories"
import { GumroadRefusal, createGumroadClient, type GumroadClient } from "./client"
import { CREATE_PACE, LIMITS, staleScopes } from "./config"
import { PRODUCT_NOT_FOUND, productMissing } from "./errors"
import { gumroadMerchandising } from "./merchandising"
import { gumroadCredentialsSchema, gumroadOAuth } from "./oauth"
import {
  toCurrency,
  toDescription,
  toPermalink,
  toPrice,
  toTag,
  toTags,
  minimumPrice,
} from "./transform"
import { uploadFile } from "./upload"

/**
 * Gumroad. The second billable automatic channel, and the first whose file
 * goes up in parts.
 *
 * The field-level spec is docs/channels/gumroad.md. Gumroad takes the file
 * through a presigned multipart upload and holds it in the seller's own
 * storage, so there is no manual step: a publish uploads the files, creates
 * the product as a draft, sends the covers and a thumbnail, and enables it,
 * all in one job.
 *
 * Several external calls make one publish, and the runner's idempotency is
 * built around one. So this adapter cleans up after itself: a failure after
 * the draft exists deletes the draft before the error is reported, and the
 * retry starts from nothing. The product's permalink is the product's slug,
 * which Gumroad keeps unique per seller, so a create whose response was lost
 * cannot be repeated by accident: the second create is refused, and the
 * creator is told which product is in the way.
 */

const DELIVERABLE_TYPES = ["deliverable", "archive"] as const

function deliverables(assets: readonly ProductAsset[]): ProductAsset[] {
  return assets
    .filter(
      (a) =>
        a.asset_state === "ready" &&
        (DELIVERABLE_TYPES as readonly string[]).includes(a.asset_type),
    )
    .sort((a, b) => a.sort_order - b.sort_order)
}

/**
 * The one derivative this channel adds: a square thumbnail, cropped from the
 * cover with the attention strategy, under Gumroad's 5 MB. Gumroad wants at
 * least 600 on a side; 1200 is enough for a retina grid without being a
 * second copy of the cover.
 */
/**
 * What Gumroad takes as a cover: JPEG, PNG or GIF, never WebP, up to 50 MB.
 * Covers show in a carousel no wider than a retina 1280, so 2560 on the long
 * edge is the most a buyer will ever see. Nothing is cropped; the square
 * thumbnail below is the one shape this channel needs cut.
 */
export const IMAGE_POLICY: ImagePolicy = {
  key: "fit-2560",
  maxEdge: 2560,
  accepts: ["image/jpeg", "image/png", "image/gif"],
  maxByteSize: LIMITS.coverBytesMax,
}

export const THUMBNAIL_SPEC: ImageSpec = {
  key: "square-1200",
  width: LIMITS.thumbnailEdge,
  height: LIMITS.thumbnailEdge,
  format: "jpeg",
  fit: "cover",
  focus: "attention",
  maxByteSize: LIMITS.thumbnailBytesMax,
}

const requirements: readonly RequirementSpec[] = [
  {
    kind: "text",
    key: "title",
    label: "Title",
    description: "Gumroad's hard limit.",
    severity: "error",
    field: "title",
    minLength: 3,
    maxLength: LIMITS.titleMax,
  },
  {
    kind: "custom",
    key: "currency_supported",
    label: "A currency Gumroad sells in",
    description: "Gumroad prices in nineteen currencies. Anything else is refused.",
    severity: "error",
    evaluate(draft) {
      if (toCurrency(draft.currency)) return { satisfied: true }
      return {
        satisfied: false,
        message: `Gumroad does not sell in ${draft.currency.toUpperCase()}. Price this listing in USD, EUR, GBP or another currency Gumroad supports.`,
      }
    },
  },
  {
    kind: "custom",
    key: "price",
    label: "Price",
    description:
      "Free, or at least Gumroad's minimum for the currency: 0.99 USD, 0.79 EUR, 0.59 GBP.",
    severity: "error",
    evaluate(draft) {
      const price = draft.price ?? 0
      if (price === 0) return { satisfied: true }
      const minimum = minimumPrice(draft.currency)
      // An unsupported currency is the currency rule's complaint, not this one's.
      if (minimum === null) return { satisfied: true }
      if (price >= minimum) return { satisfied: true }
      return {
        satisfied: false,
        message: `Gumroad's minimum price in ${draft.currency.toUpperCase()} is ${minimum}. Set the price to at least that, or to 0 to make it free.`,
      }
    },
  },
  {
    kind: "custom",
    key: "price_unverified_ceiling",
    label: "Price within the unverified-seller ceiling",
    description:
      "Gumroad caps an unverified seller at 5,000 USD a product. Fanwise cannot see whether the account is verified.",
    severity: "warning",
    evaluate(draft) {
      if (toCurrency(draft.currency) !== "usd" || (draft.price ?? 0) <= 5000) {
        return { satisfied: true }
      }
      return {
        satisfied: false,
        message: "Above 5,000 USD, Gumroad refuses the product unless the account is verified.",
      }
    },
  },
  {
    kind: "custom",
    key: "tags",
    label: "Tags Gumroad accepts",
    description: "Each tag is 2 to 20 characters, with no commas and no leading #.",
    severity: "error",
    evaluate(draft) {
      const bad = draft.tags.find(
        (tag) => toTag(tag) !== tag.trim().toLowerCase() || tag.includes(","),
      )
      if (!bad) return { satisfied: true }
      return {
        satisfied: false,
        message: `"${bad}" is not a tag Gumroad accepts. Use 2 to 20 characters, no commas, no leading #.`,
      }
    },
  },
  {
    kind: "custom",
    key: "deliverable",
    label: "A deliverable Gumroad can hold",
    description: "Gumroad takes files up to 20 GB. Fanwise uploads them for you.",
    severity: "error",
    evaluate(_draft, subject) {
      const files = deliverables(subject.assets)
      if (files.length === 0) {
        return { satisfied: false, message: "Upload the file the buyer receives." }
      }
      const unsized = files.find((f) => !f.byte_size || f.byte_size <= 0)
      if (unsized) {
        return {
          satisfied: false,
          message: `${unsized.filename} has not finished uploading. Wait for it, or upload it again.`,
        }
      }
      const tooBig = files.find((f) => (f.byte_size ?? 0) > LIMITS.fileBytesMax)
      if (tooBig) {
        return {
          satisfied: false,
          message: `${tooBig.filename} is over Gumroad's 20 GB limit for a file.`,
        }
      }
      return { satisfied: true }
    },
  },
  {
    kind: "custom",
    key: "permalink_format",
    label: "A slug Gumroad can use as the product's address",
    description: "Letters, numbers, hyphens and underscores, up to 255 characters.",
    severity: "error",
    evaluate(_draft, subject) {
      if (toPermalink(subject.product.slug)) return { satisfied: true }
      return {
        satisfied: false,
        message: "Change the product's slug to letters, numbers, hyphens and underscores only.",
      }
    },
  },
  {
    kind: "text",
    key: "description_length",
    label: "A description a buyer can use",
    severity: "warning",
    field: "description",
    minLength: 40,
  },
  {
    kind: "asset",
    key: "cover_image",
    label: "A cover image",
    description: "Gumroad publishes without one, and the thumbnail is made from it.",
    severity: "warning",
    assetTypes: ["cover_image"],
    minCount: 1,
  },
  {
    kind: "enum",
    key: "category",
    label: "Category",
    description:
      "Gumroad's own taxonomy. Without one the product is filed under Other and left out of Discover.",
    severity: "warning",
    field: "category",
    allowed: CATEGORY_LABELS,
  },
  {
    kind: "custom",
    key: "covers_max",
    label: "Up to 8 cover and preview images",
    description: "Gumroad shows at most eight. The ninth onward is not sent.",
    severity: "info",
    evaluate(_draft, subject) {
      const count = listingImages(subject).length
      if (count <= LIMITS.coverMax) return { satisfied: true }
      return {
        satisfied: false,
        message: `${count - LIMITS.coverMax} of these images will not be sent.`,
      }
    },
  },
]

const fileSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullish(),
  url: z.string().nullish(),
})

const productSchema = z.object({
  product: z.object({
    id: z.string().min(1),
    published: z.boolean(),
    short_url: z.string().nullish(),
    custom_permalink: z.string().nullish(),
    files: z.array(fileSchema).optional(),
    covers: z.array(z.object({ id: z.string().min(1) })).optional(),
  }),
  warning: z.string().optional(),
})
type ProductRead = z.infer<typeof productSchema>["product"]

const coversSchema = z.object({
  covers: z.array(z.object({ id: z.string().min(1) })).default([]),
})

/** What the listing remembers about the files it sent, docs/channels/gumroad.md §12. */
const storedFilesSchema = z.array(
  z.object({ assetId: z.string(), fileId: z.string().nullable(), fileUrl: z.string() }),
)
type StoredFile = z.infer<typeof storedFilesSchema>[number]

function storedFiles(listing: PublishContext["listing"]): StoredFile[] {
  const metadata = (listing.metadata as Record<string, unknown> | null) ?? {}
  const parsed = storedFilesSchema.safeParse(metadata.files)
  return parsed.success ? parsed.data : []
}

async function clientFor(context: PublishContext): Promise<GumroadClient> {
  const missing = staleScopes(context.connection.scopes ?? [])
  if (missing.length > 0) {
    throw new ChannelError(
      normalized(
        "permission_denied",
        "Fanwise needs one more permission on this Gumroad account. Reconnect it and accept the permissions it asks for.",
        { missing },
      ),
    )
  }

  const credentials = await readConnectionCredentials({
    workspaceId: context.connection.workspace_id,
    connectionId: context.connection.id,
    schema: gumroadCredentialsSchema,
  })
  if (!credentials) {
    throw new ChannelError(
      normalized(
        "credentials_invalid",
        "Fanwise no longer holds an authorization for this Gumroad account. Reconnect it.",
      ),
    )
  }
  return createGumroadClient({ accessToken: credentials.accessToken })
}

/** Reads the product, and raises the one signal the runner acts on. */
async function readProduct(client: GumroadClient, id: string): Promise<ProductRead> {
  try {
    const { product } = await client.request({
      method: "GET",
      path: `products/${encodeURIComponent(id)}`,
      schema: productSchema,
      refusals: [PRODUCT_NOT_FOUND],
    })
    return product
  } catch (error) {
    if (error instanceof GumroadRefusal) throw new ChannelError(productMissing(error.raw))
    throw error
  }
}

/** The fields a create and an update share. Refuses before any call is made. */
function productFields(context: PublishContext): Record<string, unknown> {
  const { listing, subject } = context

  const currency = toCurrency(listing.currency)
  if (!currency) {
    throw new ChannelError(
      normalized(
        "validation_rejected",
        `Gumroad does not sell in ${listing.currency.toUpperCase()}. Price this listing in a currency Gumroad supports.`,
      ),
    )
  }
  const path = categoryPath(listing.category)
  if (path === undefined && listing.category) {
    throw new ChannelError(
      normalized(
        "validation_rejected",
        "Choose a Gumroad category for this listing before publishing it.",
      ),
    )
  }
  const price = toPrice(listing.price === null ? null : Number(listing.price), listing.currency)

  return {
    name: (listing.title ?? subject.product.name).slice(0, LIMITS.titleMax),
    description: toDescription(listing.description),
    ...(listing.short_description ? { custom_summary: listing.short_description } : {}),
    price: price ?? 0,
    price_currency_type: currency,
    ...(path ? { category: path } : {}),
    tags: toTags(listing.tags ?? []),
  }
}

async function sendCovers(
  client: GumroadClient,
  productId: string,
  context: PublishContext,
  images: readonly ProductAsset[],
): Promise<string[]> {
  let ids: string[] = []
  for (const asset of images) {
    const answer = await client.request({
      method: "POST",
      path: `products/${encodeURIComponent(productId)}/covers`,
      body: {
        kind: "json",
        value: { url: (await channelImage(context, IMAGE_POLICY, asset)).url },
      },
      schema: coversSchema,
    })
    ids = answer.covers.map((c) => c.id)
  }
  return ids
}

/**
 * The square thumbnail, from the cover. Cosmetic, so it never fails a publish:
 * a cover too small to crop, or a thumbnail Gumroad refuses, is noted on the
 * job row and the product goes live without one.
 */
async function sendThumbnail(
  client: GumroadClient,
  productId: string,
  context: PublishContext,
  cover: ProductAsset | undefined,
): Promise<unknown> {
  if (!cover || !context.derivativeUrl) return "skipped"
  try {
    const url = await context.derivativeUrl(cover, THUMBNAIL_SPEC)
    await client.request({
      method: "POST",
      path: `products/${encodeURIComponent(productId)}/thumbnail`,
      body: { kind: "json", value: { url } },
      schema: z.unknown(),
    })
    return "sent"
  } catch (error) {
    return {
      skipped:
        error instanceof ChannelError
          ? error.normalized.code
          : error instanceof Error
            ? error.message
            : "unknown",
    }
  }
}

async function uploadDeliverables(
  client: GumroadClient,
  context: PublishContext,
  files: readonly ProductAsset[],
): Promise<{ assetId: string; fileUrl: string }[]> {
  const out: { assetId: string; fileUrl: string }[] = []
  for (const asset of files) {
    const uploaded = await uploadFile(client, {
      filename: asset.filename,
      byteSize: asset.byte_size ?? 0,
      open: async () => fetch(await context.assetUrl(asset)),
    })
    out.push({ assetId: asset.id, fileUrl: uploaded.fileUrl })
  }
  return out
}

/** Pairs what Gumroad now holds with what was sent, by position. */
function fileRecords(
  sent: readonly { assetId: string; fileUrl: string }[],
  held: readonly { id: string }[] | undefined,
): StoredFile[] {
  return sent.map((file, index) => ({
    assetId: file.assetId,
    fileId: held && held.length === sent.length ? (held[index]?.id ?? null) : null,
    fileUrl: file.fileUrl,
  }))
}

function result(
  product: ProductRead,
  files: readonly StoredFile[],
  coverIds: readonly string[],
  provider: unknown,
): PublishResult {
  const heldFiles = product.files?.length ?? files.length
  return {
    externalListingId: product.id,
    externalUrl: product.short_url ?? null,
    publicUrl: product.short_url ?? null,
    externalState: product.published ? "live" : "draft",
    purchasable: product.published && heldFiles > 0,
    listingMetadata: {
      permalink: product.custom_permalink ?? null,
      coverIds: [...coverIds],
      files: [...files],
    },
    providerResponse: provider,
  }
}

export const gumroadAdapter: ChannelAdapter = {
  key: "gumroad",
  name: "Gumroad",
  integrationType: "api",
  fields: ["title", "description", "shortDescription", "price", "category", "tags"],
  capabilities: {
    automaticPublish: true,
    automaticUpdate: true,
    // Exist on the provider; B5 and B6 build the steps that use them.
    metrics: false,
    transactions: false,
    // True. Gumroad takes the file, in parts, into the seller's own storage.
    digitalFileUpload: true,
    imageUpload: true,
    // A publish goes live in one job, as on Etsy. Nothing is held as a draft.
    drafts: false,
  },
  requirements,
  manualSteps: [],
  merchandising: gumroadMerchandising,
  oauth: gumroadOAuth,
  pace: CREATE_PACE,

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
      category: defaultCategoryLabel(product.product_type),
      tags: [],
      metadata: {},
    }
  },

  /**
   * Files, draft, covers, thumbnail, enable. Or nothing.
   *
   * The files go first because the create takes their addresses. The draft is
   * created with `draft=true` on purpose: a create without it publishes at
   * once, before the covers arrive, and a publish Gumroad blocks inside a
   * create comes back as success with a warning. Everything after the draft is
   * inside one try, and a failure there deletes the draft before rethrowing.
   */
  async publish(context: PublishContext): Promise<PublishResult> {
    const fields = productFields(context)
    const permalink = toPermalink(context.subject.product.slug)
    if (!permalink) {
      throw new ChannelError(
        normalized(
          "validation_rejected",
          "Change the product's slug to letters, numbers, hyphens and underscores before publishing to Gumroad.",
        ),
      )
    }

    const client = await clientFor(context)
    const images = listingImages(context.subject).slice(0, LIMITS.coverMax)
    const files = deliverables(context.subject.assets)

    const uploaded = await uploadDeliverables(client, context, files)

    const created = await client.request({
      method: "POST",
      path: "products",
      body: {
        kind: "json",
        value: {
          ...fields,
          native_type: "digital",
          draft: true,
          custom_permalink: permalink,
          files: uploaded.map((f) => ({ url: f.fileUrl })),
        },
      },
      schema: productSchema,
    })
    const productId = created.product.id

    try {
      const coverIds = await sendCovers(client, productId, context, images)
      const thumbnail = await sendThumbnail(client, productId, context, images[0])
      await client.request({
        method: "PUT",
        path: `products/${encodeURIComponent(productId)}/enable`,
        schema: z.unknown(),
      })
      // Read back rather than trust the enable: `published` and the files it
      // holds are what "live" and "purchasable" mean here.
      const live = await readProduct(client, productId)
      const records = fileRecords(uploaded, live.files)
      return result(live, records, coverIds, {
        created: created.product,
        warning: created.warning ?? null,
        uploaded: uploaded.map((f) => f.fileUrl),
        coverIds,
        thumbnail,
        live,
      })
    } catch (error) {
      let cleanup: unknown = "deleted"
      try {
        await client.request({
          method: "DELETE",
          path: `products/${encodeURIComponent(productId)}`,
          schema: z.unknown(),
        })
      } catch (deleteError) {
        cleanup = {
          orphanedDraft: productId,
          error: deleteError instanceof ChannelError ? deleteError.normalized.code : "unknown",
        }
      }
      if (error instanceof ChannelError) {
        throw new ChannelError({
          ...error.normalized,
          raw: { cause: error.normalized.raw, cleanup },
        })
      }
      throw error
    }
  },

  /**
   * Updates the fields, keeps the state, and repairs what is missing.
   *
   * Reads first, because a product deleted on Gumroad is the one signal the
   * runner acts on. Covers are added for images the product is short of.
   * Files are the careful part: `files` on an update replaces the whole list,
   * so new files are sent only alongside every file this listing already
   * knows, and if what Gumroad holds no longer matches what was sent, the
   * update refuses rather than guess, because a wrong guess deletes the
   * buyer's download. The permalink is never changed: it is the buyer's link.
   */
  async update(context: PublishContext): Promise<PublishResult> {
    const externalId = context.listing.external_listing_id
    if (!externalId) {
      throw new ChannelError(
        normalized("unknown", "This listing has not been published to Gumroad yet."),
      )
    }
    const fields = productFields(context)
    const client = await clientFor(context)
    const before = await readProduct(client, externalId)
    const path = `products/${encodeURIComponent(before.id)}`

    const updated = await client.request({
      method: "PUT",
      path,
      body: { kind: "json", value: fields },
      schema: productSchema,
    })

    const images = listingImages(context.subject).slice(0, LIMITS.coverMax)
    const held = before.covers?.length ?? 0
    let coverIds = before.covers?.map((c) => c.id) ?? []
    if (images.length > held) {
      coverIds = await sendCovers(client, before.id, context, images.slice(held))
    }

    const known = storedFiles(context.listing)
    const wanted = deliverables(context.subject.assets)
    const missing = wanted.filter((asset) => !known.some((f) => f.assetId === asset.id))
    let files: StoredFile[] = known
    let uploadedUrls: string[] = []

    if (missing.length > 0) {
      const heldIds = new Set((before.files ?? []).map((f) => f.id))
      const knownIds = known.map((f) => f.fileId)
      const agree =
        before.files !== undefined &&
        knownIds.every((id) => id !== null && heldIds.has(id)) &&
        heldIds.size === knownIds.length
      if (!agree) {
        throw new ChannelError(
          normalized(
            "validation_rejected",
            "The files on this Gumroad product no longer match what Fanwise sent, so Fanwise will not replace them. Attach the new file on Gumroad, or remove the product there and publish it again.",
            { known: knownIds, held: [...heldIds] },
          ),
        )
      }
      const uploaded = await uploadDeliverables(client, context, missing)
      uploadedUrls = uploaded.map((f) => f.fileUrl)
      const after = await client.request({
        method: "PUT",
        path,
        body: {
          kind: "json",
          value: {
            files: [
              ...known.map((f) => ({ id: f.fileId, url: f.fileUrl })),
              ...uploaded.map((f) => ({ url: f.fileUrl })),
            ],
          },
        },
        schema: productSchema,
      })
      const sent = [...known.map((f) => ({ assetId: f.assetId, fileUrl: f.fileUrl })), ...uploaded]
      files = fileRecords(sent, after.product.files)
    }

    return result(
      {
        ...updated.product,
        published: before.published,
        files: before.files ?? updated.product.files,
      },
      files,
      coverIds,
      { before, updated: updated.product, coverIds, uploaded: uploadedUrls },
    )
  },
}
