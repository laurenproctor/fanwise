import { describe, expect, it } from "vitest"
import { canonicalValue, resolveDraft, type CanonicalValues } from "@/lib/channels/listings"
import { getAdapter, listAdapters } from "@/lib/channels/registry"
import { sentFingerprint } from "@/lib/publishing/idempotency"
import type { ChannelListingDraft } from "@/lib/channels/types"

/**
 * A listing's title, descriptions and price are the product's until a channel
 * says otherwise. These pin the resolution every reader shares, and the one
 * consequence that matters most: a product edit reaches the channels that
 * inherit it as a change to send, and nowhere else.
 */

const product: CanonicalValues = {
  name: "Aster Grotesk",
  canonical_title: "Aster Grotesk — nine weights",
  canonical_description: "A grotesque in **nine** weights.",
  short_description: "Nine weights.",
  base_price: 48,
  currency: "USD",
}

const empty: ChannelListingDraft = {
  title: null,
  description: null,
  shortDescription: null,
  seoTitle: null,
  seoDescription: null,
  price: null,
  currency: "EUR",
  category: null,
  tags: [],
  metadata: {},
}

describe("an empty listing field is the product's", () => {
  it("resolves every inheritable field from the product, price with its currency", () => {
    const read = resolveDraft(empty, product, getAdapter("shopify"))
    expect(read).toMatchObject({
      title: "Aster Grotesk — nine weights",
      description: "A grotesque in **nine** weights.",
      shortDescription: "Nine weights.",
      price: 48,
      currency: "USD",
    })
  })

  it("falls back to the product's name when it has no canonical title", () => {
    expect(canonicalValue("title", { ...product, canonical_title: null })).toBe("Aster Grotesk")
  })

  it("keeps a customized value, and an overridden price keeps its own currency", () => {
    const read = resolveDraft(
      { ...empty, title: "Etsy search phrase", price: 40, currency: "EUR" },
      product,
      getAdapter("etsy"),
    )
    expect(read.title).toBe("Etsy search phrase")
    expect(read.price).toBe(40)
    expect(read.currency).toBe("EUR")
  })

  it("empties a field the channel does not have, even when the product has one", () => {
    const read = resolveDraft({ ...empty, seoTitle: "stray" }, product, getAdapter("etsy"))
    expect(read.shortDescription).toBeNull()
    expect(read.seoTitle).toBeNull()
  })
})

describe("what a product edit means for each channel", () => {
  const edited: CanonicalValues = { ...product, short_description: "Nine weights, now italic." }

  it("is a change to send on a channel that inherits the edited field", () => {
    const shopify = getAdapter("shopify")
    expect(sentFingerprint(resolveDraft(empty, product, shopify), "")).not.toBe(
      sentFingerprint(resolveDraft(empty, edited, shopify), ""),
    )
  })

  it("is nothing at all on a channel without that field", () => {
    const etsy = getAdapter("etsy")
    expect(sentFingerprint(resolveDraft(empty, product, etsy), "")).toBe(
      sentFingerprint(resolveDraft(empty, edited, etsy), ""),
    )
  })

  it("is nothing on a channel that customized the field", () => {
    const shopify = getAdapter("shopify")
    const own = { ...empty, shortDescription: "Shopify's own words." }
    expect(sentFingerprint(resolveDraft(own, product, shopify), "")).toBe(
      sentFingerprint(resolveDraft(own, edited, shopify), ""),
    )
  })
})

describe("declared fields", () => {
  it("covers every field a channel's own rules read, so no rule judges a field resolved away", () => {
    const channelFields = new Set([
      "title",
      "description",
      "shortDescription",
      "seoTitle",
      "seoDescription",
      "price",
      "category",
      "tags",
    ])
    for (const adapter of listAdapters()) {
      for (const spec of adapter.requirements) {
        const field = (spec as { field?: unknown }).field
        if (typeof field !== "string" || !channelFields.has(field)) continue
        expect(adapter.fields, `${adapter.key} rule ${spec.key}`).toContain(field)
      }
    }
  })
})
