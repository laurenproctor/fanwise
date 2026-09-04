import type {
  AdapterSubject,
  ChannelAdapter,
  ChannelListing,
  ChannelListingDraft,
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
 * Nothing here talks to anything. publish() returns a deterministic fake id.
 * Real publication, with idempotency keys and background jobs, is A5 and A7,
 * and this method is deliberately not wired to either.
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

  async publish(listing: ChannelListing): Promise<PublishResult> {
    return {
      externalListingId: `mock-api-${listing.id}`,
      externalUrl: `https://mock-storefront.test/listings/${listing.id}`,
    }
  },

  async update(listing: ChannelListing): Promise<PublishResult> {
    return {
      externalListingId: listing.external_listing_id ?? `mock-api-${listing.id}`,
      externalUrl: listing.external_url,
    }
  },
}
