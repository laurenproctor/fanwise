import { z } from "zod"
import { ChannelError, normalized } from "@/lib/channels/errors"
import { listingImages } from "@/lib/channels/images"
import { readConnectionCredentials } from "@/lib/credentials"
import type {
  AdapterSubject,
  ChannelAdapter,
  ChannelListingDraft,
  ManualStepSpec,
  PublishContext,
  PublishResult,
  RequirementSpec,
} from "@/lib/channels/types"
import type { WooClient } from "./client"
import { productMissing } from "./errors"
import { woocommerceMerchandising } from "./merchandising"
import { woocommerceCredentialsSchema, woocommerceOAuth } from "./oauth"
import { adminProductUrl, storeBase, toDescriptionHtml, toMoney } from "./transform"

/**
 * WooCommerce. The second owned storefront.
 *
 * The field-level spec is docs/channels/woocommerce.md. The short version:
 * WooCommerce has native downloadable products, and the API can set every
 * field of one except the file. A download has to be a URL the store can
 * already serve, the API offers no upload into the protected folder, and the
 * media library it does offer is public by address. So the file step is
 * assisted, as on Shopify, and this adapter can do one thing Shopify's
 * cannot: read the product back and see whether the file is there before it
 * puts the product on sale.
 */

const requirements: readonly RequirementSpec[] = [
  {
    kind: "text",
    key: "title",
    label: "Title",
    severity: "error",
    field: "title",
    minLength: 3,
    maxLength: 200,
  },
  {
    kind: "number",
    key: "price",
    label: "Price",
    severity: "error",
    field: "price",
    min: 0,
  },
  {
    kind: "asset",
    key: "deliverable",
    label: "A deliverable",
    // WooCommerce itself publishes a downloadable product with no file. It is
    // an error because the channel as Fanwise implements it needs one: the
    // attach step cannot be performed without a file, and activate refuses a
    // product whose download list is empty.
    description: "You attach this to the product in WooCommerce yourself, once.",
    severity: "error",
    assetTypes: ["deliverable", "archive"],
    minCount: 1,
  },
  {
    kind: "tags",
    key: "tags",
    label: "Tags",
    description: "A WordPress term name is limited to 200 characters.",
    severity: "error",
    maxTagLength: 200,
  },
  {
    kind: "text",
    key: "description",
    label: "Description",
    description: "WooCommerce publishes without one. Buyers do not buy without one.",
    severity: "warning",
    field: "description",
    minLength: 40,
    maxLength: 65535,
  },
  {
    kind: "text",
    key: "short_description",
    label: "Short description",
    description: "Shown beside the price, above the buy button.",
    severity: "warning",
    field: "shortDescription",
    optional: true,
    maxLength: 1000,
  },
  {
    kind: "asset",
    key: "cover_image",
    label: "A cover image",
    description: "The first thing a buyer sees in the shop grid.",
    severity: "warning",
    assetTypes: ["cover_image"],
    minCount: 1,
  },
  {
    kind: "custom",
    key: "currency_matches_store",
    label: "Price is in the store's currency",
    description:
      "WooCommerce prices in the store's own currency. There is no per-product override.",
    severity: "warning",
    evaluate(draft, subject) {
      const storeCurrency = subject.connectionMetadata?.["currency"]
      if (typeof storeCurrency !== "string" || storeCurrency.length === 0) {
        return {
          satisfied: false,
          message: "Connect the store and Fanwise will check this against its currency.",
        }
      }
      if (storeCurrency.toUpperCase() === draft.currency.toUpperCase()) return { satisfied: true }
      return {
        satisfied: false,
        message: `This listing is priced in ${draft.currency}, and the store sells in ${storeCurrency.toUpperCase()}. WooCommerce will charge ${draft.price ?? 0} ${storeCurrency.toUpperCase()}, not a converted amount.`,
      }
    },
  },
]

export const ATTACH_DIGITAL_FILE = "attach_digital_file"

const manualSteps: readonly ManualStepSpec[] = [
  {
    key: ATTACH_DIGITAL_FILE,
    label: "Attach the download file",
    description:
      "WooCommerce's API cannot put a file in the protected downloads folder, so this step is manual, once per product. " +
      "The product stays a draft until Fanwise sees the file on it, so nobody can buy it before it is there.",
    instructions: [
      "Download the deliverable from Fanwise.",
      "Open the product in WooCommerce and scroll to Product data.",
      "Under Downloadable files, add a file, upload the deliverable, and Update the product.",
    ],
    required: true,
    gatesActivation: true,
    needsDeliverable: true,
  },
]

/** What a product read or write returns, as far as this adapter reads it. */
const productSchema = z.object({
  id: z.number(),
  status: z.string(),
  permalink: z.string().nullish(),
  catalog_visibility: z.string().nullish(),
  downloadable: z.boolean().nullish(),
  downloads: z
    .array(z.object({ name: z.string().nullish(), file: z.string().nullish() }))
    .default([]),
  images: z.array(z.object({ id: z.number().nullish() })).default([]),
})

type Product = z.infer<typeof productSchema>

const tagSchema = z.object({ id: z.number(), name: z.string() })

/** WooCommerce's own product statuses, which `preserve` preserves. */
const STATUSES = ["draft", "pending", "private", "publish"] as const
type Status = (typeof STATUSES)[number]

type PublishIntent = "draft" | "publish" | "preserve"

async function clientFor(
  context: PublishContext,
): Promise<{ storeUrl: string; client: WooClient }> {
  const account = context.connection.external_account_id
  if (!account) {
    throw new ChannelError(
      normalized(
        "credentials_invalid",
        "This WooCommerce connection is missing its store address. Reconnect the store.",
      ),
    )
  }

  const credentials = await readConnectionCredentials({
    workspaceId: context.connection.workspace_id,
    connectionId: context.connection.id,
    schema: woocommerceCredentialsSchema,
  })
  if (!credentials) {
    throw new ChannelError(
      normalized(
        "credentials_invalid",
        "Fanwise no longer holds keys for this WooCommerce store. Reconnect it.",
      ),
    )
  }

  const storeUrl = storeBase(account)
  // Loaded here rather than at the top of the file. The adapter object is
  // read in the browser by the listing editor, for its requirements and its
  // name; the client reaches lib/net, which reaches node:net and node:dns,
  // and a browser bundle has no such modules. Only a server ever gets this
  // far, and it is the only place a store is talked to from this file.
  const { createWooClient } = await import("./client")
  return { storeUrl, client: createWooClient({ storeUrl, ...credentials }) }
}

/**
 * Reads the product, and raises the one signal the runner acts on.
 *
 * A 404 with WooCommerce's own "invalid id" code, from a read of the id
 * Fanwise recorded, is the store saying the product is gone. It is raised
 * only from that read and never inferred from a failure elsewhere: "we could
 * not ask" must never be recorded as "it is not there".
 */
async function readProduct(client: WooClient, id: string): Promise<Product> {
  try {
    return await client.request({ method: "GET", path: `products/${id}`, schema: productSchema })
  } catch (error) {
    if (
      error instanceof ChannelError &&
      error.normalized.code === "not_found" &&
      typeof error.normalized.raw === "object" &&
      error.normalized.raw !== null &&
      (error.normalized.raw as { code?: string }).code === "woocommerce_rest_product_invalid_id"
    ) {
      throw new ChannelError(productMissing(error.normalized.raw))
    }
    throw error
  }
}

/**
 * Tag ids for tag names.
 *
 * WooCommerce attaches tags to a product by id, and a tag is created by a
 * separate call. Creating one that exists answers 400 `term_exists` carrying
 * the existing id, which is the lookup this needs and cheaper than a search
 * per tag; so the create is attempted first and the refusal is read.
 */
async function ensureTagIds(client: WooClient, names: readonly string[]): Promise<number[]> {
  const ids: number[] = []
  for (const name of names) {
    try {
      const created = await client.request({
        method: "POST",
        path: "products/tags",
        body: { name },
        schema: tagSchema,
      })
      ids.push(created.id)
    } catch (error) {
      const raw =
        error instanceof ChannelError
          ? (error.normalized.raw as { code?: string; data?: { resource_id?: number } } | null)
          : null
      if (raw?.code === "term_exists" && typeof raw.data?.resource_id === "number") {
        ids.push(raw.data.resource_id)
        continue
      }
      throw error
    }
  }
  return ids
}

/**
 * The one external write this adapter makes: a create without an id, an
 * update with one, which is what makes a retry converge instead of
 * duplicating. It reads before it writes whenever the product should exist,
 * for the same three reasons Shopify's does: whether the store is short of
 * images, whether the product is on sale, and whether it is there at all.
 */
async function writeProduct(
  context: PublishContext,
  intent: PublishIntent,
): Promise<PublishResult> {
  const { listing, subject } = context
  const { storeUrl, client } = await clientFor(context)

  const externalId = listing.external_listing_id
  const images = listingImages(subject)

  let current: Product | null = null
  if (externalId) current = await readProduct(client, externalId)

  let status: Status
  if (intent !== "preserve") {
    status = intent
  } else if (!current) {
    status = "draft"
  } else {
    const known = STATUSES.find((candidate) => candidate === current!.status)
    if (!known) {
      throw new ChannelError(
        normalized(
          "unknown",
          "Fanwise could not read whether this product is currently on sale in WooCommerce, " +
            "so it did not risk changing that. Try again.",
          current,
        ),
      )
    }
    status = known
  }

  const tagIds = await ensureTagIds(client, listing.tags ?? [])
  const price = toMoney(listing.price === null ? null : Number(listing.price))

  const body: Record<string, unknown> = {
    name: listing.title ?? subject.product.name,
    type: "simple",
    status,
    description: toDescriptionHtml(listing.description),
    short_description: toDescriptionHtml(listing.short_description),
    ...(price === null ? {} : { regular_price: price }),
    // A digital product: nothing ships, and one copy per order.
    virtual: true,
    downloadable: true,
    sold_individually: true,
    catalog_visibility: "visible",
    tags: tagIds.map((id) => ({ id })),
  }

  /*
   * Images go out on the create, and again whenever the store holds fewer
   * than the listing means to send. WooCommerce replaces the whole list and
   * sideloads every `src`, so resending on every update would duplicate the
   * media library each time; sending only when short keeps a creator's own
   * arrangement in the admin intact.
   */
  if (images.length > 0 && (!current || current.images.length < images.length)) {
    body.images = await Promise.all(
      images.map(async (asset) => ({
        src: await context.assetUrl(asset),
        alt: listing.title ?? subject.product.name,
      })),
    )
  }

  const product = await client.request({
    method: externalId ? "PUT" : "POST",
    path: externalId ? `products/${externalId}` : "products",
    body,
    schema: productSchema,
  })

  return {
    externalListingId: String(product.id),
    // The admin URL: it works before the product is live, which is every
    // product this adapter has just created.
    externalUrl: adminProductUrl(storeUrl, product.id),
    externalState: product.status === "publish" ? "live" : "draft",
    providerResponse: current === null ? product : { product, stateBefore: current },
  }
}

export const woocommerceAdapter: ChannelAdapter = {
  key: "woocommerce",
  name: "WooCommerce",
  integrationType: "api",
  capabilities: {
    automaticPublish: true,
    automaticUpdate: true,
    // Exist on the provider; the steps that use them are B5 and B6.
    metrics: false,
    transactions: false,
    // False because Fanwise will not, rather than because the store cannot:
    // the only API path puts the file somewhere public. See the spec, §6.
    digitalFileUpload: false,
    imageUpload: true,
    drafts: true,
  },
  requirements,
  manualSteps,
  merchandising: woocommerceMerchandising,
  oauth: woocommerceOAuth,

  buildListing({ product }: AdapterSubject): ChannelListingDraft {
    return {
      title: product.canonical_title ?? product.name,
      description: product.canonical_description,
      shortDescription: product.short_description,
      // WooCommerce has no search-result fields of its own.
      seoTitle: null,
      seoDescription: null,
      price: product.base_price === null ? null : Number(product.base_price),
      currency: product.currency,
      // Categories are the store's own terms, not a taxonomy Fanwise can map
      // to; the creator assigns one in the admin if they want one.
      category: null,
      tags: [],
      metadata: {},
    }
  },

  /** Creates the product as a draft. Nobody can buy it yet, on purpose. */
  async publish(context: PublishContext): Promise<PublishResult> {
    const result = await writeProduct(context, "draft")
    return { ...result, purchasable: false }
  },

  update(context: PublishContext): Promise<PublishResult> {
    const metadata = context.listing.metadata as Record<string, unknown> | null
    const recorded = metadata?.["externalState"]
    if (recorded === "live") return writeProduct(context, "publish")
    if (recorded === "draft") return writeProduct(context, "draft")
    return writeProduct(context, "preserve")
  },

  /**
   * Puts the product on sale, and only if the file is on it.
   *
   * The step is a person's claim that they attached the file. Here, unlike on
   * Shopify, the claim can be checked: the product read carries its download
   * list, and an empty one means the claim is not yet true. Refusing is the
   * whole point of the draft gate: a published downloadable product with no
   * file takes money and gives nothing back.
   */
  async activate(context: PublishContext): Promise<PublishResult> {
    const externalId = context.listing.external_listing_id
    if (!externalId) {
      throw new ChannelError(
        normalized("unknown", "This listing has not been published to WooCommerce yet."),
      )
    }
    const { client } = await clientFor(context)
    const before = await readProduct(client, externalId)
    if (before.downloads.length === 0) {
      throw new ChannelError(
        normalized(
          "validation_rejected",
          "No download file is attached to this product in WooCommerce yet. Add it under " +
            "Downloadable files, save the product, then mark the step done again.",
          before,
        ),
      )
    }

    const result = await writeProduct(context, "publish")
    const after = productSchema.parse(
      (result.providerResponse as { product?: unknown })?.product ?? result.providerResponse,
    )
    return {
      ...result,
      purchasable:
        after.status === "publish" &&
        after.downloads.length > 0 &&
        after.catalog_visibility !== "hidden",
    }
  },
}
