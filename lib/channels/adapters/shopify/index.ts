import { z } from "zod"
import { ChannelError, normalized } from "@/lib/channels/errors"
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
import { createShopifyClient } from "./client"
import { userErrors } from "./errors"
import { shopifyCredentialsSchema, shopifyOAuth } from "./oauth"
import {
  adminProductUrl,
  toDescriptionHtml,
  toMoney,
  toProductType,
  toSeoDescription,
} from "./transform"

/**
 * Shopify. The first real channel, and the one Fanwise does not bill for.
 *
 * The field-level spec is docs/channels/shopify.md, and the delivery decision
 * this adapter implements is docs/decisions/0001-shopify-digital-delivery.md.
 * The short version of both:
 *
 *   Shopify has no API for attaching a buyer-downloadable file. So
 *   digitalFileUpload is false, publish() creates the product as a DRAFT, and
 *   the product only becomes purchasable after a human confirms the file is on
 *   it. A Shopify product that can take money with nothing behind it is the one
 *   outcome worth engineering against, and a draft cannot take money.
 */

const requirements: readonly RequirementSpec[] = [
  {
    kind: "text",
    key: "title",
    label: "Title",
    severity: "error",
    field: "title",
    minLength: 3,
    maxLength: 255,
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
    // Shopify itself does not require a file, so on a literal reading this
    // should be a warning. It is an error because the channel *as Fanwise
    // implements it* needs one: the manual attach step cannot be performed
    // without a file to attach, and a live product with nothing behind it is
    // what ADR 0001 exists to prevent.
    description: "You attach this to the product in Shopify yourself, once.",
    severity: "error",
    assetTypes: ["deliverable", "archive"],
    minCount: 1,
  },
  {
    kind: "tags",
    key: "tags",
    label: "Tags",
    description: "Shopify rejects a product above these limits.",
    severity: "error",
    maxCount: 250,
    maxTagLength: 255,
  },
  {
    kind: "text",
    key: "description",
    label: "Description",
    description: "Shopify publishes without one. Buyers do not buy without one.",
    severity: "warning",
    field: "description",
    minLength: 40,
    // Shopify's body limit. Well beyond anything a creator types by hand, and
    // present so the editor's counter shows the real wall rather than none.
    maxLength: 65535,
  },
  {
    kind: "asset",
    key: "cover_image",
    label: "A cover image",
    description: "The first thing a buyer sees in the storefront grid.",
    severity: "warning",
    assetTypes: ["cover_image"],
    minCount: 1,
  },
  {
    kind: "custom",
    key: "vendor",
    label: "A brand name",
    description: "Becomes the product's vendor. Falls back to nothing if unset.",
    severity: "warning",
    evaluate(_draft, subject) {
      const vendor = subject.product.brand_name?.trim() ?? ""
      return vendor.length > 0
        ? { satisfied: true }
        : { satisfied: false, message: "Set a brand name on the product to fill Shopify's vendor." }
    },
  },
  {
    kind: "custom",
    key: "currency_matches_shop",
    label: "Price is in the store's currency",
    description: "Shopify prices in the store's own currency. There is no per-product override.",
    severity: "warning",
    evaluate(draft, subject) {
      const shopCurrency = subject.connectionMetadata?.["currencyCode"]
      // Before the store is connected there is nothing to compare against, and
      // a rule with no data is not a rule that passed. It reports what it knows.
      if (typeof shopCurrency !== "string" || shopCurrency.length === 0) {
        return {
          satisfied: false,
          message: "Connect the store and Fanwise will check this against its currency.",
        }
      }
      if (shopCurrency.toUpperCase() === draft.currency.toUpperCase()) return { satisfied: true }
      return {
        satisfied: false,
        message: `This listing is priced in ${draft.currency}, and the store sells in ${shopCurrency.toUpperCase()}. Shopify will charge ${draft.price ?? 0} ${shopCurrency.toUpperCase()}, not a converted amount.`,
      }
    },
  },
]

/** ADR 0001's assisted file step, and the only manual step this channel has. */
export const ATTACH_DIGITAL_FILE = "attach_digital_file"

const manualSteps: readonly ManualStepSpec[] = [
  {
    key: ATTACH_DIGITAL_FILE,
    label: "Attach the download file",
    description:
      "Shopify has no API for digital files, so this step is manual, once per product. " +
      "The product stays a draft until you confirm it, so nobody can buy it before the file is on it.",
    instructions: [
      "Download the deliverable from Fanwise.",
      "Open the product in Shopify.",
      "Add a digital attachment and upload the file.",
    ],
    required: true,
    gatesActivation: true,
    needsDeliverable: true,
  },
]

const PRODUCT_SET = `
  mutation FanwiseProductSet($identifier: ProductSetIdentifiers, $input: ProductSetInput!) {
    productSet(identifier: $identifier, input: $input, synchronous: true) {
      product {
        id
        legacyResourceId
        handle
        status
        onlineStoreUrl
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`

const productSetSchema = z.object({
  productSet: z.object({
    product: z
      .object({
        id: z.string(),
        legacyResourceId: z.string(),
        handle: z.string(),
        status: z.string(),
        onlineStoreUrl: z.string().nullish(),
      })
      .nullish(),
    userErrors: z.array(
      z.object({
        field: z.array(z.string()).nullish(),
        message: z.string(),
        code: z.string().nullish(),
      }),
    ),
  }),
})

/** Shopify's single-variant convention. */
const OPTION_NAME = "Title"
const OPTION_VALUE = "Default Title"

async function clientFor(context: PublishContext) {
  const shopDomain = context.connection.external_account_id
  if (!shopDomain) {
    throw new ChannelError(
      normalized(
        "credentials_invalid",
        "This Shopify connection is missing its store domain. Reconnect the store.",
      ),
    )
  }

  const credentials = await readConnectionCredentials({
    workspaceId: context.connection.workspace_id,
    connectionId: context.connection.id,
    schema: shopifyCredentialsSchema,
  })
  if (!credentials) {
    throw new ChannelError(
      normalized(
        "credentials_invalid",
        "Fanwise no longer holds an authorization for this Shopify store. Reconnect it.",
      ),
    )
  }

  return {
    shopDomain,
    client: createShopifyClient({ shopDomain, accessToken: credentials.accessToken }),
  }
}

/**
 * The one external write this adapter makes.
 *
 * `productSet` with an identifier is an update and without one is a create,
 * which is what makes a retry converge instead of duplicating: once the product
 * id is recorded, every subsequent call is an update of that product.
 *
 * `files` is sent only on the create. productSet leaves an omitted field alone,
 * so re-sending media on every update would risk replacing a media list the
 * creator may have since curated in Shopify. Confirming that is item 3 in
 * docs/channels/shopify.md section 13.
 */
async function productSet(
  context: PublishContext,
  status: "DRAFT" | "ACTIVE",
): Promise<PublishResult> {
  const { listing, subject } = context
  const { shopDomain, client } = await clientFor(context)

  const externalId = listing.external_listing_id
  const price = toMoney(listing.price === null ? null : Number(listing.price))

  const input: Record<string, unknown> = {
    title: listing.title ?? subject.product.name,
    descriptionHtml: toDescriptionHtml(listing.description),
    handle: subject.product.slug,
    productType: toProductType(listing.category ?? subject.product.product_type),
    vendor: subject.product.brand_name ?? undefined,
    tags: listing.tags ?? [],
    status,
    seo: { description: toSeoDescription(listing.short_description) },
    productOptions: [{ name: OPTION_NAME, values: [{ name: OPTION_VALUE }] }],
    variants: [
      {
        optionValues: [{ optionName: OPTION_NAME, name: OPTION_VALUE }],
        ...(price === null ? {} : { price }),
        taxable: true,
        // Not cosmetic. Left true, Shopify asks a buyer for a shipping address
        // and may quote a shipping rate on a font.
        inventoryItem: { requiresShipping: false, tracked: false },
      },
    ],
  }

  if (!externalId) {
    const cover = subject.assets.find(
      (asset) => asset.asset_state === "ready" && asset.asset_type === "cover_image",
    )
    if (cover) {
      input.files = [
        {
          originalSource: await context.assetUrl(cover),
          contentType: "IMAGE",
          alt: listing.title ?? subject.product.name,
        },
      ]
    }
  }

  const result = await client.request({
    query: PRODUCT_SET,
    variables: {
      identifier: externalId ? { id: externalId } : null,
      input,
    },
    schema: productSetSchema,
  })

  if (result.productSet.userErrors.length > 0) {
    throw new ChannelError(userErrors(result.productSet.userErrors))
  }

  const product = result.productSet.product
  if (!product) {
    throw new ChannelError(
      normalized(
        "unknown",
        "Shopify accepted the request without returning a product, so nothing was confirmed.",
        result,
      ),
    )
  }

  return {
    externalListingId: product.id,
    // The admin URL, not the storefront one. onlineStoreUrl is null while a
    // product is a draft, which is every product this adapter has just created.
    externalUrl: adminProductUrl(shopDomain, product.legacyResourceId),
    externalState: product.status === "ACTIVE" ? "live" : "draft",
    providerResponse: result,
  }
}

export const shopifyAdapter: ChannelAdapter = {
  key: "shopify",
  name: "Shopify",
  integrationType: "api",
  capabilities: {
    automaticPublish: true,
    automaticUpdate: true,
    // False for two different reasons, and the difference matters. These two
    // exist on Shopify and Fanwise has not built the steps that use them: B5
    // for transactions, B6 for metrics. Declaring them now would have the UI
    // offer a sales report that does not exist.
    metrics: false,
    transactions: false,
    // False because Shopify cannot do it at all. See ADR 0001.
    digitalFileUpload: false,
    imageUpload: true,
    // True and load-bearing: publish creates a draft, and activate is what
    // makes it live once the file is attached.
    drafts: true,
  },
  requirements,
  manualSteps,
  oauth: shopifyOAuth,

  buildListing({ product }: AdapterSubject): ChannelListingDraft {
    return {
      title: product.canonical_title ?? product.name,
      description: product.canonical_description,
      shortDescription: product.short_description,
      price: product.base_price === null ? null : Number(product.base_price),
      currency: product.currency,
      category: product.product_type,
      tags: [],
      metadata: {},
    }
  },

  /** Creates the product as a draft. Nobody can buy it yet, on purpose. */
  publish(context: PublishContext): Promise<PublishResult> {
    return productSet(context, "DRAFT")
  },

  /**
   * Updates in place, preserving whether the product is currently live. An edit
   * must not quietly take a live product off sale, and must not quietly put a
   * draft one on it.
   */
  update(context: PublishContext): Promise<PublishResult> {
    const wasLive = context.listing.metadata as Record<string, unknown> | null
    return productSet(context, wasLive?.["externalState"] === "live" ? "ACTIVE" : "DRAFT")
  },

  /** The other half of ADR 0001: the file is attached, so the product goes live. */
  activate(context: PublishContext): Promise<PublishResult> {
    return productSet(context, "ACTIVE")
  },
}
