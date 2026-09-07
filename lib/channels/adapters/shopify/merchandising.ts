import type { MerchandisingProfile } from "@/lib/channels/types"

/**
 * How Shopify copy should read.
 *
 * docs/ai-merchandising.md: direct conversion, brand storytelling, SEO, and an
 * owned-customer relationship. A Shopify product page is the creator's own
 * shop, so the reader has already chosen the brand and the copy sells the
 * product rather than the seller. The search-result pair exists here and is
 * worth filling, because the shop competes for the query on its own.
 *
 * Instruction only. Nothing in this text is a fact about any product, and the
 * validator would refuse it if the model treated it as one.
 */
export const shopifyMerchandising: MerchandisingProfile = {
  promptVersion: "2026-09-07.1",
  audience:
    "A buyer on the creator's own storefront. They arrived from search, social or a previous purchase, they already trust the brand, and they are deciding whether this product is the one they need. They are not comparing sellers; they are comparing this product to doing without it.",
  voice:
    "Direct and warm, in the brand's own voice. Second person. Short sentences. Confident without hype: no exclamation marks, no superlatives the facts do not earn, no 'perfect for everyone'. Say what the product is, what it is for, and what the buyer gets.",
  structure:
    "Open with one or two sentences that place the product: what it is and who it is for. Then a short paragraph on what makes it worth buying, drawn from the facts. Then a plain 'What you get' section listing only the included files, formats and counts that appear in the facts. Close with one sentence on use or fit. Plain text paragraphs separated by blank lines; a simple list may use hyphens. No headings, no markdown emphasis, no links, no emoji.",
  fields: {
    title:
      "The product name as a buyer would search for it, with the product type if it is not obvious from the name. No shop name, no promotional words, no trailing punctuation.",
    description:
      "The full product page description as structured above. Between 120 and 350 words. Every number, format, count and compatibility statement must come from the facts.",
    shortDescription:
      "One or two sentences, under 160 characters, that would stand alone in a collection grid or a share card.",
    seoTitle:
      "A search-result title under 70 characters: product name, product type, and one concrete, factual qualifier. Leave empty if the title already serves.",
    seoDescription:
      "A search-result description under 160 characters, written to earn the click: what it is and one reason to want it. Leave empty only if the short description already serves.",
    tags: "Eight to fifteen lowercase tags a shop owner would use to organise a catalogue: the product type, the style words a buyer would search, and the formats from the facts. No duplicates, no hashtags, no tags that restate the title word for word.",
  },
}
