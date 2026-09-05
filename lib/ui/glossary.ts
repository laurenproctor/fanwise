/**
 * Every word the interface uses that a creator has no reason to already know.
 *
 * The copy lives here rather than beside each icon for two reasons. The same
 * term appears on several surfaces — readiness is on the product page, the
 * channel card and the editor — and three explanations of one word is three
 * chances to describe it differently. And a definition kept next to its
 * siblings is a definition someone will actually reread when the behaviour
 * changes.
 *
 * Rules for what goes in a body:
 *
 * - Say what the thing is, then what it means for the person reading. A
 *   definition that only restates the label is noise with a border around it.
 * - Where a term is easy to mistake for a neighbouring one, say what it is not.
 *   "Readiness is not a quality score" is the whole reason that entry exists.
 * - No provider names. This module sits outside the adapter layer, so channel
 *   behaviour is described generically and the specifics stay in the adapter.
 */

export interface GlossaryEntry {
  /** The term as it is written on screen, so the two never drift apart. */
  label: string
  /** Plain language, two or three sentences, no marketing. */
  body: string
}

export const GLOSSARY = {
  // ---------------------------------------------------------------- product

  canonicalProduct: {
    label: "Product",
    body: "The one record in Fanwise that is the truth about a thing you sell. Every channel listing starts as a copy of it, and editing a listing never edits the product back. Change something everywhere by changing it here and rebuilding the listings.",
  },
  productType: {
    label: "Type",
    body: "What kind of digital product this is. Channels use it to decide which of their rules apply to the listing and where in their catalog it belongs.",
  },
  productStatus: {
    label: "Status",
    body: "Where the product stands inside Fanwise. It says nothing about whether the product is on sale anywhere — a product can be complete here and published nowhere. Per-channel state is on the product's channel cards.",
  },

  // ---------------------------------------------------------------- channels

  channel: {
    label: "Channel",
    body: "Somewhere you sell: a marketplace, or a storefront you own. Fanwise keeps one product and gives each channel its own listing derived from it, because no two channels want the same title, length or category.",
  },
  connection: {
    label: "Connected",
    body: "You have authorized Fanwise to act on your account on this channel. The credentials are encrypted and only ever read on the server; they are never sent to your browser.",
  },
  automaticChannel: {
    label: "Automatic",
    body: "This channel has an API Fanwise can write to, so Fanwise creates and updates the listing for you and reads back what the channel says happened.",
  },
  assistedChannel: {
    label: "Assisted",
    body: "This channel has no API to publish through. Fanwise writes the listing and checks it against the channel's rules, then you submit it on the channel yourself and mark it done here. Nothing about it is automatic, and Fanwise will not pretend otherwise.",
  },

  // ------------------------------------------------------------ capabilities

  automaticPublish: {
    label: "Publish automatically",
    body: "Fanwise can create the listing on this channel for you. Without it, you create the listing yourself and Fanwise only prepares and checks the content.",
  },
  automaticUpdate: {
    label: "Update automatically",
    body: "Once the listing exists, Fanwise can send later edits to it. Without it, edits you make here stay in Fanwise until you copy them across by hand.",
  },
  metrics: {
    label: "Read metrics",
    body: "Fanwise can read performance figures — views and similar — back from this channel. Without it, Fanwise has no idea how the listing is doing there.",
  },
  transactions: {
    label: "Read sales",
    body: "Fanwise can read completed orders back from this channel, so sales appear here without you exporting anything.",
  },
  digitalFileUpload: {
    label: "Upload the deliverable",
    body: "Fanwise can send the actual file your buyer downloads. Where a channel will not accept that file over its API, Fanwise gives you a step to attach it by hand instead, and holds the listing back until you have.",
  },
  imageUpload: {
    label: "Upload images",
    body: "Fanwise can send cover and preview images along with the listing. Without it, you add the images on the channel yourself.",
  },
  drafts: {
    label: "Save a draft first",
    body: "The listing can exist on the channel without being on sale, so you can look at it there before anyone can buy it. Without it, creating the listing puts it on sale straight away.",
  },

  // ------------------------------------------------------------- readiness

  readiness: {
    label: "Readiness",
    body: "How many of this channel's blocking rules the listing satisfies right now, recomputed as you type. It counts rules, not quality: 100% means nothing is left that this channel would reject, not that the listing is any good. Recommendations are excluded, because they never block anything.",
  },
  optionalRequirement: {
    label: "Optional",
    body: "A recommendation from this channel rather than a rule. Leaving it unsatisfied will not stop the listing being published and does not count against readiness.",
  },

  // ---------------------------------------------------------------- statuses

  unpublished: {
    label: "Not published",
    body: "Nothing exists on the channel yet. The listing is written and lives only in Fanwise.",
  },
  publishing: {
    label: "Publishing",
    body: "Fanwise has queued the publication and is waiting for the channel to confirm it. This runs in the background, so you can leave the page and come back.",
  },
  published_not_live: {
    label: "Published, not live",
    body: "The listing exists on the channel but nobody can buy it yet. Something is still outstanding — usually a step only you can do, like attaching the download file. Fanwise deliberately will not call this live, because it is not.",
  },
  live: {
    label: "Live",
    body: "The listing is on the channel and available to buy. On a channel Fanwise cannot query, this is what you told it, not something it confirmed.",
  },
  failed: {
    label: "Failed",
    body: "The last publish attempt did not finish. The reason is shown on the listing. Trying again is safe: Fanwise records what it already sent, so a retry will not create a second copy on the channel.",
  },

  // ----------------------------------------------------------------- listing

  listingTitle: {
    label: "Title",
    body: "The title buyers see on this channel, and this channel only. It starts as a copy of the product's title and is yours to change, since channels differ on length and on what reads well. Use canonical puts the product's title back, and saves immediately rather than waiting for Save listing.",
  },
  listingDescription: {
    label: "Description",
    body: "The full description for this channel alone. Editing it here changes nothing on any other channel and nothing on the product. Use canonical replaces it with the product's description, and saves immediately rather than waiting for Save listing.",
  },
  listingShortDescription: {
    label: "Short description",
    body: "A one- or two-line summary. Some channels show it in search results or on a card and some ignore it entirely. Use canonical replaces it with the product's short description, and saves immediately rather than waiting for Save listing.",
  },
  listingPrice: {
    label: "Price",
    body: "What this channel sells at. Price is per channel, so you can charge differently in different places — a marketplace that takes a cut is the usual reason. Use canonical puts the product's base price and currency back, and saves immediately rather than waiting for Save listing.",
  },
  listingCurrency: {
    label: "Currency",
    body: "The three-letter code the price is in, such as USD or EUR. Some channels can only sell in the currency the connected account was set up for; where that is true, readiness will say so rather than letting the publish fail.",
  },
  listingCategory: {
    label: "Category",
    body: "Where the listing sits in this channel's own catalog. Where the channel publishes a fixed list this is a menu, and where it does not, type the channel's own wording — Fanwise cannot check a value the channel keeps to itself.",
  },
  listingTags: {
    label: "Tags",
    body: "The keywords this channel uses to surface the listing in search. Each channel sets its own limits on how many you may use and how long each may be, and the counter shows this channel's.",
  },

  // --------------------------------------------------------------- workspace

  workspaceAddress: {
    label: "Address",
    body: "The path this workspace lives at. Everything underneath it belongs to this workspace, and no other workspace can read any of it.",
  },
  workspaceRole: {
    label: "Your role",
    body: "What you are allowed to do in this workspace. Every workspace has exactly one owner, who can do everything; inviting other people is not part of the first version.",
  },
} as const satisfies Record<string, GlossaryEntry>

export type GlossaryTerm = keyof typeof GLOSSARY
