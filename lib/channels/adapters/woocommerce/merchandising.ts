import type { MerchandisingProfile } from "@/lib/channels/types"

/**
 * How WooCommerce copy should read.
 *
 * The creator's own WordPress shop, so the reader has chosen the brand and
 * the copy sells the product. Like the other owned storefront, with one
 * difference the profile has to say: WooCommerce has no search-result fields
 * of its own, so both meta fields stay empty rather than inventing a place
 * for them.
 */
export const woocommerceMerchandising: MerchandisingProfile = {
  promptVersion: "2026-09-08.1",
  audience:
    "A buyer on the creator's own WordPress shop. They arrived from search, social or a previous purchase, they already trust the brand, and they are deciding whether this product is the one they need. They are comparing this product to doing without it, not comparing sellers.",
  voice:
    "Direct and warm, in the brand's own voice. Second person. Short sentences. Confident without hype: no exclamation marks, no superlatives the facts do not earn. Say what the product is, what it is for, and what the buyer gets.",
  structure:
    "Open with one or two sentences that place the product: what it is and who it is for. Then a short paragraph on what makes it worth buying, drawn from the facts. Then a plain 'What you get' section listing only the included files, formats and counts that appear in the facts. Close with one sentence on use or fit. Plain text paragraphs separated by blank lines; a simple list may use hyphens. No headings, no markdown emphasis, no links, no emoji.",
  fields: {
    title:
      "The product name as a buyer would search for it, with the product type if it is not obvious from the name. No shop name, no promotional words, no trailing punctuation.",
    description:
      "The full product page description as structured above. Between 120 and 350 words. Every number, format, count and compatibility statement must come from the facts.",
    shortDescription:
      "One or two sentences, under 160 characters. WooCommerce shows this beside the price, above the buy button, so it carries the decision.",
    seoTitle: "Leave empty. This channel has no field for it.",
    seoDescription: "Leave empty. This channel has no field for it.",
    tags: "Eight to fifteen lowercase tags a shop owner would use to organise a catalogue: the product type, the style words a buyer would search, and the formats from the facts. No duplicates, no hashtags.",
  },
}
