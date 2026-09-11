import type {
  AdapterSubject,
  ChannelAdapter,
  ChannelListingDraft,
  PublishContext,
  PublishResult,
  RequirementSpec,
} from "@/lib/channels/types"

/**
 * A mock channel that behaves like an API marketplace.
 *
 * It exists so the adapter contract has two shapes to satisfy before a real
 * provider arrives, and so the capability matrix is exercised by something CI
 * can run without a network. Its twin, mock-assisted, structurally cannot
 * publish; this one can.
 *
 * Nothing here talks to anything. publish() returns a deterministic fake id
 * derived from the listing, which is what lets A5's idempotency tests prove
 * "a second click creates nothing" without a network: two publishes of the same
 * listing would produce the same external id, so a duplicate would collide on
 * channel_listings' partial unique index if the guards above it ever failed.
 *
 * It uploads its own deliverable, so it declares no manual steps and its
 * products go straight to `live`. Its twin, mock-assisted, cannot publish at
 * all. Between them the two ends of the capability matrix are covered.
 */

const requirements: readonly RequirementSpec[] = [
  {
    kind: "text",
    key: "title",
    label: "Title",
    severity: "error",
    field: "title",
    minLength: 3,
    maxLength: 120,
  },
  {
    kind: "text",
    key: "description",
    label: "Description",
    severity: "error",
    field: "description",
    minLength: 40,
    maxLength: 8000,
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
    key: "cover_image",
    label: "A cover image",
    description: "The first thing a buyer sees in a storefront grid.",
    severity: "error",
    assetTypes: ["cover_image"],
    minCount: 1,
  },
  {
    kind: "asset",
    key: "deliverable",
    label: "A deliverable",
    description: "The file the buyer receives.",
    severity: "error",
    assetTypes: ["deliverable", "archive"],
    minCount: 1,
  },
  {
    kind: "text",
    key: "short_description",
    label: "Short description",
    description: "Used in search results. The listing publishes without it.",
    severity: "warning",
    field: "shortDescription",
    maxLength: 160,
  },
]

export const mockApiAdapter: ChannelAdapter = {
  key: "mock_api",
  name: "Mock Storefront",
  integrationType: "api",
  capabilities: {
    automaticPublish: true,
    automaticUpdate: true,
    // False, and honestly so. Reading metrics and transactions is B5 and B6
    // work; declaring them now would have the UI offer a report that does not
    // exist.
    metrics: false,
    transactions: false,
    digitalFileUpload: true,
    imageUpload: true,
    drafts: true,
  },
  requirements,
  // Nothing is left for a human to do here: this channel takes the file itself.
  manualSteps: [],
  /*
   * A storefront-shaped profile, so the generation path has an api channel to
   * run against without a network. Generic on purpose: this channel is a
   * fixture, and a profile with opinions would be testing the opinions.
   */
  merchandising: {
    promptVersion: "2026-09-07.1",
    audience: "A buyer on a small owned storefront who already knows the brand.",
    voice: "Plain, direct, second person. No hype.",
    structure:
      "Two or three short paragraphs: what it is, what the buyer gets, what it is for. Plain text.",
    fields: {
      title: "The product name and its type.",
      description: "Between 80 and 250 words, from the facts only.",
      shortDescription: "One sentence under 160 characters.",
      seoTitle: "Leave empty.",
      seoDescription: "Leave empty.",
      tags: "Five to ten lowercase tags.",
    },
  },

  buildListing({ product }: AdapterSubject): ChannelListingDraft {
    return {
      title: product.canonical_title ?? product.name,
      description: product.canonical_description,
      shortDescription: product.short_description,
      // A mock channel has no search surface, so it has nothing to override.
      seoTitle: null,
      seoDescription: null,
      price: product.base_price === null ? null : Number(product.base_price),
      currency: product.currency,
      category: product.product_type,
      tags: [],
      metadata: {},
    }
  },

  async publish({ listing }: PublishContext): Promise<PublishResult> {
    return {
      externalListingId: `mock-api-${listing.id}`,
      externalUrl: `https://mock-storefront.test/listings/${listing.id}`,
      // Live immediately, because this channel received the deliverable.
      externalState: "live",
      providerResponse: { ok: true, id: `mock-api-${listing.id}` },
    }
  },

  async update({ listing }: PublishContext): Promise<PublishResult> {
    return {
      externalListingId: listing.external_listing_id ?? `mock-api-${listing.id}`,
      externalUrl: listing.external_url,
      externalState: "live",
      providerResponse: { ok: true, updated: true },
    }
  },
}
