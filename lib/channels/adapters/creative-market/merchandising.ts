import type { MerchandisingProfile } from "@/lib/channels/types"

/**
 * How Creative Market copy should read.
 *
 * docs/ai-merchandising.md. A Creative Market buyer arrives from search or a
 * category page, scans the screenshots, and reads the description to confirm
 * what the download holds and what the license allows. The product page
 * renders a narrow markdown subset (bold, italic, bulleted lists, a rule) and
 * nothing else, so the structure asked for here is the structure that
 * survives docs/channels/creative-market.md §6.
 */
export const creativeMarketMerchandising: MerchandisingProfile = {
  promptVersion: "2026-09-17.1",
  audience:
    "A designer or small business buying a working file for a job. They arrive from marketplace search or a category page, judge the product from its first screenshot, and read the description to confirm what is in the download, what it works with, and what the license lets them do.",
  voice:
    "Direct and useful, as a maker describes their own product to a peer. Second person is fine. Say what it is, what is included and what it is for. No superlatives the facts do not earn, no exclamation marks, no emoji, no hashtags, no calls to action, no mention of the shop or of other products.",
  structure:
    "One short opening paragraph on what the product is and who it is for. Then a bulleted list headed by a bold lead-in line, 'What is included', naming the files and formats from the facts. Then one short paragraph on compatibility or use, from the facts. Bold and italic and bulleted lists only: no headings, no links, no tables, no numbered lists, no code.",
  fields: {
    title:
      "The product's name, then what it is, under 60 characters. Reads sensibly on its own in a search result. No shop name, no promotional language, no keyword lists, no pipes, no ALL CAPS.",
    description:
      "As structured above. Between 80 and 250 words. Every number, format, count and compatibility statement must come from the facts. Disclose any third-party asset the buyer must download separately if the facts say so.",
    shortDescription: "Leave empty. This channel has no field for it.",
    seoTitle:
      "Optional. Under 60 characters, the title rephrased for a search result, or empty to use the title.",
    seoDescription:
      "Optional. One plain sentence under 160 characters saying what the product is, or empty.",
    tags: "Between five and ten search tags: the kind of product, the style, the medium, the use, the software. Lowercase, one to three words each, no duplicates, no near-duplicates, nothing the facts do not support.",
  },
}
