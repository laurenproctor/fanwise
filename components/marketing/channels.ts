/**
 * The marketplace spec data behind the Marketplaces page.
 *
 * Illustrative, per design/README.md: `docs/channels/creative-market.md` holds
 * the verified numbers for the one channel that has been researched properly.
 * The channel modes and the pricing are the two things in the mockups that are
 * accurate, and both are stated in `docs/channel-feasibility.md` and
 * `docs/billing.md` respectively.
 *
 * Shopify appears here as the included storefront and is deliberately not
 * $6/mo: one owned storefront carries no channel charge.
 */
export type Shop = {
  name: string
  badge: string
  kind: "storefront" | "marketplace"
  blurb: string
  preview: string
  title: string
  tags: string
  copy: string
  review: string
  handles: string
}

export const SHOPS: Shop[] = [
  {
    name: "Shopify",
    badge: "Storefront · Included",
    kind: "storefront",
    blurb:
      "Your owned store is the center of the system. Fanwise publishes the canonical listing here first, at full fidelity.",
    preview: "Your theme's image sizes",
    title: "255 chars",
    tags: "Unlimited product tags",
    copy: "Full rich text",
    review: "Instant",
    handles:
      "Fanwise keeps your storefront and every marketplace copy in step: change the master, and the store updates with the drafts.",
  },
  {
    name: "Etsy",
    badge: "Marketplace · $6/mo",
    kind: "marketplace",
    blurb:
      "The biggest audience and the fussiest image rules. Etsy rewards complete listings and precise tags.",
    preview: "2000 px shortest side, 4:3",
    title: "140 chars",
    tags: "13 max, 20 chars each",
    copy: "Plain text, no HTML",
    review: "Instant",
    handles:
      "Fanwise crops previews to 4:3, strips formatting from your description, and fits your keywords into Etsy's 13-tag budget.",
  },
  {
    name: "Creative Market",
    badge: "Marketplace · $6/mo",
    kind: "marketplace",
    blurb:
      "A curated design marketplace with its own category tree and a shop-approval step before your first listing.",
    preview: "1160 × 772 px",
    title: "60 chars",
    tags: "Free-form plus category tree",
    copy: "Markdown subset",
    review: "Shop approval, then instant",
    handles:
      "Fanwise renders the 1160 × 772 hero, converts your description to its markdown subset, and maps tags onto the category tree.",
  },
  {
    name: "Envato Market",
    badge: "Marketplace · $6/mo",
    kind: "marketplace",
    blurb:
      "GraphicRiver and friends: strict manual review, short titles, and an HTML description format all their own.",
    preview: "590 px inline, 80 × 80 thumb",
    title: "50 chars",
    tags: "15 max",
    copy: "HTML subset",
    review: "Manual review, days",
    handles:
      "Fanwise trims your title to 50 characters without losing the product name and tracks the review queue so you don't have to.",
  },
  {
    name: "Adobe Stock",
    badge: "Marketplace · $6/mo",
    kind: "marketplace",
    blurb:
      "Templates and assets discovered almost entirely through keywords. No prose, no tags — just 49 chances to be found.",
    preview: "Rendered template preview",
    title: "200 chars",
    tags: "Up to 49 keywords",
    copy: "Keywords only",
    review: "Moderation queue",
    handles:
      "Fanwise converts your description into a ranked keyword set and renders the preview Adobe's moderation expects.",
  },
  {
    name: "MyFonts",
    badge: "Marketplace · $6/mo",
    kind: "marketplace",
    blurb:
      "The type-specific channel: foundry review, specimen images at 2:1, and metadata that lives inside the font files.",
    preview: "5 to 15 PNG at 2:1",
    title: "Family name",
    tags: "Foundry tags",
    copy: "Under 500 words",
    review: "Foundry review, 24h",
    handles:
      "Fanwise generates 2:1 specimens from your previews and keeps the family's style names consistent with the font metadata.",
  },
]
