import { z } from "zod"
import {
  DELIVERABLE_LINK_PATH,
  buildDeliverableLinkUrl,
  deliverableLinkToken,
  withoutExtension,
} from "@/lib/channels/deliverable-link"
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
import type { ProductAsset } from "@/lib/products/types"
import type { WooClient } from "./client"
import { DOWNLOAD_REFUSED, productMissing } from "./errors"
import { woocommerceMerchandising } from "./merchandising"
import { woocommerceCredentialsSchema, woocommerceOAuth } from "./oauth"
import { adminProductUrl, storeBase, toDescriptionHtml, toMoney } from "./transform"

/**
 * WooCommerce. The second owned storefront.
 *
 * The field-level spec is docs/channels/woocommerce.md. The short version:
 * WooCommerce has native downloadable products, and a download is a name and a
 * URL the store fetches whenever a buyer downloads. The API offers no upload
 * into the protected folder, and the media library it does offer is public by
 * address and needs a second credential. So Fanwise keeps the file and hands
 * the store a durable, revocable Fanwise address for it (see §6 and
 * lib/publishing/deliverable-links.ts), and a publish goes live in one job,
 * as on Etsy.
 *
 * The rule that made the old manual step worth having survives it: the
 * product is never on sale without a file. The file goes out in the same write
 * that sets the status, and when the store answers with no download on the
 * product anyway, the adapter takes it straight back to a draft.
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
    // an error because Fanwise never puts one on sale without a file: there
    // must be something to attach, and a store answer with no download takes
    // the product back to a draft.
    description: "Fanwise attaches this to the product in WooCommerce for you.",
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

/**
 * None. The file used to be attached by hand; Fanwise now attaches it, so there
 * is no work left that only a person can do. See the header and §6.
 */
const manualSteps: readonly ManualStepSpec[] = []

const downloadSchema = z.object({
  id: z.string().nullish(),
  name: z.string().nullish(),
  file: z.string().nullish(),
})

type Download = z.infer<typeof downloadSchema>

/** What a product read or write returns, as far as this adapter reads it. */
const productSchema = z.object({
  id: z.number(),
  status: z.string(),
  permalink: z.string().nullish(),
  catalog_visibility: z.string().nullish(),
  downloadable: z.boolean().nullish(),
  downloads: z.array(downloadSchema).default([]),
  images: z.array(z.object({ id: z.number().nullish() })).default([]),
})

type Product = z.infer<typeof productSchema>

const DELIVERABLE_TYPES: readonly string[] = ["deliverable", "archive"]

/** The buyer files, in the creator's order. The same set the requirement counts. */
function deliverables(subject: AdapterSubject): ProductAsset[] {
  return subject.assets.filter(
    (asset) => asset.asset_state === "ready" && DELIVERABLE_TYPES.includes(asset.asset_type),
  )
}

type WantedDownload = { name: string; file: string }
type SentDownload = { id?: string; name: string; file: string }

/**
 * The download list to send, or null when the store already has it.
 *
 * The store's list is shared with the creator, who may add files in the admin
 * that Fanwise never saw. So this edits only Fanwise's own entries, recognized
 * by the token in their address, and leaves every other entry exactly as it
 * is, id included:
 *
 *   - an entry of Fanwise's that is still wanted keeps its id and its stored
 *     address (the token is what matters; the address may be the extensionless
 *     fallback) and takes the current name;
 *   - an entry of Fanwise's that is no longer wanted is dropped, because the
 *     asset behind it is gone and its address now answers 404;
 *   - a wanted file the store does not have is appended.
 *
 * Keeping ids is not tidiness. WooCommerce grants a buyer access per download
 * id, and a list resent without them is a list of new downloads nobody who
 * already paid has permission for.
 */
export function planDownloads(
  current: readonly Download[],
  wanted: readonly WantedDownload[],
): SentDownload[] | null {
  const wantedByToken = new Map<string, WantedDownload>()
  for (const entry of wanted) {
    const token = deliverableLinkToken(entry.file)
    if (token) wantedByToken.set(token, entry)
  }

  const next: SentDownload[] = []
  const kept = new Set<string>()

  for (const entry of current) {
    const token = deliverableLinkToken(entry.file)
    if (token === null) {
      // The creator's own. Passed back untouched, or the store would drop it.
      next.push({
        ...(entry.id ? { id: entry.id } : {}),
        name: entry.name ?? "",
        file: entry.file ?? "",
      })
      continue
    }
    const match = wantedByToken.get(token)
    if (!match || kept.has(token)) continue
    kept.add(token)
    next.push({
      ...(entry.id ? { id: entry.id } : {}),
      name: match.name,
      file: entry.file ?? match.file,
    })
  }

  for (const [token, entry] of wantedByToken) {
    if (!kept.has(token)) next.push({ name: entry.name, file: entry.file })
  }

  const unchanged =
    next.length === current.length &&
    next.every((entry, index) => {
      const before = current[index]!
      return entry.file === (before.file ?? "") && entry.name === (before.name ?? "")
    })
  return unchanged ? null : next
}

/**
 * The same list with Fanwise's new addresses stripped of their extension.
 *
 * A store refuses a download whose address ends in an extension outside
 * WordPress's allowed file types, and fonts, among others, are outside the
 * defaults. An address with no extension is not checked for type at all. The
 * cost is the buyer's saved filename, which the store takes from the address,
 * so this is the second attempt and never the first.
 */
function withoutExtensions(downloads: readonly SentDownload[]): SentDownload[] {
  return downloads.map((entry) => {
    if (entry.id || deliverableLinkToken(entry.file) === null) return entry
    const url = new URL(entry.file)
    const token = url.searchParams.get("token")!
    const name = url.pathname.slice(DELIVERABLE_LINK_PATH.length)
    return { ...entry, file: buildDeliverableLinkUrl(url.origin, withoutExtension(name), token) }
  })
}

function refusedDownload(error: unknown): boolean {
  if (!(error instanceof ChannelError)) return false
  const raw = error.normalized.raw as { code?: string } | null
  return raw?.code === DOWNLOAD_REFUSED
}

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

  /*
   * The file, as a Fanwise address the store fetches when a buyer downloads.
   * The addresses are stable, so asking on every write costs a read and
   * changes nothing; planDownloads decides whether the store needs to hear it.
   */
  const wanted = await Promise.all(
    deliverables(subject).map(async (asset) => ({
      name: asset.filename,
      file: await context.deliverableUrl(asset),
    })),
  )
  const downloads = planDownloads(current?.downloads ?? [], wanted)
  if (downloads) body.downloads = downloads

  const send = (payload: Record<string, unknown>) =>
    client.request({
      method: externalId ? "PUT" : "POST",
      path: externalId ? `products/${externalId}` : "products",
      body: payload,
      schema: productSchema,
    })

  let product: Product
  try {
    product = await send(body)
  } catch (error) {
    // One retry, and only for a refused download that an extension could
    // explain. A refusal the retry does not cure is the directory allow-list,
    // and its message says what to switch on.
    if (!downloads || !refusedDownload(error)) throw error
    product = await send({ ...body, downloads: withoutExtensions(downloads) })
  }

  /*
   * Never on sale without a file. The file went out in the same write as the
   * status, so this is the store answering "published" with an empty download
   * list anyway, which a plugin or a store setting can cause. Taken back to a
   * draft at once, by id, before anyone can pay for nothing.
   */
  let demoted = false
  if (product.status === "publish" && product.downloads.length === 0) {
    product = await client.request({
      method: "PUT",
      path: `products/${product.id}`,
      body: { status: "draft" },
      schema: productSchema,
    })
    demoted = true
  }

  return {
    externalListingId: String(product.id),
    // The admin URL: it works before the product is live, which is every
    // product this adapter has just created.
    externalUrl: adminProductUrl(storeUrl, product.id),
    externalState: product.status === "publish" ? "live" : "draft",
    purchasable: isPurchasable(product),
    providerResponse: {
      product,
      ...(current === null ? {} : { stateBefore: current }),
      ...(demoted ? { demotedForMissingFile: true } : {}),
    },
  }
}

/** A buyer can pay for it and receive something. */
function isPurchasable(product: Product): boolean {
  return (
    product.status === "publish" &&
    product.downloads.length > 0 &&
    product.catalog_visibility !== "hidden"
  )
}

function productIn(result: PublishResult): Product {
  return productSchema.parse((result.providerResponse as { product?: unknown }).product)
}

const NO_FILE_ON_PRODUCT =
  "WooCommerce saved this product without its download file, so Fanwise kept it as a draft " +
  "rather than put it on sale. Check that nothing on the store removes downloadable files, then take it live again."

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
    // The file stays with Fanwise and the store is given a durable address
    // it fetches from. Not an upload in the store's own sense, and the one
    // way to put a file on a product without a second credential. See §6.
    digitalFileUpload: true,
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

  /**
   * Creates the product on sale, with its file, in one write.
   *
   * A store that answers without the file gets the product back as a draft
   * (writeProduct), and that is reported as a draft rather than as a failure:
   * the product exists and has an id, and failing here would leave it
   * unrecorded, so the next Publish would create a second one. The listing
   * shows as on the channel but not on sale, with Take it live beside it.
   */
  publish(context: PublishContext): Promise<PublishResult> {
    return writeProduct(context, "publish")
  },

  /**
   * Sends edits without changing whether the product is on sale. A product
   * Fanwise recorded as a draft stays one; Take it live is the way out.
   */
  update(context: PublishContext): Promise<PublishResult> {
    const metadata = context.listing.metadata as Record<string, unknown> | null
    const recorded = metadata?.["externalState"]
    if (recorded === "live") return writeProduct(context, "publish")
    if (recorded === "draft") return writeProduct(context, "draft")
    return writeProduct(context, "preserve")
  },

  /**
   * Puts an existing draft on sale, attaching the file on the way.
   *
   * Reached from Take it live, and from nowhere automatic. It exists for every
   * product that was created as a draft: those published while the file was
   * still a manual step, and any a store answered without its file. Unlike
   * publish, a draft that is still missing its file afterwards is a failure,
   * because here the creator asked for live and did not get it, and the
   * listing is already recorded, so saying so duplicates nothing.
   */
  async activate(context: PublishContext): Promise<PublishResult> {
    if (!context.listing.external_listing_id) {
      throw new ChannelError(
        normalized("unknown", "This listing has not been published to WooCommerce yet."),
      )
    }

    const result = await writeProduct(context, "publish")
    const after = productIn(result)
    if (after.status !== "publish") {
      throw new ChannelError(normalized("validation_rejected", NO_FILE_ON_PRODUCT, after))
    }
    return result
  },
}
