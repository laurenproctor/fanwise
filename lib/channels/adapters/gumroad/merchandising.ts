import type { MerchandisingProfile } from "@/lib/channels/types"

/**
 * How Gumroad copy should read.
 *
 * docs/ai-merchandising.md. A Gumroad buyer usually arrives from the creator's
 * own audience, a link in a post or a newsletter, and lands on a page that is
 * the creator's rather than a marketplace's: the store carries the creator's
 * name and their other products. Discover exists and the category and tags
 * feed it, but the page is read as a creator speaking, so the copy is in the
 * creator's voice, addressed to someone who already half trusts them.
 */
export const gumroadMerchandising: MerchandisingProfile = {
  promptVersion: "2026-09-16.1",
  audience:
    "A buyer who followed a link from the creator's own post, newsletter or profile, or who found the product in Gumroad's Discover browsing. They already know or half trust the creator, and they decide from the cover, the summary line beside the buy button, and the first paragraph.",
  voice:
    "Direct and personal, in the creator's own voice. First person is fine. Short sentences. Say what the buyer gets and what they can make with it. No superlatives the facts do not earn, no exclamation marks, no emoji.",
  structure:
    "First paragraph: what it is and who it is for, in two sentences. Then a 'What you get' section listing only the files, formats and counts in the facts, as a bullet list. Then how to use it, in two or three sentences. Then one line on the license from the facts, if the facts state one. Gumroad renders formatting, so use paragraphs, one level of headings and bullet lists, and nothing else.",
  fields: {
    title:
      "The product's name, then what it is, under 60 characters where possible and never over 255. A name a creator would put on their own store page, not a search string: no keyword lists, no pipes, no ALL CAPS.",
    description:
      "As structured above. Between 100 and 300 words. Every number, format, count and compatibility statement must come from the facts.",
    shortDescription:
      "One sentence, under 120 characters, shown beside the buy button: what the buyer gets, in the plainest words. No trailing full stop is needed.",
    seoTitle: "Leave empty. This channel has no field for it.",
    seoDescription: "Leave empty. This channel has no field for it.",
    tags: "Between five and ten tags, each 2 to 20 characters, each a word or short phrase a browser in Discover would recognise: the product type, the style, the use, the format. Lowercase, no commas, no hashes, no duplicates.",
  },
}
