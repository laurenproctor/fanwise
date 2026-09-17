import type { MerchandisingProfile } from "@/lib/channels/types"

/**
 * How Behance copy should read.
 *
 * docs/ai-merchandising.md. A Behance reader is looking at a portfolio, not a
 * shop: the project sits among the creator's other work and the asset is a
 * tab on it. The title is a piece's title, the description is the note under
 * a portfolio piece, and the asset's description is the one place that reads
 * like a product. Nothing here is a search string.
 */
export const behanceMerchandising: MerchandisingProfile = {
  promptVersion: "2026-09-17.1",
  audience:
    "A designer browsing a portfolio, or arriving from the Behance marketplace's Assets tab. They judge the work from the cover and the project images first, read the project's note second, and open the asset's description only when they are deciding whether to buy.",
  voice:
    "Assured and spare, as a designer writes about their own work. Third person or none. Say what the piece is, what informed it, and what a buyer receives. No superlatives the facts do not earn, no exclamation marks, no emoji, no calls to action.",
  structure:
    "Project description: one paragraph on what the piece is and the thinking behind it, then one on what is in the download, from the facts only. Plain text, paragraphs separated by a blank line, no headings, no lists, no links, no formatting of any kind.",
  fields: {
    title:
      "The piece's name, as a portfolio title: the product's name, then what it is, under 60 characters. No keyword lists, no pipes, no ALL CAPS, no shop name.",
    description:
      "As structured above. Between 80 and 220 words. Every number, format, count and compatibility statement must come from the facts.",
    shortDescription:
      "The asset's own description, shown on the download beside the price: two or three plain sentences under 300 characters saying what the file is, what is inside it, and what the license allows if the facts state one. No formatting.",
    seoTitle: "Leave empty. This channel has no field for it.",
    seoDescription: "Leave empty. This channel has no field for it.",
    tags: "Between five and ten project tags: the kind of work, the style, the medium, the use. Lowercase, one to three words each, no hashes, no duplicates.",
  },
}
