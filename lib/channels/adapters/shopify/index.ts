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
import { CATEGORY_LABELS, defaultCategoryLabel, taxonomyCategoryId } from "./categories"
import { staleScopes } from "./config"
import {
  PUBLICATIONS,
  publicationsSchema,
  resolvePublication,
  type ResolvedPublication,
} from "./publications"
import {
  SEO_DESCRIPTION_LIMIT,
  SEO_TITLE_LIMIT,
  adminProductUrl,
  toDescriptionHtml,
  toMoney,
  toProductType,
  toSeoDescription,
  toSeoTitle,
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
    kind: "enum",
    key: "category",
    label: "Category",
    description:
      "Shopify's own product taxonomy. It drives the category fields and feeds Shopify builds around a product, and is a different field from the product type.",
    // A warning, not an error: Shopify creates a product with no category, and
    // one of these is always seeded from the Fanwise product type, so the rule
    // only fires on a listing whose category was cleared or set to something
    // this build no longer recognises.
    severity: "warning",
    field: "category",
    allowed: CATEGORY_LABELS,
  },
  {
    kind: "text",
    key: "seo_title",
    label: "Meta title",
    description: "Shown as the headline in a search result. Falls back to the listing title.",
    severity: "warning",
    field: "seoTitle",
    optional: true,
    maxLength: SEO_TITLE_LIMIT,
  },
  {
    kind: "text",
    key: "seo_description",
    label: "Meta description",
    description:
      "Shown under the headline in a search result. Falls back to the short description.",
    severity: "warning",
    field: "seoDescription",
    optional: true,
    maxLength: SEO_DESCRIPTION_LIMIT,
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
 * Putting the product on a sales channel, which `productSet` cannot do.
 *
 * ADR 0004. `status: ACTIVE` and *on a sales channel* are separate facts on
 * Shopify, and setting the first without the second is what produced three
 * products nobody could buy. `resourcePublicationsCount` comes back so the
 * result can be asserted rather than assumed: this is the call that decides
 * whether Fanwise is allowed to tell a creator their product is on sale.
 */
const PUBLISHABLE_PUBLISH = `
  mutation FanwisePublishablePublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      publishable {
        resourcePublicationsCount { count }
      }
      userErrors { field message }
    }
  }
`

const publishablePublishSchema = z.object({
  publishablePublish: z.object({
    publishable: z
      .object({
        resourcePublicationsCount: z.object({ count: z.number() }).nullish(),
      })
      .nullish(),
    userErrors: z.array(z.object({ field: z.array(z.string()).nullish(), message: z.string() })),
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
  /*
   * The connection is authorized, but is it authorized for what this build
   * needs? ADR 0004 added two scopes, and Fanwise runs its own OAuth rather
   * than Shopify's managed installation, so nothing has prompted the creator
   * on its behalf. Their existing token simply cannot do the new thing.
   *
   * Asked here, before any call, so the ask arrives as an explanation rather
   * than as a 403 at the end of an activate — after the product exists and
   * after the creator has already attached the file by hand.
   */
  const missing = staleScopes(context.connection.scopes ?? [])
  if (missing.length > 0) {
    throw new ChannelError(
      normalized(
        "permission_denied",
        "Fanwise needs one more permission on this Shopify store before it can put products on " +
          "sale. Reconnect the store and accept the permissions it asks for. Your existing " +
          "products are not affected.",
        { missing },
      ),
    )
  }

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
   * One read, whenever the product is supposed to already exist.
   *
   * Three questions come out of it. Media needs it to know whether Shopify is
   * short. `preserve` needs it to know whether the product is on sale. And
   * both of those presume an answer to the third, which nothing used to ask:
   * whether the product is there at all.
   *
   * It used to be skipped when neither of the first two applied, which is how
   * a product deleted in the Shopify admin stayed invisible to Fanwise. The
   * listing went on holding an id and an admin URL that returned Not Found,
   * every write against the identifier failed in a different and less
   * intelligible way, and there was no path back to a working product. One
   * extra round trip on an activate is a small price for the listing being
   * able to say something true.
   */
  let state: ProductState | null = null
  if (externalId) {
    state = await client.request({
      query: PRODUCT_STATE,
      variables: { id: externalId },
      schema: productStateSchema,
    })

    /*
     * A null product from a query that succeeded is Shopify's way of saying
     * there is no such product. It is not an error, not a 404 and not an empty
     * media list: the request was fine and the answer is that the object is
     * gone.
     *
     * This is the one signal the runner acts on by changing the listing, which
     * is why it is raised only from a successful read of a specific id and
     * never inferred from a failure. A transport error here throws before this
     * line, and correctly so — "we could not ask" must never be recorded as
     * "it is not there".
     */
    if (!state.product) {
      throw new ChannelError(
        normalized(
          "external_object_missing",
          "This product no longer exists in Shopify. It looks like it was deleted there, " +
            "so Fanwise has marked the listing as not published. Publish it again to create a new one.",
          state,
        ),
      )
    }
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

  /*
   * Category and product type are two fields, not one spelled twice.
   *
   * `productType` is free text with no taxonomy behind it, which is why it was
   * the only one this adapter used to send and why the Category field on every
   * product Fanwise created was empty. `category` is an id from Shopify's
   * Standard Product Taxonomy, and it is what Shopify's own category
   * attributes and product feeds read.
   *
   * An unresolvable label sends no category rather than clearing the one
   * Shopify holds: productSet leaves an omitted field alone, and wiping a
   * category the creator set in the Shopify admin because a label drifted here
   * would turn a naming problem into data loss.
   */
  const categoryId = taxonomyCategoryId(listing.category)

  /*
   * Both halves of the SEO input, and both fall back rather than going out
   * empty.
   *
   * A half with nothing behind it is left out of the object rather than sent as
   * null, and the whole `seo` key is left out when neither half has a value. In
   * GraphQL an explicit null is an instruction to clear the field, so the
   * shorter spelling would quietly wipe a page title the creator wrote in the
   * Shopify admin every time Fanwise sent an update — the same mistake as
   * clearing a category, in the field a creator is least likely to check.
   *
   * Empty is likewise not sent as "". Shopify stores the blank and stops
   * deriving the field from the product, so a creator who never touched these
   * would end up with a search result that has no title at all.
   */
  const seoTitle = toSeoTitle(listing.seo_title ?? listing.title ?? subject.product.name)
  const seoDescription = toSeoDescription(listing.seo_description ?? listing.short_description)
  const seo =
    seoTitle === null && seoDescription === null
      ? null
      : {
          ...(seoTitle === null ? {} : { title: seoTitle }),
          ...(seoDescription === null ? {} : { description: seoDescription }),
        }

  const input: Record<string, unknown> = {
    title: listing.title ?? subject.product.name,
    descriptionHtml: toDescriptionHtml(listing.description),
    handle: subject.product.slug,
    productType: toProductType(subject.product.product_type),
    ...(categoryId === null ? {} : { category: categoryId }),
    vendor: subject.product.brand_name ?? undefined,
    tags: listing.tags ?? [],
    status,
    ...(seo === null ? {} : { seo }),
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

/**
 * Puts a product on a sales channel, and confirms it landed there.
 *
 * Two calls, and the second is not optional. `publishablePublish` reports its
 * own userErrors, but the question this function exists to answer is not "did
 * the mutation succeed" — it is "can a buyer reach this now", and only the
 * count of publications the product actually sits on answers that. A5's whole
 * blocker was a mutation reporting success about a fact nobody checked.
 *
 * Returns whether the product is purchasable, which the caller passes up to the
 * listing. It never returns true on an assumption.
 */
async function publishToSalesChannel(
  context: PublishContext,
  productId: string,
): Promise<{ purchasable: boolean; publication: ResolvedPublication; count: number }> {
  const { client } = await clientFor(context)

  const publications = await client.request({
    query: PUBLICATIONS,
    variables: {},
    schema: publicationsSchema,
  })

  // Throws rather than picks when the shop's channels are ambiguous. Putting a
  // font on Point of Sale because a handle did not match is worse than an error
  // a creator can act on.
  const publication = resolvePublication(publications)

  const result = await client.request({
    query: PUBLISHABLE_PUBLISH,
    variables: {
      id: productId,
      input: [{ publicationId: publication.publicationId }],
    },
    schema: publishablePublishSchema,
  })

  if (result.publishablePublish.userErrors.length > 0) {
    throw new ChannelError(
      userErrors(
        result.publishablePublish.userErrors.map((error) => ({
          field: error.field,
          message: error.message,
        })),
      ),
    )
  }

  /*
   * The count is the answer, not the absence of errors.
   *
   * A publication the product could not be added to for a reason Shopify
   * expresses as something other than a userError would otherwise be reported
   * to the creator as "Live", which is the exact sentence this whole change
   * exists to stop being a lie.
   */
  const count = result.publishablePublish.publishable?.resourcePublicationsCount?.count ?? 0

  return { purchasable: count > 0, publication, count }
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
      // Null, not a copy of the fields they fall back to. Writing the fallback
      // into the row would turn "the creator did not override this" into "the
      // creator chose exactly this", and every later edit to the title would
      // leave a meta title behind that used to match it and now silently does
      // not. The adapter resolves the fallback at the moment it sends.
      seoTitle: null,
      seoDescription: null,
      price: product.base_price === null ? null : Number(product.base_price),
      currency: product.currency,
      // A Shopify taxonomy label rather than the Fanwise product type. The
      // column is shared across channels but its meaning is the channel's, and
      // for Shopify the category is a taxonomy id, not a word.
      category: defaultCategoryLabel(product.product_type),
      tags: [],
      metadata: {},
    }
  },

  /** Creates the product as a draft. Nobody can buy it yet, on purpose. */
  async publish(context: PublishContext): Promise<PublishResult> {
    const result = await productSet(context, "DRAFT")
    // Stated rather than left unknown. A draft is definitively not purchasable,
    // and recording that is what lets the UI distinguish it later from a
    // listing whose purchasability nothing has established.
    return { ...result, purchasable: false }
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

  /**
   * The other half of ADR 0001, and now the whole of ADR 0004.
   *
   * Two facts have to become true before a buyer can buy, and Shopify keeps
   * them apart: the product must be ACTIVE, and it must be on a sales channel.
   * A5's exit test found products that were the first and not the second, and
   * `activate` claiming success on the first alone is what let Fanwise report
   * "Live" about a product with no storefront page.
   *
   * Ordered deliberately. The status write goes first because it is the one
   * that converges — `productSet` with an identifier is an update, so a retry
   * after a failed publish step costs nothing and changes nothing. If the
   * channel publish then fails, the product is ACTIVE and unreachable, which
   * is a state the listing now describes accurately instead of one it used to
   * describe as live.
   */
  async activate(context: PublishContext): Promise<PublishResult> {
    const result = await productSet(context, "ACTIVE")
    const placement = await publishToSalesChannel(context, result.externalListingId)

    return {
      ...result,
      purchasable: placement.purchasable,
      providerResponse: {
        productSet: result.providerResponse,
        publication: {
          id: placement.publication.publicationId,
          // How it was chosen, kept because a match on a handle and a shop that
          // simply had one channel are not equally strong answers, and the job
          // row is where somebody looks when a product lands somewhere odd.
          resolvedBy: placement.publication.reason,
          autoPublish: placement.publication.autoPublish,
          resourcePublicationsCount: placement.count,
        },
      },
    }
  },
}
