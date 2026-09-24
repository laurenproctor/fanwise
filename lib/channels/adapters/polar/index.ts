import { z } from "zod"
import { ChannelError, normalized } from "@/lib/channels/errors"
import { channelImage, type ImagePolicy } from "@/lib/channels/image-policy"
import { listingImages } from "@/lib/channels/images"
import type {
  AdapterSubject,
  ChannelAdapter,
  ChannelListingDraft,
  PublishContext,
  PublishResult,
  RequirementSpec,
} from "@/lib/channels/types"
import { readConnectionCredentials, storeConnectionCredentials } from "@/lib/credentials"
import type { ProductAsset } from "@/lib/products/types"
import { PolarNotFound, createPolarClient, type PolarClient } from "./client"
import { LIMITS, STAMP_KEY, staleScopes } from "./config"
import { productMissing } from "./errors"
import { polarMerchandising } from "./merchandising"
import { polarCredentialsSchema, polarOAuth, refreshAccessToken } from "./oauth"
import {
  imageMimeType,
  minimumPrice,
  toBenefitDescription,
  toCurrency,
  toDescription,
  toName,
  toPrice,
} from "./transform"
import { uploadFile } from "./upload"

/**
 * Polar. The third billable automatic channel, and the first that delivers
 * the file to the buyer itself.
 *
 * The field-level spec is docs/channels/polar.md. A Polar product is a
 * checkout, not a marketplace listing: there is no discovery, no category and
 * no tags, and a buyer arrives through a checkout link Fanwise creates. The
 * file is a "downloadables" benefit attached to the product, uploaded in
 * parts to Polar's storage, and Polar hands every buyer a signed download.
 *
 * A publish is six writes and the runner's idempotency is built around one.
 * Polar has no delete and no idempotency key, so this adapter does not clean
 * up after itself; it makes itself resumable instead. Every product it
 * creates carries the listing id in Polar's own metadata, and a publish
 * searches for that stamp before it creates (ADR 0005). A publish that failed
 * halfway is found by the next attempt and finished, so a create whose
 * response was lost is never repeated and nothing is left behind. The same
 * reconciliation serves an update: read what Polar holds, send what it is
 * short of.
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
 * What Polar takes as product media: JPEG, PNG, GIF, WebP or SVG, up to
 * 10 MB. The checkout page shows images no wider than a retina 1280, so 2560
 * on the long edge is the most a buyer will ever see. Nothing is cropped.
 */
export const IMAGE_POLICY: ImagePolicy = {
  key: "fit-2560",
  maxEdge: 2560,
  accepts: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  maxByteSize: LIMITS.mediaBytesMax,
}

const requirements: readonly RequirementSpec[] = [
  {
    kind: "text",
    key: "title",
    label: "Title",
    description: "Polar's product name is 3 to 64 characters.",
    severity: "error",
    field: "title",
    minLength: LIMITS.titleMin,
    maxLength: LIMITS.titleMax,
  },
  {
    kind: "custom",
    key: "currency_supported",
    label: "A currency Polar sells in",
    description: "Polar prices in 130 currencies. Anything else is refused.",
    severity: "error",
    evaluate(draft) {
      if (toCurrency(draft.currency)) return { satisfied: true }
      return {
        satisfied: false,
        message: `Polar does not sell in ${draft.currency.toUpperCase()}. Price this listing in USD, EUR, GBP or another currency Polar supports.`,
      }
    },
  },
  {
    kind: "custom",
    key: "price",
    label: "Price",
    description:
      "Free, or at least Polar's minimum for the currency: 0.50 USD, 0.50 EUR, 0.40 GBP.",
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
        message: `Polar's minimum price in ${draft.currency.toUpperCase()} is ${minimum}. Set the price to at least that, or to 0 to make it free.`,
      }
    },
  },
  {
    kind: "custom",
    key: "deliverable",
    label: "A deliverable Polar can hold",
    description:
      "Polar takes files up to 10 GB and delivers them to the buyer. Fanwise uploads them for you.",
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
          message: `${tooBig.filename} is over Polar's 10 GB limit for a file.`,
        }
      }
      return { satisfied: true }
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
    description: "Polar's checkout page shows the product's images beside the price.",
    severity: "warning",
    assetTypes: ["cover_image"],
    minCount: 1,
  },
]

const priceSchema = z.object({
  id: z.string().min(1),
  amount_type: z.string(),
  price_currency: z.string().nullish(),
  price_amount: z.number().int().nullish(),
  is_archived: z.boolean().optional(),
})

const benefitSchema = z.object({ id: z.string().min(1), type: z.string() })

const mediaSchema = z.object({ id: z.string().min(1), public_url: z.string().nullish() })

const productSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  visibility: z.enum(["draft", "private", "public"]),
  is_archived: z.boolean(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  prices: z.array(priceSchema).default([]),
  benefits: z.array(benefitSchema).default([]),
  medias: z.array(mediaSchema).default([]),
})
type ProductRead = z.infer<typeof productSchema>

const productListSchema = z.object({ items: z.array(productSchema) })

const checkoutLinkSchema = z.object({ id: z.string().min(1), url: z.string().min(1) })

const checkoutLinkListSchema = z.object({ items: z.array(checkoutLinkSchema) })

const benefitCreatedSchema = z.object({ id: z.string().min(1) })

/** What the listing remembers about what it sent, docs/channels/polar.md §12. */
const sentSchema = z.array(z.object({ assetId: z.string(), fileId: z.string() }))
type Sent = z.infer<typeof sentSchema>[number]

const storedStateSchema = z.object({
  files: sentSchema.default([]),
  medias: sentSchema.default([]),
  benefitId: z.string().nullable().default(null),
  checkoutLinkId: z.string().nullable().default(null),
  checkoutUrl: z.string().nullable().default(null),
})
type StoredState = z.infer<typeof storedStateSchema>

const EMPTY_STATE: StoredState = {
  files: [],
  medias: [],
  benefitId: null,
  checkoutLinkId: null,
  checkoutUrl: null,
}

function storedState(listing: PublishContext["listing"]): StoredState {
  const parsed = storedStateSchema.safeParse(listing.metadata ?? {})
  return parsed.success ? parsed.data : EMPTY_STATE
}

async function clientFor(
  context: PublishContext,
): Promise<{ client: PolarClient; organizationId: string }> {
  const missing = staleScopes(context.connection.scopes ?? [])
  if (missing.length > 0) {
    throw new ChannelError(
      normalized(
        "permission_denied",
        "Fanwise needs one more permission on this Polar organization. Reconnect it and accept the permissions it asks for.",
        { missing },
      ),
    )
  }

  const credentials = await readConnectionCredentials({
    workspaceId: context.connection.workspace_id,
    connectionId: context.connection.id,
    schema: polarCredentialsSchema,
  })
  if (!credentials) {
    throw new ChannelError(
      normalized(
        "credentials_invalid",
        "Fanwise no longer holds an authorization for this Polar organization. Reconnect it.",
      ),
    )
  }

  let { accessToken } = credentials
  // Ten minutes of margin: a publish uploads in parts and a job that starts
  // with a minute left on the token would otherwise fail on its last call.
  if (new Date(credentials.expiresAt).getTime() - Date.now() < 600_000) {
    if (!credentials.refreshToken) {
      throw new ChannelError(
        normalized(
          "credentials_invalid",
          "Fanwise's authorization for this Polar organization has expired. Reconnect it.",
        ),
      )
    }
    const fresh = await refreshAccessToken(credentials.refreshToken)
    await storeConnectionCredentials({
      workspaceId: context.connection.workspace_id,
      connectionId: context.connection.id,
      credentials: { ...credentials, ...fresh },
    })
    accessToken = fresh.accessToken
  }

  const organizationId = context.connection.external_account_id
  if (!organizationId) {
    throw new ChannelError(
      normalized(
        "credentials_invalid",
        "This Polar connection does not name an organization. Reconnect it.",
      ),
    )
  }
  return { client: createPolarClient({ accessToken }), organizationId }
}

/** Reads the product, and raises the one signal the runner acts on. */
async function readProduct(client: PolarClient, id: string): Promise<ProductRead> {
  try {
    return await client.request({
      method: "GET",
      path: `products/${encodeURIComponent(id)}`,
      schema: productSchema,
      notFound: true,
    })
  } catch (error) {
    if (error instanceof PolarNotFound) throw new ChannelError(productMissing(error.raw))
    throw error
  }
}

/**
 * The product a lost create left behind, if any. The stamp is Polar's own
 * metadata filter, so the search is one read; an archived product is not a
 * match, because archiving is how a seller retires one on purpose.
 */
async function findStamped(
  client: PolarClient,
  organizationId: string,
  listingId: string,
): Promise<ProductRead | null> {
  const query = new URLSearchParams({
    organization_id: organizationId,
    is_archived: "false",
    limit: "10",
  })
  query.set(`metadata[${STAMP_KEY}]`, listingId)
  const { items } = await client.request({
    method: "GET",
    path: `products?${query.toString()}`,
    schema: productListSchema,
  })
  return items.find((p) => p.metadata[STAMP_KEY] === listingId && !p.is_archived) ?? null
}

/** The fields a create and an update share. Refuses before any call is made. */
function productFields(context: PublishContext): {
  name: string
  description: string | null
  currency: string
  amount: number
} {
  const { listing, subject } = context
  const currency = toCurrency(listing.currency)
  if (!currency) {
    throw new ChannelError(
      normalized(
        "validation_rejected",
        `Polar does not sell in ${listing.currency.toUpperCase()}. Price this listing in a currency Polar supports.`,
      ),
    )
  }
  const amount = toPrice(listing.price === null ? null : Number(listing.price), listing.currency)
  return {
    name: toName(listing.title ?? subject.product.name),
    description: toDescription(listing.description),
    currency,
    amount: amount ?? 0,
  }
}

/**
 * The price list an update sends. Polar archives any price left out, so the
 * fixed price it holds is kept by id when it already says what the listing
 * says, and replaced by a new one otherwise; a seller's other prices are
 * left alone. A fresh product gets one fixed price, and zero means free.
 */
function pricesFor(
  fields: ReturnType<typeof productFields>,
  held: readonly z.infer<typeof priceSchema>[],
): unknown[] {
  const fixed = held.filter((p) => p.amount_type === "fixed" && !p.is_archived)
  const same = fixed.find(
    (p) => p.price_currency?.toLowerCase() === fields.currency && p.price_amount === fields.amount,
  )
  const others = held.filter((p) => p.amount_type !== "fixed" && !p.is_archived)
  const keep = same ? [same, ...others] : others
  return [
    ...keep.map((p) => ({ id: p.id })),
    ...(same
      ? []
      : [{ amount_type: "fixed", price_currency: fields.currency, price_amount: fields.amount }]),
  ]
}

async function uploadDeliverables(
  client: PolarClient,
  organizationId: string,
  context: PublishContext,
  files: readonly ProductAsset[],
): Promise<Sent[]> {
  const out: Sent[] = []
  for (const asset of files) {
    const uploaded = await uploadFile(client, organizationId, "downloadable", {
      filename: asset.filename,
      mimeType: asset.mime_type ?? "application/octet-stream",
      byteSize: asset.byte_size ?? 0,
      open: async () => fetch(await context.assetUrl(asset)),
    })
    out.push({ assetId: asset.id, fileId: uploaded.fileId })
  }
  return out
}

/**
 * Images go up whole. A rendition's size is only known once it exists, and
 * Polar presigns against the size, so the bytes are read first; ten
 * megabytes is the ceiling and the policy keeps a rendition under it.
 */
async function uploadImages(
  client: PolarClient,
  organizationId: string,
  context: PublishContext,
  images: readonly ProductAsset[],
): Promise<Sent[]> {
  const out: Sent[] = []
  for (const asset of images) {
    const image = await channelImage(context, IMAGE_POLICY, asset)
    const mimeType = imageMimeType(image.filename)
    if (!mimeType) continue
    const response = await fetch(image.url)
    if (!response.ok) {
      throw new ChannelError(
        normalized(
          "unknown",
          "Fanwise could not read one of the product's images to send it to Polar. Try again.",
          { status: response.status, filename: image.filename },
        ),
      )
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    const uploaded = await uploadFile(client, organizationId, "product_media", {
      filename: image.filename,
      mimeType,
      byteSize: bytes.byteLength,
      open: async () => new Response(bytes),
    })
    out.push({ assetId: asset.id, fileId: uploaded.fileId })
  }
  return out
}

/** Sends the files, the images, the benefit and the product, in that order, and reads back. */
async function reconcile(
  client: PolarClient,
  organizationId: string,
  context: PublishContext,
  existing: ProductRead | null,
  known: StoredState,
): Promise<{ product: ProductRead; state: StoredState; provider: Record<string, unknown> }> {
  const fields = productFields(context)
  const provider: Record<string, unknown> = {}

  // Files: what the listing does not know it has sent, sent now.
  const wantedFiles = deliverables(context.subject.assets)
  const newFiles = await uploadDeliverables(
    client,
    organizationId,
    context,
    wantedFiles.filter((asset) => !known.files.some((f) => f.assetId === asset.id)),
  )
  const files = wantedFiles.flatMap((asset) => {
    const sent =
      known.files.find((f) => f.assetId === asset.id) ??
      newFiles.find((f) => f.assetId === asset.id)
    return sent ? [sent] : []
  })
  provider.uploadedFiles = newFiles.map((f) => f.fileId)

  // Images, in channel order.
  const wantedImages = listingImages(context.subject)
  const newMedias = await uploadImages(
    client,
    organizationId,
    context,
    wantedImages.filter((asset) => !known.medias.some((m) => m.assetId === asset.id)),
  )
  const medias = wantedImages.flatMap((asset) => {
    const sent =
      known.medias.find((m) => m.assetId === asset.id) ??
      newMedias.find((m) => m.assetId === asset.id)
    return sent ? [sent] : []
  })
  provider.uploadedMedias = newMedias.map((m) => m.fileId)

  // The benefit: the listing's own, else one the product already carries,
  // else a new one. Its file list is replaced whenever a file was sent.
  let benefitId =
    known.benefitId ?? existing?.benefits.find((b) => b.type === "downloadables")?.id ?? null
  const fileIds = files.map((f) => f.fileId)
  if (benefitId && (newFiles.length > 0 || !known.benefitId)) {
    await client.request({
      method: "PATCH",
      path: `benefits/${encodeURIComponent(benefitId)}`,
      body: { kind: "json", value: { type: "downloadables", properties: { files: fileIds } } },
      schema: z.unknown(),
    })
    provider.benefit = "updated"
  } else if (!benefitId) {
    const created = await client.request({
      method: "POST",
      path: "benefits",
      body: {
        kind: "json",
        value: {
          type: "downloadables",
          description: toBenefitDescription(fields.name),
          organization_id: organizationId,
          properties: { files: fileIds },
        },
      },
      schema: benefitCreatedSchema,
    })
    benefitId = created.id
    provider.benefit = "created"
  }

  // The product. A new one is a draft until everything is attached.
  let product: ProductRead
  if (existing) {
    product = await client.request({
      method: "PATCH",
      path: `products/${encodeURIComponent(existing.id)}`,
      body: {
        kind: "json",
        value: {
          name: fields.name,
          description: fields.description,
          prices: pricesFor(fields, existing.prices),
          medias: medias.map((m) => m.fileId),
        },
      },
      schema: productSchema,
    })
    provider.product = "updated"
  } else {
    product = await client.request({
      method: "POST",
      path: "products",
      body: {
        kind: "json",
        value: {
          organization_id: organizationId,
          name: fields.name,
          description: fields.description,
          visibility: "draft",
          recurring_interval: null,
          prices: [
            { amount_type: "fixed", price_currency: fields.currency, price_amount: fields.amount },
          ],
          medias: medias.map((m) => m.fileId),
          metadata: { [STAMP_KEY]: context.listing.id },
        },
      },
      schema: productSchema,
    })
    provider.product = "created"
  }

  // Attach the benefit, keeping every other benefit the seller added by hand.
  const benefitIds = [...new Set([...product.benefits.map((b) => b.id), benefitId])]
  if (!product.benefits.some((b) => b.id === benefitId)) {
    product = await client.request({
      method: "POST",
      path: `products/${encodeURIComponent(product.id)}/benefits`,
      body: { kind: "json", value: { benefits: benefitIds } },
      schema: productSchema,
    })
    provider.benefitsAttached = benefitIds
  }

  // The checkout link: the listing's own, else the product's, else a new one.
  let { checkoutLinkId, checkoutUrl } = known
  if (!checkoutLinkId || !checkoutUrl) {
    const query = new URLSearchParams({ product_id: product.id, limit: "1" })
    const { items } = await client.request({
      method: "GET",
      path: `checkout-links?${query.toString()}`,
      schema: checkoutLinkListSchema,
    })
    let link = items[0] ?? null
    if (!link) {
      link = await client.request({
        method: "POST",
        path: "checkout-links",
        body: {
          kind: "json",
          value: {
            payment_processor: "stripe",
            products: [product.id],
            label: fields.name,
            allow_discount_codes: true,
            metadata: { [STAMP_KEY]: context.listing.id },
          },
        },
        schema: checkoutLinkSchema,
      })
      provider.checkoutLink = "created"
    }
    checkoutLinkId = link.id
    checkoutUrl = link.url
  }

  return {
    product,
    state: { files, medias, benefitId, checkoutLinkId, checkoutUrl },
    provider,
  }
}

function result(product: ProductRead, state: StoredState, provider: unknown): PublishResult {
  const live = product.visibility === "public" && !product.is_archived
  const attached =
    state.benefitId !== null && product.benefits.some((b) => b.id === state.benefitId)
  return {
    externalListingId: product.id,
    externalUrl: state.checkoutUrl,
    publicUrl: state.checkoutUrl,
    externalState: live ? "live" : "draft",
    purchasable: live && attached && state.files.length > 0,
    listingMetadata: {
      files: [...state.files],
      medias: [...state.medias],
      benefitId: state.benefitId,
      checkoutLinkId: state.checkoutLinkId,
      checkoutUrl: state.checkoutUrl,
    },
    providerResponse: provider,
  }
}

export const polarAdapter: ChannelAdapter = {
  key: "polar",
  name: "Polar",
  integrationType: "api",
  fields: ["title", "description", "price"],
  capabilities: {
    automaticPublish: true,
    automaticUpdate: true,
    // Exist on the provider; B5 and B6 build the steps that use them.
    metrics: false,
    transactions: false,
    // True. Polar takes the file, in parts, and delivers it to the buyer.
    digitalFileUpload: true,
    imageUpload: true,
    // A publish goes live in one job. Nothing is held as a draft.
    drafts: false,
  },
  requirements,
  manualSteps: [],
  merchandising: polarMerchandising,
  oauth: polarOAuth,

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
      category: null,
      tags: [],
      metadata: {},
    }
  },

  /**
   * Files, images, benefit, product, link, then public. Or resume.
   *
   * The stamp search comes first: a product created by an attempt whose
   * later step failed is picked up where it was left, never created twice.
   * The product is created as a draft and made public only once the benefit
   * is attached and the link exists, so a buyer can never reach a product
   * with nothing behind it.
   */
  async publish(context: PublishContext): Promise<PublishResult> {
    productFields(context)
    const { client, organizationId } = await clientFor(context)

    const existing = await findStamped(client, organizationId, context.listing.id)
    const { product, state, provider } = await reconcile(
      client,
      organizationId,
      context,
      existing,
      EMPTY_STATE,
    )
    provider.resumed = existing !== null

    let live = product
    if (product.visibility !== "public") {
      live = await client.request({
        method: "PATCH",
        path: `products/${encodeURIComponent(product.id)}`,
        body: { kind: "json", value: { visibility: "public" } },
        schema: productSchema,
      })
    }
    // Read back rather than trust the last write: visibility and the
    // benefits it holds are what "live" and "purchasable" mean here.
    const read = await readProduct(client, live.id)
    return result(read, state, { ...provider, live: read })
  },

  /**
   * Updates the fields, keeps the state, and repairs what is missing.
   *
   * Reads first, because a product deleted on Polar is the one signal the
   * runner acts on. Files and images the product is short of are sent and
   * the benefit's list replaced; nothing the seller added by hand is
   * removed. Visibility is never changed: it is the seller's, and an edit
   * must not put a private product on sale.
   */
  async update(context: PublishContext): Promise<PublishResult> {
    const externalId = context.listing.external_listing_id
    if (!externalId) {
      throw new ChannelError(
        normalized("unknown", "This listing has not been published to Polar yet."),
      )
    }
    productFields(context)
    const { client, organizationId } = await clientFor(context)
    const before = await readProduct(client, externalId)
    const { product, state, provider } = await reconcile(
      client,
      organizationId,
      context,
      before,
      storedState(context.listing),
    )
    return result(product, state, { before, ...provider })
  },
}
