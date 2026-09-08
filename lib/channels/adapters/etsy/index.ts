import { z } from "zod"
import { ChannelError, normalized } from "@/lib/channels/errors"
import { listingImages } from "@/lib/channels/images"
import { readConnectionCredentials, storeConnectionCredentials } from "@/lib/credentials"
import type {
  AdapterSubject,
  ChannelAdapter,
  ChannelListingDraft,
  PublishContext,
  PublishResult,
  RequirementSpec,
} from "@/lib/channels/types"
import type { ProductAsset } from "@/lib/products/types"
import { CATEGORY_LABELS, defaultCategoryLabel, taxonomyId } from "./categories"
import { createEtsyClient, type EtsyClient } from "./client"
import { LIMITS, apiKeyHeader, staleScopes } from "./config"
import { listingMissing } from "./errors"
import { etsyMerchandising } from "./merchandising"
import { etsyCredentialsSchema, etsyOAuth, refreshAccessToken } from "./oauth"
import { editUrl, listingUrl, toDescription, toPrice, toTags } from "./transform"

/**
 * Etsy. The first billable automatic channel, and the first that takes the
 * file.
 *
 * The field-level spec is docs/channels/etsy.md. Etsy has native digital
 * listings and an upload endpoint for the buyer's file, so there is no
 * manual step: a publish creates the draft, sends the images and the file,
 * and puts it on sale, all in one job. The listing fee is Etsy's and is
 * charged at that last step, which is why the whole sequence is one click and
 * not a draft the creator forgets.
 *
 * Four external calls make one publish, and the runner's idempotency is
 * built around one. So this adapter cleans up after itself: a failure after
 * the draft exists deletes the draft before the error is reported, and the
 * retry starts from nothing. A draft costs nothing to delete; an orphaned
 * one would cost a duplicate on the next click.
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
    .slice(0, LIMITS.fileMax)
}

const requirements: readonly RequirementSpec[] = [
  {
    kind: "text",
    key: "title",
    label: "Title",
    description: "Etsy's hard limit.",
    severity: "error",
    field: "title",
    minLength: 3,
    maxLength: LIMITS.titleMax,
  },
  {
    kind: "text",
    key: "description",
    label: "Description",
    description: "Etsy requires one, and strips formatting from it.",
    severity: "error",
    field: "description",
    minLength: 1,
    maxLength: 65535,
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
    kind: "number",
    key: "price",
    label: "Price",
    description: "Etsy's minimum is 0.20 in the shop's currency.",
    severity: "error",
    field: "price",
    min: 0.2,
  },
  {
    kind: "enum",
    key: "category",
    label: "Category",
    description: "Etsy's own taxonomy. Every listing needs one.",
    severity: "error",
    field: "category",
    allowed: CATEGORY_LABELS,
  },
  {
    kind: "tags",
    key: "tags",
    label: "Tags",
    description: "Up to 13 tags of 20 characters. Etsy rejects a listing above either limit.",
    severity: "error",
    maxCount: LIMITS.tagMax,
    maxTagLength: LIMITS.tagLength,
  },
  {
    kind: "asset",
    key: "cover_image",
    label: "A cover image",
    description: "Etsy will not put a listing on sale without an image.",
    severity: "error",
    assetTypes: ["cover_image"],
    minCount: 1,
  },
  {
    kind: "custom",
    key: "deliverable",
    label: "A deliverable Etsy can hold",
    description: "Etsy takes up to 5 files of 20 MB each. Fanwise uploads them for you.",
    severity: "error",
    evaluate(_draft, subject) {
      const files = deliverables(subject.assets)
      if (files.length === 0) {
        return { satisfied: false, message: "Upload the file the buyer receives." }
      }
      const tooBig = files.find((f) => (f.byte_size ?? 0) > LIMITS.fileBytesMax)
      if (tooBig) {
        return {
          satisfied: false,
          message: `${tooBig.filename} is over Etsy's 20 MB limit for a download. Split it or compress it.`,
        }
      }
      return { satisfied: true }
    },
  },
  {
    kind: "custom",
    key: "currency_matches_shop",
    label: "Price is in the shop's currency",
    description: "Etsy prices in the shop's own currency. There is no per-listing override.",
    severity: "warning",
    evaluate(draft, subject) {
      const shopCurrency = subject.connectionMetadata?.["currencyCode"]
      if (typeof shopCurrency !== "string" || shopCurrency.length === 0) {
        return {
          satisfied: false,
          message: "Connect the shop and Fanwise will check this against its currency.",
        }
      }
      if (shopCurrency.toUpperCase() === draft.currency.toUpperCase()) return { satisfied: true }
      return {
        satisfied: false,
        message: `This listing is priced in ${draft.currency}, and the shop sells in ${shopCurrency.toUpperCase()}. Etsy will charge ${draft.price ?? 0} ${shopCurrency.toUpperCase()}, not a converted amount.`,
      }
    },
  },
]

const listingSchema = z.object({
  listing_id: z.number(),
  state: z.string(),
  url: z.string().nullish(),
  images: z.array(z.object({ listing_image_id: z.number() })).nullish(),
})
type Listing = z.infer<typeof listingSchema>

const filesSchema = z.object({
  count: z.number().optional(),
  results: z
    .array(z.object({ listing_file_id: z.number(), filename: z.string().nullish() }))
    .default([]),
})

const uploadImageSchema = z.object({ listing_image_id: z.number() })
const uploadFileSchema = z.object({ listing_file_id: z.number() })

/** Refreshes near expiry, and if it does, keeps what Etsy handed back. */
async function clientFor(context: PublishContext): Promise<{ client: EtsyClient; shopId: number }> {
  const missing = staleScopes(context.connection.scopes ?? [])
  if (missing.length > 0) {
    throw new ChannelError(
      normalized(
        "permission_denied",
        "Fanwise needs one more permission on this Etsy shop. Reconnect the shop and accept the permissions it asks for.",
        { missing },
      ),
    )
  }

  const credentials = await readConnectionCredentials({
    workspaceId: context.connection.workspace_id,
    connectionId: context.connection.id,
    schema: etsyCredentialsSchema,
  })
  if (!credentials) {
    throw new ChannelError(
      normalized(
        "credentials_invalid",
        "Fanwise no longer holds an authorization for this Etsy shop. Reconnect it.",
      ),
    )
  }

  let { accessToken } = credentials
  // Two minutes of margin: a job that starts with a minute left on the token
  // would otherwise fail on its third call.
  if (new Date(credentials.expiresAt).getTime() - Date.now() < 120_000) {
    const fresh = await refreshAccessToken(credentials.refreshToken)
    await storeConnectionCredentials({
      workspaceId: context.connection.workspace_id,
      connectionId: context.connection.id,
      credentials: { ...credentials, ...fresh },
    })
    accessToken = fresh.accessToken
  }

  return {
    client: createEtsyClient({ apiKey: apiKeyHeader(), accessToken }),
    shopId: credentials.shopId,
  }
}

/** Reads the listing, and raises the one signal the runner acts on. */
async function readListing(client: EtsyClient, id: string): Promise<Listing> {
  try {
    return await client.request({
      method: "GET",
      path: `application/listings/${id}?includes=Images`,
      schema: listingSchema,
    })
  } catch (error) {
    if (error instanceof ChannelError && error.normalized.code === "not_found") {
      throw new ChannelError(listingMissing(error.normalized.raw))
    }
    throw error
  }
}

async function bytesOf(url: string): Promise<Blob> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new ChannelError(
      normalized(
        "unknown",
        "Fanwise could not read one of the product's files to send it to Etsy. Try again.",
        {
          status: response.status,
        },
      ),
    )
  }
  return response.blob()
}

async function uploadImages(
  client: EtsyClient,
  shopId: number,
  listingId: number,
  context: PublishContext,
  images: readonly ProductAsset[],
  startRank: number,
): Promise<number[]> {
  const ids: number[] = []
  let rank = startRank
  for (const asset of images) {
    const form = new FormData()
    form.set("image", await bytesOf(await context.assetUrl(asset)), asset.filename)
    form.set("rank", String(rank))
    form.set("alt_text", (context.listing.title ?? context.subject.product.name).slice(0, 250))
    const uploaded = await client.request({
      method: "POST",
      path: `application/shops/${shopId}/listings/${listingId}/images`,
      body: { kind: "multipart", value: form },
      schema: uploadImageSchema,
    })
    ids.push(uploaded.listing_image_id)
    rank += 1
  }
  return ids
}

async function uploadFiles(
  client: EtsyClient,
  shopId: number,
  listingId: number,
  context: PublishContext,
  files: readonly ProductAsset[],
  startRank: number,
): Promise<number[]> {
  const ids: number[] = []
  let rank = startRank
  for (const asset of files) {
    const form = new FormData()
    form.set("file", await bytesOf(await context.assetUrl(asset)), asset.filename)
    form.set("name", asset.filename)
    form.set("rank", String(rank))
    const uploaded = await client.request({
      method: "POST",
      path: `application/shops/${shopId}/listings/${listingId}/files`,
      body: { kind: "multipart", value: form },
      schema: uploadFileSchema,
    })
    ids.push(uploaded.listing_file_id)
    rank += 1
  }
  return ids
}

/** The fields a draft and an update share. */
function listingFields(context: PublishContext): Record<string, unknown> {
  const { listing, subject } = context
  const category = taxonomyId(listing.category)
  if (category === null) {
    throw new ChannelError(
      normalized(
        "validation_rejected",
        "Choose an Etsy category for this listing before publishing it.",
      ),
    )
  }
  const price = toPrice(listing.price === null ? null : Number(listing.price))
  return {
    title: (listing.title ?? subject.product.name).slice(0, LIMITS.titleMax),
    description: toDescription(listing.description),
    ...(price === null ? {} : { price }),
    taxonomy_id: category,
    tags: toTags(listing.tags ?? []).slice(0, LIMITS.tagMax),
  }
}

async function activate(client: EtsyClient, shopId: number, listingId: number): Promise<Listing> {
  return client.request({
    method: "PATCH",
    path: `application/shops/${shopId}/listings/${listingId}`,
    body: { kind: "json", value: { state: "active" } },
    schema: listingSchema,
  })
}

function result(listing: Listing, provider: unknown): PublishResult {
  return {
    externalListingId: String(listing.listing_id),
    // The public listing URL once it is active; the seller's edit page before.
    externalUrl:
      listing.state === "active"
        ? (listing.url ?? listingUrl(listing.listing_id))
        : editUrl(listing.listing_id),
    externalState: listing.state === "active" ? "live" : "draft",
    purchasable: listing.state === "active",
    providerResponse: provider,
  }
}

export const etsyAdapter: ChannelAdapter = {
  key: "etsy",
  name: "Etsy",
  integrationType: "api",
  capabilities: {
    automaticPublish: true,
    automaticUpdate: true,
    // Exist on the provider; B5 and B6 build the steps that use them.
    metrics: false,
    transactions: false,
    // True, and the first channel where it is. Etsy takes the file.
    digitalFileUpload: true,
    imageUpload: true,
    // A publish goes to active in one job. Nothing here is held as a draft.
    drafts: false,
  },
  requirements,
  manualSteps: [],
  merchandising: etsyMerchandising,
  oauth: etsyOAuth,

  buildListing({ product }: AdapterSubject): ChannelListingDraft {
    return {
      title: product.canonical_title ?? product.name,
      description: product.canonical_description,
      shortDescription: null,
      seoTitle: null,
      seoDescription: null,
      price: product.base_price === null ? null : Number(product.base_price),
      currency: product.currency,
      category: defaultCategoryLabel(product.product_type),
      tags: [],
      metadata: {},
    }
  },

  /**
   * Draft, images, file, active. Or nothing.
   *
   * The draft is created first because the uploads need its id. Everything
   * after it is inside one try, and a failure there deletes the draft before
   * rethrowing, so the runner records a failure against a listing with no
   * external id and the next click starts clean. The delete is best effort:
   * if it fails too, the original error is the one reported, and the orphan
   * is noted on the job row for a person to remove.
   */
  async publish(context: PublishContext): Promise<PublishResult> {
    const { client, shopId } = await clientFor(context)
    const images = listingImages(context.subject)
    const files = deliverables(context.subject.assets)

    const draft = await client.request({
      method: "POST",
      path: `application/shops/${shopId}/listings`,
      body: {
        kind: "json",
        value: {
          ...listingFields(context),
          quantity: 999,
          who_made: "i_did",
          when_made: "made_to_order",
          type: "download",
          is_supply: false,
          should_auto_renew: true,
        },
      },
      schema: listingSchema,
    })

    try {
      const imageIds = await uploadImages(client, shopId, draft.listing_id, context, images, 1)
      const fileIds = await uploadFiles(client, shopId, draft.listing_id, context, files, 1)
      const live = await activate(client, shopId, draft.listing_id)
      return result(live, { draft, imageIds, fileIds, activated: live })
    } catch (error) {
      let cleanup: unknown = "deleted"
      try {
        await client.request({
          method: "DELETE",
          path: `application/shops/${shopId}/listings/${draft.listing_id}`,
          schema: z.unknown(),
        })
      } catch (deleteError) {
        cleanup = {
          orphanedDraft: draft.listing_id,
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
   * Etsy holds images and files as separate objects, so an update reads what
   * the listing has and sends only what it is short of, which keeps a
   * creator's own arrangement in the Etsy editor intact.
   */
  async update(context: PublishContext): Promise<PublishResult> {
    const externalId = context.listing.external_listing_id
    if (!externalId) {
      throw new ChannelError(
        normalized("unknown", "This listing has not been published to Etsy yet."),
      )
    }
    const { client, shopId } = await clientFor(context)
    const before = await readListing(client, externalId)
    const listingId = before.listing_id

    const updated = await client.request({
      method: "PATCH",
      path: `application/shops/${shopId}/listings/${listingId}`,
      body: { kind: "json", value: listingFields(context) },
      schema: listingSchema,
    })

    const images = listingImages(context.subject)
    const held = before.images?.length ?? 0
    let imageIds: number[] = []
    if (images.length > held) {
      imageIds = await uploadImages(
        client,
        shopId,
        listingId,
        context,
        images.slice(held),
        held + 1,
      )
    }

    const files = deliverables(context.subject.assets)
    const heldFiles = await client.request({
      method: "GET",
      path: `application/shops/${shopId}/listings/${listingId}/files`,
      schema: filesSchema,
    })
    let fileIds: number[] = []
    if (files.length > heldFiles.results.length) {
      fileIds = await uploadFiles(
        client,
        shopId,
        listingId,
        context,
        files.slice(heldFiles.results.length),
        heldFiles.results.length + 1,
      )
    }

    return result({ ...updated, state: before.state }, { before, updated, imageIds, fileIds })
  },
}
