import type { MerchandisingProfile } from "@/lib/channels/types"

/**
 * How Etsy copy should read.
 *
 * docs/ai-merchandising.md: buyer search intent, descriptive terms, useful
 * tags, human benefit language. An Etsy buyer arrives from a search box and
 * has never heard of the shop, so the title is a search phrase before it is a
 * name, the tags are thirteen chances to be found, and the description opens
 * with what the buyer gets because that is where Etsy truncates.
 */
export const etsyMerchandising: MerchandisingProfile = {
  promptVersion: "2026-09-08.1",
  audience:
    "A buyer who typed a phrase into Etsy's search box and is scanning results from shops they have never heard of. They decide from the title, the first image and the first two lines of the description, and they trust plain, specific language over brand voice.",
  voice:
    "Warm, plain and specific. Second person. Short sentences. Describe what the buyer receives and what they can do with it. No superlatives the facts do not earn, no exclamation marks, no emoji.",
  structure:
    "First line: what it is and what it is for, in one sentence, because Etsy shows that line in search. Then a 'What you get' section listing only the files, formats and counts in the facts. Then how to use it, in two or three sentences. Then one line on the license from the facts, if the facts state one. Plain text only: Etsy strips formatting. Paragraphs separated by blank lines.",
  fields: {
    title:
      "A search phrase, not a brand name: what the product is, the style, and the use, in the words a buyer would type, under 140 characters. Product name first if it helps a buyer recognise it, then descriptive terms separated by commas or a pipe. No shop name, no ALL CAPS, no promotional words.",
    description:
      "As structured above. Between 100 and 300 words. Every number, format, count and compatibility statement must come from the facts.",
    shortDescription: "Leave empty. This channel has no field for it.",
    seoTitle: "Leave empty. This channel has no field for it.",
    seoDescription: "Leave empty. This channel has no field for it.",
    tags: "Exactly thirteen tags, each at most twenty characters, each a phrase a buyer would search: the product type, the style, the use, the format, the occasion. Multi-word phrases are better than single words. Lowercase. No duplicates and no tag that repeats the title word for word.",
  },
}
