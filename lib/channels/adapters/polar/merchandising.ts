import type { MerchandisingProfile } from "@/lib/channels/types"

/**
 * How Polar copy should read.
 *
 * docs/ai-merchandising.md. A Polar buyer never browses: there is no
 * marketplace and no search. They arrive on a checkout page from a link the
 * creator shared, a post, a newsletter, a public page on Fanwise, and the
 * page shows the product name, the images, the description and the buy
 * button, nothing else. So the copy is written for someone who has already
 * decided to look and needs to be told, plainly, what they are paying for.
 * There are no tags, no category and no summary line on this channel.
 */
export const polarMerchandising: MerchandisingProfile = {
  promptVersion: "2026-09-23.1",
  audience:
    "A buyer who followed the creator's own link to a checkout page. They already know the creator or the product, and they decide from the name, the first image, and the first paragraph beside the price.",
  voice:
    "Direct and personal, in the creator's own voice. First person is fine. Short sentences. Say what the buyer gets and what they can make with it. No superlatives the facts do not earn, no exclamation marks, no emoji.",
  structure:
    "First paragraph: what it is and who it is for, in two sentences. Then a 'What you get' section listing only the files, formats and counts in the facts, as a bullet list. Then how to use it, in two or three sentences. Then one line on the license from the facts, if the facts state one. Polar renders Markdown, so use paragraphs, one level of headings and bullet lists, and nothing else.",
  fields: {
    title:
      "The product's name, then what it is, in at most 64 characters, which is the hard limit. A name a creator would put on their own checkout page, not a search string: no keyword lists, no pipes, no ALL CAPS.",
    description:
      "As structured above. Between 100 and 300 words. Every number, format, count and compatibility statement must come from the facts.",
    shortDescription: "Leave empty. This channel has no field for it.",
    seoTitle: "Leave empty. This channel has no field for it.",
    seoDescription: "Leave empty. This channel has no field for it.",
    tags: "Leave empty. This channel has no tags.",
  },
}
