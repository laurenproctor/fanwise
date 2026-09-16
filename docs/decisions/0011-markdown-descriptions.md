# ADR 0011: Descriptions are Markdown

**Status:** accepted, 13 September 2026, at the founder's request.
**Date:** September 2026
**Supersedes:** the "plain text, no Markdown, no sanitizer" rule in `docs/channels/shopify.md`
§8, `docs/channels/woocommerce.md` §8, `lib/channels/html.ts`, and the public product page's
"paragraphs are the whole of the formatting on offer".

---

## Context

The founder asked for descriptions that keep their paragraphs and formatting on the way to a
channel, and for HTML, Markdown and visual editing of them. Every description until now was
plain text by design: blank lines were paragraphs, and every channel that wanted HTML received
escaped text wrapped in `<p>`. The reasoning was sound for plain text — inventing structure a
creator never wrote is a claim the creator did not make — but it left a creator no way to write
the structure they did mean: a list of included files, a heading, a link to a specimen.

Three things any answer has to respect:

1. **Invariant 1.** The canonical record is never channel-shaped. Storing a storefront's HTML on
   `products` would make it so.
2. **Invariant 5.** The factuality validator runs on every generation. Markup must not become a
   way to hide a claim from it, nor a source of false refusals that teaches people to work
   around it.
3. **Creator input rendered on a Fanwise page and in someone's storefront.** The moment a
   description is markup, it is an injection vector unless something removes what should not be
   there.

## Decision

**Descriptions are stored as Markdown** — `products.canonical_description`,
`channel_listings.description`, and `public_product_pages.description_override`. Short
descriptions, SEO fields and tags stay plain text. Markdown is channel-neutral, is what a person
can type, and existing plain text is already valid Markdown with the same meaning: blank lines
are paragraphs, and single newlines are line breaks (`breaks: true`). No data migration.

**Each consumer asks for the shape it can take** (`lib/text/`):

- `markdownToHtml` renders with `marked` and then sanitizes with `sanitize-html` to an allowlist
  of `p br strong em del s a ul ol li h2 h3 h4 h5 h6 blockquote code pre hr`, links limited to
  `http`, `https` and `mailto`, no attributes beyond `href` and `ol[start]`. `h1` becomes `h2`,
  because the page a description sits in already has one; every level below it is kept as
  written (widened from `h2`–`h4` on 16 September 2026, when the import began composing
  structured descriptions). Script,
  style, iframe, object and template elements lose their contents too. Shopify's
  `descriptionHtml`, WooCommerce's `description`, and the public product page (which adds
  `rel="nofollow noopener noreferrer"`) use it.
- `markdownToPlainText` is what a reader sees as text: paragraphs, list items with a bullet or
  their number, link text followed by its address. Etsy's description uses it.
- `markdownToClaimText` is the same without list markers, and is what the factuality validator
  reads for both the generated description and the FactSheet's description. An ordered list's
  `1.` is structure, not a count; everything else a buyer reads — including a link's address — is
  still checked.

**Readiness counts words, not markup.** A `description` text requirement measures the plain-text
projection, and so does the listing editor's counter.

**The editor has three views over one value** (`components/ui/markdown-editor.tsx`): Visual
(Tiptap, with the same element set as the sanitizer, so nothing formatted there is later
stripped), Markdown, and HTML. HTML typed into the HTML view is read back through the editor's
schema, so an element outside it has nowhere to go and is dropped before it becomes Markdown.

**AI writes Markdown too**, within the channel profile: paragraphs and bullet lists, bold
sparingly on the storefronts, and no headings, links, images or emoji. `RULES_VERSION` moves to
`2026-09-13.1`.

**The import composes a structured description** (16 September 2026): an opening paragraph
or two, then sections under `##` headings taken from what the source covers, `###` where it
has subsections, paragraphs and bullet lists inside them, never a `#`. It is the canonical
description, which a person reviews before it is saved, and it renders as `<h2>`–`<h6>` and
`<p>` on the public page and in every storefront that takes HTML. Channel generations are
unchanged: they are shaped by the channel profile and still carry no headings.

## Consequences

- The sanitizer is now load-bearing security. `tests/unit/markdown.test.ts` and the Shopify
  transform tests pin what it removes; widening the allowlist is a change to this ADR.
- The fingerprint hashes the stored Markdown, which is unchanged for existing text, so no listing
  shows unsent changes because of this.
- A description typed before this with a literal `*`, `#` or `1.` at the start of a line now
  renders as formatting. Accepted: there are no real users yet, and the editor shows it.
- Channels specified but not built inherit the rule: Gumroad takes `markdownToHtml`, Behance and
  Creative Market take the plain-text projection or a restricted Markdown subset when they arrive.
- The import draft form still edits its description as Markdown text rather than in the visual
  editor. It is a review step before the canonical record, where the editor is.
