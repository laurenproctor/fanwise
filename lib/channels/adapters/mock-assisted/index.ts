import type {
  AdapterSubject,
  ChannelAdapter,
  ChannelListingDraft,
  RequirementSpec,
} from "@/lib/channels/types"

/**
 * A mock channel that behaves like an assisted marketplace.
 *
 * The important thing about this file is what is missing from it. There is no
 * publish method, no update, no unpublish. Fanwise prepares a listing and a
 * human submits it, so there is nothing to call and nothing to confirm, and
 * every status this channel ever carries is self_reported.
 *
 * That absence is the enforcement. A UI that reads capabilities cannot offer
 * publishing here, and a database trigger refuses a verified status on it. Both
 * exist because the alternative, a publish method that quietly does nothing, is
 * how tools in this space lose trust.
 */

const requirements: readonly RequirementSpec[] = [
  {
    kind: "text",
    key: "title",
    label: "Title",
    severity: "error",
    field: "title",
    minLength: 5,
    maxLength: 60,
  },
  {
    kind: "text",
    key: "description",
    label: "Description",
    severity: "error",
    field: "description",
    minLength: 100,
    maxLength: 4000,
  },
  {
    kind: "tags",
    key: "tags",
    label: "Tags",
    description: "Marketplace search runs on these.",
    severity: "error",
    minCount: 3,
    maxCount: 20,
    maxTagLength: 24,
  },
  {
    kind: "number",
    key: "price",
    label: "Price",
    severity: "error",
    field: "price",
    min: 1,
    max: 9999,
  },
  {
    kind: "asset",
    key: "previews",
    label: "Three preview images",
    description: "Assisted channels are judged on the preview grid before anything else.",
    severity: "error",
    assetTypes: ["preview_image", "screenshot"],
    minCount: 3,
  },
  {
    kind: "custom",
    key: "no_contact_details",
    label: "No contact details in the description",
    description: "Most marketplaces reject a listing that routes buyers off-platform.",
    severity: "error",
    evaluate(draft) {
      const text = draft.description ?? ""
      const hasEmail = /[\w.+-]+@[\w-]+\.[\w.]+/.test(text)
      const hasUrl = /https?:\/\//i.test(text)
      if (hasEmail || hasUrl) {
        return {
          satisfied: false,
          message: hasEmail
            ? "The description contains an email address."
            : "The description contains a link.",
        }
      }
      return { satisfied: true }
    },
  },
]

export const mockAssistedAdapter: ChannelAdapter = {
  key: "mock_assisted",
  name: "Mock Marketplace",
  integrationType: "assisted",
  capabilities: {
    // Every one of these is false because Fanwise genuinely cannot do it here.
    automaticPublish: false,
    automaticUpdate: false,
    metrics: false,
    transactions: false,
    digitalFileUpload: false,
    imageUpload: false,
    drafts: false,
  },
  requirements,
  // Everything about this channel is manual, which is what "assisted" means.
  // There is still no manual *step* row: a step tracks work outstanding after a
  // successful publication, and nothing here ever publishes.
  manualSteps: [],

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

  // No publish. No update. No unpublish. Deliberately.
}
