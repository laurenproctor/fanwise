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

/**
 * What the product currently is, so a write does not have to guess.
 *
 * Two questions in one round trip, because both are asked at the same moment
 * and a second request would only be a second thing that can fail.
 *
 * `media`: `files` goes out only when Shopify is short (see productSet), so
 * this read is what makes that condition answerable. FAILED is asked for by
 * name: Shopify keeps a media row whose fetch did not succeed, and counting it
 * as media present would make a permanently broken image permanently
 * unrepairable, which is the exact failure this exists to end.
 *
 * `status`: whether Shopify is holding the product live. An update must
 * preserve that, and the listing metadata which used to be the only record of
 * it can be missing. See the `preserve` intent on productSet.
 */
const PRODUCT_STATE = `
  query FanwiseProductState($id: ID!) {
    product(id: $id) {
      status
      media(first: 10) {
        nodes {
          id
          status
          ... on MediaImage {
            mediaErrors { code details message }
          }
        }
      }
    }
  }
`

const productStateSchema = z.object({
  product: z
    .object({
      status: z.string().nullish(),
      media: z.object({
        nodes: z.array(
          z.object({
            id: z.string(),
            status: z.string().nullish(),
            mediaErrors: z
              .array(
                z.object({
                  code: z.string().nullish(),
                  details: z.string().nullish(),
                  message: z.string().nullish(),
                }),
              )
              .nullish(),
          }),
        ),
      }),
    })
    .nullish(),
})

type ProductState = z.infer<typeof productStateSchema>

/**
 * True when Shopify holds fewer usable images than the listing means to send.
 *
 * "Fewer than intended" rather than "none at all", and the difference is a bug
 * that shipped. The earlier rule asked only whether the product had an image,
 * so a product that received its cover on the create was frozen there: every
 * later write omitted `files`, and previews added afterwards had no route to
 * the storefront. Zero to four worked. One to four never did.
 *
 * A FAILED node is not a usable image. Shopify's fetch of `originalSource`
 * happens on its own schedule after the mutation returns, so a URL that was
 * unreachable — expired signature, storage not publicly resolvable — leaves a
 * product that reported a clean publish and shows nothing.
 *
 * §13's curation rule survives the change: a creator who arranged media in the
 * Shopify admin is holding at least as many images as Fanwise would send, so
 * this is false and nothing overwrites their work.
 */
function needsMedia(state: ProductState, intended: number): boolean {
  const nodes = state.product?.media.nodes ?? []
  return nodes.filter((node) => node.status !== "FAILED").length < intended
}

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
 * What a write intends the product's published state to be.
 *
 * `preserve` is the one that needed a name. An update must not change whether
 * a product is on sale, and the only local record of that is
 * `listing.metadata.externalState` — which a rebuild used to blank, and which
 * is simply absent on any listing published before it was first written. A
 * missing value is not the same claim as "it is a draft", and treating the two
 * as equal is how an edit silently takes a live product off sale. `preserve`
 * says "ask Shopify" instead of guessing.
 */
type PublishIntent = "DRAFT" | "ACTIVE" | "preserve"

/**
 * Shopify's own product statuses, which are what `preserve` preserves.
 * ARCHIVED is included because mapping it onto DRAFT would un-archive a
 * product the creator archived deliberately.
 */
const SHOPIFY_STATUSES = ["ACTIVE", "DRAFT", "ARCHIVED"] as const

/**
 * The one external write this adapter makes.
 *
 * `productSet` with an identifier is an update and without one is a create,
 * which is what makes a retry converge instead of duplicating: once the product
 * id is recorded, every subsequent call is an update of that product.
 *
 * It reads before it writes, and both halves of that read are load-bearing:
 * which images Shopify is holding, and whether the product is on sale. Neither
 * can be answered from Fanwise's own tables with enough confidence to risk
 * being wrong, because productSet leaves an omitted field alone and overwrites
 * a supplied one.
 */
async function productSet(context: PublishContext, intent: PublishIntent): Promise<PublishResult> {
  const { listing, subject } = context
  const { shopDomain, client } = await clientFor(context)

  const externalId = listing.external_listing_id
  const price = toMoney(listing.price === null ? null : Number(listing.price))

  /*
   * Media goes out on the create, and again later whenever Shopify is short.
   *
   * The second half is the repair path, and it is why this reads before it
   * writes. Shopify fetches `originalSource` asynchronously, after the mutation
   * has already returned success, so a URL it could not reach produces a
   * published product with no image and no error anywhere. Sending `files`
   * only on the create — which is what this did — made that state permanent:
   * every later write omitted the field, so nothing ever put the image back.
   *
   * The condition is "Shopify holds fewer usable images than this listing
   * sends", not "we have not sent any before". That is what keeps §13's rule
   * intact: a creator who curated media in the Shopify admin holds at least as
   * many as Fanwise would send, so nothing here overwrites it.
   */
  /*
   * Every image the channel is meant to receive, not just the cover.
   *
   * This sent one file, and the images panel says "every channel receives this
   * list, in this order" — so a creator who arranged four pictures got one on
   * the storefront and no indication of where the others went. listingImages is
   * the list, already filtered to ready assets and already ordered with the
   * cover first, which is the order Shopify keeps.
   */
  const images = listingImages(subject)

  /*
   * One read, asked for by either question that needs it.
   *
   * Media needs it to know whether Shopify is short. `preserve` needs it to
   * know whether the product is on sale. Reading once when either applies
   * keeps an update to a single round trip in the common case.
   */
  let state: ProductState | null = null
  if (externalId && (images.length > 0 || intent === "preserve")) {
    state = await client.request({
      query: PRODUCT_STATE,
      variables: { id: externalId },
      schema: productStateSchema,
    })
  }

  /*
   * Resolve the intent into the status this write actually sends.
   *
   * A create has nothing to preserve and is a draft by ADR 0001, so `preserve`
   * on a product that does not exist yet is DRAFT. On a product that does
   * exist, an unreadable status is refused rather than guessed: sending DRAFT
   * because the read came back empty is exactly the silent deactivation this
   * intent exists to prevent, and a creator would rather retry than find their
   * product off sale.
   */
  let status: (typeof SHOPIFY_STATUSES)[number]
  if (intent !== "preserve") {
    status = intent
  } else if (!externalId) {
    status = "DRAFT"
  } else {
    const current = state?.product?.status
    const known = SHOPIFY_STATUSES.find((candidate) => candidate === current)
    if (!known) {
      throw new ChannelError(
        normalized(
          "unknown",
          "Fanwise could not read whether this product is currently on sale in Shopify, " +
            "so it did not risk changing that. Try again.",
          state,
        ),
      )
    }
    status = known
  }

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

  if (images.length > 0 && (!externalId || (state && needsMedia(state, images.length)))) {
    input.files = await Promise.all(
      images.map(async (asset) => ({
        originalSource: await context.assetUrl(asset),
        contentType: "IMAGE",
        // The product's name, not the filename. Alt text is read aloud to a
        // buyer; "Screenshot 2026-09-05 at 6.51.39 PM.jpg" tells them nothing.
        alt: listing.title ?? subject.product.name,
      })),
    )
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
    /*
      The read travels with the write. A publish that reported success while
      the image never arrived is the failure that started this, and the job row
      is where someone looks afterwards; `stateBefore` is what Shopify held at
      the moment we decided what to send — both which images, and whether the
      product was on sale.
    */
    providerResponse: state === null ? result : { ...result, stateBefore: state },
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
   *
   * The local record is used when it exists and is trusted only when it says
   * something. It is absent on any listing published before Fanwise wrote it,
   * and a rebuild used to blank it, so the previous reading of "not live"
   * turned an ordinary edit into a deactivation. Absence now means unknown,
   * and unknown is answered by the provider rather than by a default.
   */
  update(context: PublishContext): Promise<PublishResult> {
    const metadata = context.listing.metadata as Record<string, unknown> | null
    const recorded = metadata?.["externalState"]
    if (recorded === "live") return productSet(context, "ACTIVE")
    if (recorded === "draft") return productSet(context, "DRAFT")
    return productSet(context, "preserve")
  },

  /** The other half of ADR 0001: the file is attached, so the product goes live. */
  activate(context: PublishContext): Promise<PublishResult> {
    return productSet(context, "ACTIVE")
  },
}
