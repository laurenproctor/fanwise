# Channel spec: Adobe Stock

The assisted channel with a sanctioned bulk pipeline and no price to set, which is the case
`docs/channel-feasibility.md` made for it as a B4 candidate under decision 14 ("V2, highest
leverage"). Written on 16 September 2026 against Adobe's Stock Contributor help center:
*CSV requirements*, *Create a CSV file*, *Upload a CSV file* (all 11 June 2026), *Content upload
guidelines* (11 June 2026), *Account and submission guidelines* (31 July 2026), *Content
moderation* (18 August 2026), *Illustration submission requirements* (11 June 2026), *Photo and
illustration requirements* (17 July 2024), *Vector requirements* (1 November 2024), *Single
vector icons and icon sheets*, *PNG files with transparency*, *Generative AI requirements*
(11 June 2026), *Design template requirements* (29 January 2026), *Titles and keywords*,
*Choose the right category* (13 September 2021), *Upload your content* (30 May 2024), *Royalty
details* (9 April 2026), *Get paid*, the *Adobe Stock Contributor Agreement Additional Terms*
(5 June 2018, still the current version linked from the portal), and Adobe's May 2025
announcement of submission limits. Not built. Items marked **[verify]** could not be settled
from those pages and need a logged-in look at the Contributor Portal, which needs a
contributor account: see §1.

`docs/channel-feasibility.md` carries the short assessment. Read it first for why the channel
is assisted and why the last click stays human: there is no Contributor API (the Adobe Stock
API is the buyer-side search and licensing API), the pipeline Adobe does sanction is SFTP plus a
CSV, and an Adobe Community Expert's statement that "automated submission is not foreseen, and
is not allowed" is unconfirmed against the Contributor Terms themselves. Fanwise never holds a
Contributor Portal credential in v1 and never touches its pages. Whether Fanwise should ever
hold the SFTP credential is §12, and it is a decision to register, not one this spec makes.

---

## 1. Why this channel, and what it waits on

- **It is a different shape from every other channel, and that is the point.** Every channel
  so far sells a *product*: one page, one price, one file the buyer downloads. Adobe Stock
  licenses *assets*: one file each, with its own title, keywords and category, priced by
  Adobe, paid as a royalty. A Fanwise product that is a set of forty EPS illustrations is
  forty Adobe Stock assets, and the zip the creator sells everywhere else is never uploaded.
  The canonical product stays exactly what it is; the adapter unpacks it. If the
  canonical-product thesis survives a channel where the product is not the unit, it holds.
- **The metadata burden is heavy, exact, and per file.** Filenames at most 30 characters that
  must match the CSV byte for byte. Titles at most 70 characters with no commas. Five to
  forty-nine keywords in order of importance, in one language, with a banned-word list that
  gets an account terminated. A category by number. Two checkboxes for generative AI. One
  slip in a 200-row CSV and 200 assets sit without metadata. This is the list of things a
  creator gets wrong on the first try and Fanwise can get right deterministically.
- **The file rules are checkable from pixels and bytes.** JPEG between 4 and 100 megapixels,
  sRGB, under 45 MB. PNG with a transparent background. Vectors as AI, EPS or SVG in RGB under
  45 MB with a 15 megapixel artboard. Icons at least 500 pixels with transparent negative
  space. Fanwise's finalize job already reads dimensions and formats; the rest is one or two
  more measurements (§9).
- **Adobe offers the pipeline.** Files go up in bulk (portal drag-and-drop with "no data
  limits", or SFTP for qualified accounts), and one CSV of up to 5,000 rows applies title,
  keywords, category and releases to all of them in one action from the portal's New tab.
  The creator's remaining work is: upload the files, upload the CSV, tick the per-asset
  checkboxes the CSV cannot carry, select all, Submit. No other assisted channel gets that
  close to one click without Fanwise touching the marketplace.
- **The review is the test.** Every asset is moderated before it is licensable, against
  technical quality, IP compliance, commercial value, metadata quality and similarity. A batch
  Fanwise prepared that is approved without a refusal for a reason Fanwise could have checked
  is the composed-listing hypothesis of `docs/channels/creative-market.md` §2 with a stricter
  judge than the creator.
- **The money is real, and small per unit.** Adobe pays 33% of the net price per licensed
  photo, vector or illustration (35% for video), with a floor of $0.33 per standard asset
  under large subscriptions. A stock portfolio earns by volume and by being found, which is
  what keywords are for, and why this channel's merchandising profile is keywords and nothing
  else.

**What it waits on.** Four things, one of them code.

1. **A contributor account.** Free, no application, no review: an Adobe ID, age 18 or over,
   the Contributor Agreement accepted, a tax form (W-9 or W-8) and a payout method (PayPal,
   Payoneer or Skrill). This is cheaper than decision 3 (Creative Market), decision 26
   (Behance) or the MyFonts foundry application: the founder can open one today and settle
   §13 from inside it. As with every assisted channel, Fanwise never asks a creator for their
   login; the §13 answers come from the founder's own account or an alpha creator reading
   their screen. Register it in `docs/decisions/0002` beside 3, 25 and 26.
2. **The design templates invitation, for templates only.** Photos, illustrations, vectors,
   PNGs and icons go through the portal on any account. Design templates (`.psdt`, `.ait`,
   `.indt`) are an invitation-only program with an application form and a separate vetting
   step. The template package is specified here (§7) because it is exactly the deterministic
   work Fanwise is for, but a template product is not offered to this channel until the
   connection says the account is in the program.
3. **A8.** The handoff machinery (the package build, the handoff screen, mark submitted, URL
   capture, the `self_reported` discipline) is A8's to build and this channel reuses every
   piece, plus the in-review state MyFonts also needs (§11) and one thing new to both: outcomes
   recorded per asset rather than per listing.
4. **Decision 14.** `docs/channels/myfonts.md` answers the MyFonts half; this spec answers the
   Adobe Stock half. The two can now be compared on evidence: MyFonts consumes the font
   workspace's facts and serves the type designer; Adobe Stock consumes the raster and vector
   product types and serves the illustrator, icon and pattern designer. Which creator Gate A's
   alpha turns out to be is the deciding fact, as decision 14 says.

**What it does not wait on.** B2a's creators, Behance, or anything Etsy. An illustrator with a
folder of EPS files is a different person from a Creative Market template seller, and this
channel's exit can run with one of them.

---

## 2. What the step proves

A creator carries one real product, a set of raster or vector files, through the handoff: the
asset set and its CSV are built in Fanwise, uploaded to the Contributor Portal, the CSV is
applied with every row matched, the batch is submitted, and moderation approves it. The
contributor portfolio URL and each approved asset's URL are captured. Every row reads
`status_source = self_reported`. No surface anywhere offers Publish for this channel.

Measures, in the spirit of `docs/channels/creative-market.md` §12:

| Metric | Target |
|---|---|
| Time from opening the handoff to clicking Submit in the portal, for a batch of up to 40 assets | Under 20 minutes |
| CSV rows the portal failed to match to an uploaded file | 0 |
| Per-asset titles or keyword lists the creator materially rewrote before submitting | Fewer than 1 in 5 |
| Assets refused for a reason Fanwise could have checked (format, size, resolution, filename, a banned word) | 0 |
| Assets refused for a reason Fanwise cannot check (quality, similarity, commercial value) | Recorded, not scored |

The fourth row is the one that matters. A refusal for "file too small" or "trademark in
keywords" is a rule §9 is missing. A refusal for "similar content already exists" is the
ceiling of assisted preparation and worth knowing.

---

## 3. Adapter definition

```ts
export const adobeStock: ChannelAdapter = {
  key: "adobe_stock",
  name: "Adobe Stock",
  integrationType: "assisted",
  // No description: an Adobe Stock asset has a title and keywords and nothing
  // else. No price: Adobe sets prices and pays a royalty. No short description,
  // no search-engine fields: the portal has no place for them. The listing's
  // title, tags and category are the batch defaults every asset derives from, §4.
  fields: ["title", "category", "tags"],
  capabilities: {
    automaticPublish: false,   // the provider cannot: no Contributor API; submission is a portal click
    automaticUpdate: false,    // same; edits are portal-only and refused while an asset is in moderation
    metrics: false,            // the provider cannot: the Insights page is a page, not an API
    transactions: false,       // the provider cannot by API; whether Insights exports a file is §13
    digitalFileUpload: false,  // Fanwise will not, in v1: the files are the submission, and SFTP is §12
    imageUpload: false,        // the provider cannot; there are no preview images, the asset is the image
    drafts: true,              // uploaded files wait in the New tab, unsubmitted, until the creator submits
  },
  requirements,                // §9, data where the kinds allow it
  manualSteps: [],             // a manual step tracks work after a publish; nothing here publishes
  merchandising,               // §6
  buildListing,
  // no publish, update, unpublish, activate, oauth
}
```

Every `false` but one is the permanent kind `docs/channel-adapters.md` distinguishes: the
provider cannot. `digitalFileUpload` is the other kind, and the comment says so: SFTP exists,
qualified accounts have it, and Fanwise chooses not to hold the credential in v1. If §12's
decision goes the other way, that flag and a background job are the change, not a redesign.

There is no `oauth` member, so Connect writes a row and starts no flow. The account hint is
the **contributor portfolio URL or contributor ID**, parsed against
`stock.adobe.com/contributor/{id}/{name}` **[verify]** the URL shape, and stored as
`external_account_id` (the numeric ID) with the display name alongside. Adobe allows one
contributor account per person without an exception request, so one Adobe ID is one
connection. No credential of any kind is held.

Two connection-level facts, set by the creator on the Channels page and stored in
`channel_connections.metadata`, because they are facts about the account and not about any
listing:

- `sftpQualified`: whether the portal shows the "Learn more" link under the upload target,
  which is how Adobe reveals SFTP eligibility. Adobe does not publish the criteria. Changes
  only the wording of the upload step in §10.
- `designTemplatesInvited`: whether the account has been accepted into the design templates
  program. Gates template products, §7.

Seed: `('adobe_stock', 'Adobe Stock', 'assisted', 'available', true)` in a migration named
`<timestamp>_adobe_stock_channel.sql`. `billable` is true: it is an external marketplace, and
decision 16 (assisted versus automatic pricing) decides the price, not the row. Decision 16
gets its sharpest case here, §12.

---

## 4. The asset and the batch

**Adobe Stock's unit is the asset: one file, one title, one keyword list, one category, one
moderation decision, one URL.** There is no product page, no bundle, no price the contributor
sets. A customer licenses one asset at a time from a plan Adobe prices.

**Fanwise's unit is the product.** One canonical product, one listing per channel connection,
`(product_id, channel_connection_id)` unique. That rule does not bend for this channel.

So: **one listing is one batch.** The batch is the set of assets the product unpacks into
(§7), the CSV that names them (§8), and the per-asset outcomes moderation returns (§11). The
listing's own columns hold the **batch defaults**:

- `title`: the batch phrase, the product-level words every asset title is built from
  ("Botanical line art", "Flat business icons"). At most 50 characters, so a per-asset detail
  fits inside the 70-character asset title.
- `tags`: the shared keywords, in order of importance, that every asset in the batch carries.
- `category`: the batch category by number (§5), or empty to let Adobe's own suggestion
  stand on each asset.

`channel_listings.metadata.assets[]` holds one row per asset, derived from the defaults and
editable in the handoff:

```ts
{
  assetId: string            // product_assets.id of the source, or of the derivative built from it
  filename: string           // the name uploaded and written in the CSV, §7
  contentType: "photo" | "illustration" | "vector" | "png"
  title: string              // at most 70 characters, no commas
  keywords: string[]         // 5 to 49, ordered
  categoryNumber: number | null
  icon: "single" | "sheet" | null
  generativeAi: boolean      // from the product's disclosure, decision 24; never composed
  fictionalPeopleProperty: boolean
  releases: string[]         // release filenames; empty in v1, §5
  review?: { state: "submitted" | "approved" | "refused"; at: string; reason?: string; externalId?: string; url?: string }
}
```

What derives from what, and who may change it:

- **Per-asset title** = a per-asset phrase plus the batch phrase, composed from the asset's
  own recorded facts (its filename stem, its alt text, its position in the set) and the
  product's FactSheet. Nothing else: the model never sees the pixels, and a title that
  describes what is in an image it has not seen is a factual claim absent from the FactSheet,
  which invariant 5 forbids. For a set whose files are named well ("shopping-cart.svg",
  "fern-frond-02.eps"), this is enough. For a set whose files are "IMG_4471.jpg", it is not,
  and the handoff says so at the asset rather than inventing a subject. The creator edits per
  asset in the handoff, or lets Adobe's own suggestion stand by clearing the title (§8).
- **Per-asset keywords** = the asset's own words first, then the batch keywords, deduplicated,
  capped at 49. Adobe weights the first ten, so the asset-specific words lead.
- **Category** is the batch category unless the creator sets one on the asset.
- **The generative AI flag** is the product's disclosure, on every asset, always. It is a fact
  about the product (decision 24), so it is never per asset and never composed.

Adobe's moderation reads near-identical titles and keyword lists across many files as spam
("long, non-descriptive, repetitive, or irrelevant titles and keywords can be perceived as
spam"), and multiple versions from one generative prompt are treated as spam outright. The
per-asset phrase is what keeps a forty-row CSV from reading as forty copies of one row, and
§9 warns when it fails to.

---

## 5. Canonical product to asset field map

Portal fields, and where each answer comes from. Column names in the CSV are §8.

| Contributor Portal field | Source | Transform | Notes |
|---|---|---|---|
| Content type (Photos, Illustrations, Vectors) | `product.product_type` and each file's format | Mapping table, §7 | The portal infers it from the file; JPEG is ambiguous between photo and illustration and the creator confirms once per batch |
| Files | `deliverable`, `source_file` and `archive` assets, unpacked | Asset set, §7 | The zip is never uploaded; its contents are |
| Filename | derived | `{slug}-{nn}.{ext}`, §7 | **At most 30 characters including the extension**, ASCII, no spaces, unique in the batch, and identical in the CSV, case included |
| Title | `channel_listings.title` plus per-asset facts | AI phrase per asset, §6 | **At most 70 characters** in the CSV (the portal itself allows 200 **[verify]**), no commas, not a sentence, not a keyword list |
| Keywords | `channel_listings.tags` plus per-asset facts | Ordered, deduplicated, 5 to 49, §6 | The CSV column allows 50 and the titles page says 49; Fanwise emits at most 49 |
| Language ("I'm writing title & keywords in") | fixed | English | The dropdown resets to the OS language every session; a mismatch means the content is never surfaced in search. The handoff says to check it |
| Category | `channel_listings.category` | Number 1 to 21, table below | Optional. Left out of the CSV when empty, so Adobe's suggestion on upload stands |
| Created using generative AI tools | `products` AI disclosure, decision 24 | Pass through | **Portal-only checkbox, not a CSV column.** Required for all content created with generative AI software. Never composed |
| People and Property are fictional | derived | Checked when the disclosure is yes and the product's facts say people or property appear **[verify]** the exact wording | Portal-only checkbox |
| Single icon / Icon sheet | `product_type = icon`, `metadata.itemCount` | `single` for one glyph per file, `sheet` for many | Portal-only checkbox on AI and SVG uploads. Only glyphs, symbols and simple shapes; not collage elements or text assets |
| Releases | nothing in v1 | | Model and property releases as JPEG, matched by filename. Not modelled; §9 warns when the product's facts suggest one is needed |
| Description | **nothing** | | There is no description field. `docs/ai-merchandising.md` already says so |
| Price | **nothing** | | Adobe prices the plan and pays a royalty, §12. `products.base_price` is not sent and the handoff says so in words |
| Short description, SEO fields, license text, version, support URL | **nothing** | | No field on the form |

**Categories by number**, from *Choose the right category*, in the order Adobe lists them.
The portal shows names; the CSV takes the number. **[verify]** that the portal's numbering
matches this order, which the page calls "categories by number" without printing the numbers.

| # | Category | # | Category | # | Category |
|---|---|---|---|---|---|
| 1 | Animals | 8 | Graphic Resources | 15 | Culture and Religion |
| 2 | Buildings and Architecture | 9 | Hobbies and Leisure | 16 | Science |
| 3 | Business | 10 | Industry | 17 | Social Issues |
| 4 | Drinks | 11 | Landscape | 18 | Sports |
| 5 | The Environment | 12 | Lifestyle | 19 | Technology |
| 6 | States of Mind | 13 | People | 20 | Transport |
| 7 | Food | 14 | Plants and Flowers | 21 | Travel |

Default by product type, offered and never forced: `icon`, `graphic`, `brush` → 8 Graphic
Resources ("backgrounds, textures, and symbols"). `illustration` and `photo` → no default;
the subject decides and Fanwise does not know it. The mapping lives in the adapter, never in
the product enum, per `docs/data-model.md`.

Every `metadata.assets[]` value and every batch default lives on `channel_listings`, never on
`products`. A 70-character title with no commas is an Adobe Stock fact about this listing; the
product keeps its own name.

---

## 6. Title and keyword transform

This channel has no description, so the merchandising profile is a title rule and a keyword
rule, and both are short. Adobe's own guidance, and what Fanwise does with each line:

**Titles.** Short, factual, a phrase that "sounds natural when spoken", not a sentence and not
a list of keywords. At most 70 characters "to help customers find your content via web search
results", and the CSV enforces 70 as a hard limit. No commas or special characters in the CSV
column. Titles are searchable and become part of the asset's URL. Adobe suggests up to three
English titles per file from the pixels unless the file already carries one; Fanwise's title
wins when the CSV row has one, and an empty title cell lets Adobe's stand (§8).

**Keywords.** Order is "the most critical thing you can do": the first ten are weighted, and
the title's words belong among them. Five to forty-nine. Descriptors separate from subjects
("white", "fluffy", "pup" as three keywords, not one), except a proper compound ("Arctic
Fox"). General and specific levels together ("animal", "mammal", "Arctic Fox"). Conceptual
words that describe mood or theme. The number of people, or "nobody". Setting and viewpoint
where they apply. One language, matching the dropdown. Adobe's older tutorial calls fifteen
to twenty-five "a good rule of thumb", and Fanwise's house range is 15 to 30.

**Banned in titles, keywords and generative prompts**, and the reason each is a rule in §9
rather than guidance: Adobe says violations "may result in the removal of content or the
termination of the account".

- Names of artists (single-name artists included), real people, or fictional characters.
- Creative works still in copyright: a film, franchise, comic, artwork, design or building.
- "In the style of", "inspired by", "influenced by", "in the tradition of", "drawing on".
- Companies, brands, products, trademarks ("Porsche", "iPad").
- Camera and file specifications ("Nikon", "4K", "12MP", a file size).
- Government agencies; anything implying an actual newsworthy event.
- Demeaning or derogatory language about people, cultures or beliefs.
- Content-type words as keywords ("vector", "illustration", "video"). The vector page bans
  them in titles too; the titles page's own example title begins "Illustration of", so the
  title case is a warning and **[verify]**.

The FactSheet is the only source of nouns, as everywhere. The named-artist and named-work
rules are the ones a model most easily breaks by association, so §9 checks a denylist
deterministically as a backstop to the factuality validator, and the validator remains the
primary guard.

```ts
merchandising: {
  promptVersion: "2026-09-16.1",
  audience: "A designer or marketer searching a stock library by keyword, who will license one asset from a plan and never read a product page.",
  voice: "Plain, literal, nominal. Phrases, not sentences. Every word a buyer might type.",
  structure: "One title phrase per asset, under 70 characters, no commas. Then keywords in order of importance: the asset's own subject first, then the batch's shared words, then concept and setting. No description exists on this channel.",
  fields: {
    title: "A batch phrase of at most 50 characters naming what the set is, in words a buyer searches. No brand, no artist, no shop name, no sentence, no comma.",
    description: "Leave empty. Adobe Stock has no description field.",
    shortDescription: "Leave empty.",
    seoTitle: "Leave empty.",
    seoDescription: "Leave empty.",
    tags: "15 to 30 shared keywords, ordered by importance, one concept each, lower case except proper nouns. Include every word of the title. Subject, then style, then use, then concept. Never a brand, an artist, a character, a creative work, a camera or a file specification, or the words vector, illustration or photo.",
  },
}
```

Per-asset composition is a second, smaller call per asset (or one structured call per batch)
that receives the profile, the FactSheet, and that asset's own facts: filename stem, alt text,
index in the set, dimensions, format. It returns the per-asset phrase and the asset-specific
keywords that lead the list. This is new to `lib/ai`: today a generation is per listing, and
`ai_generations` allows one in flight per listing. A per-asset section on the FactSheet and a
generation row per asset (or one row carrying the batch) is the change, sized at B4.

---

## 7. Files

This channel has no package and no preview images. What Fanwise emits is an **asset set**:
the product's files, individually, each meeting Adobe's spec for its kind, renamed to survive
the CSV. The zip is never uploaded; Adobe rejects vectors in zip folders and has no notion of
a bundle.

**Which product types map, and to what.**

| Product type | Adobe content type | Files taken | Files left out |
|---|---|---|---|
| `illustration` | Illustrations (JPEG), or Vectors (AI, EPS, SVG) | Every JPEG, AI, EPS, SVG among `deliverable`, `source_file`, `archive` contents | PSD, PDF, TIFF, web formats |
| `graphic` | Vectors, or PNG with transparency, or Illustrations | As above, plus PNG files that carry an alpha channel | Opaque PNG (Adobe: "Background: None"), and any file duplicated as both PNG and JPEG |
| `icon` | Vectors, tagged single icon or icon sheet | SVG and AI first; EPS accepted | PNG icons **[verify]** whether PNG icons are tagged as icons at all |
| `photo` | Photos (JPEG) | Every JPEG | RAW, TIFF, PSD |
| `template`, `mockup` | Design templates (`.psdt`, `.ait`, `.indt`) | The template package below, **only when `designTemplatesInvited`** | Everything else; a mockup that is a PSD rather than a PSDT is not a template file |
| `brush` | Not accepted as a brush; a flattened texture or pattern set may go as PNG or JPEG under Graphic Resources | Rasters only, at the creator's choice | ABR and other brush formats |
| `font` | **Not accepted.** Adobe Stock has no font category; type is licensed through Adobe Fonts, a separate program this channel is not | Nothing | Everything; §9 blocks the product |
| `three_d` | Premium and 3D collections, invitation-only, formats unpublished **[verify]** | Nothing in v1 | Everything |
| `theme`, `other` | Not accepted | Nothing | Everything |

**Per-kind specs, from Adobe's pages, every one checkable without the portal:**

| Kind | Format | Resolution | Size | Color | Other |
|---|---|---|---|---|---|
| Photo, Illustration | JPEG | 4 MP minimum (Adobe's example: 1,600 × 2,400), 100 MP maximum; scanned or hand-drawn work at 300 ppi or more | 45 MB maximum | sRGB | No watermark, timestamp, border, frame or text; no black-and-white variant of a color file; not enlarged |
| PNG with transparency | PNG | 4 MP to 100 MP | 45 MB maximum | sRGB | Background none; cropped to the object; no checkered or colored background to indicate transparency; never the same file as both PNG and JPEG |
| Vector | AI, EPS or SVG | Artboard 15 MP recommended minimum, 65 MP maximum; artboard offset (0,0) | 45 MB maximum | Document mode RGB | One artboard, art inside it; no raster images embedded; text minimized and outlined; strokes outlined; layers labelled, unlocked, none hidden or empty; no signature |
| Icon | SVG for single icons and small sheets, AI for large sheets | Single icon 500 to 4,000 px; sheet 1,000 to 4,000 px with 5 px around each icon | as vector | as vector | Transparent background and negative space; each icon a single merged or compound shape; no marketing or descriptive text on the sheet |

Adobe's vector sizing table is guidance rather than a rule, and the handoff shows the row that
matches the product: design elements and sets 1,000 to 4,800 px; scenes 1,200 to 4,800; small
print layouts 1,000 to 3,600; large print layouts 2,400 to 4,800; small digital designs 1,000
to 3,600; large digital designs 1,200 to 7,200. EPS files should either exceed 15 MP or be
exported with the "High Resolution" transparency preset so the preview Adobe renders is sharp.

**Variations.** Up to three meaningful variations of a vector; color-only, stroke-only,
flipped or re-shadowed variants are refused as similar content, and a run of them is spam.
Fanwise cannot judge similarity from bytes and does not try; §9 warns when a set has more
than three files whose names differ only by a color word or a numeric suffix.

**Filenames.** `{slug}-{nn}.{ext}` where `slug` is the product slug cut to 20 ASCII lower-case
characters, `nn` is a zero-padded index in the batch, and the extension is the file's own
lower-cased. Worst case `20 + 1 + 3 + 1 + 4 = 29` characters, under the CSV's 30. The index
order is the product's asset `sort_order`, cover first. The creator never renames a file
after the build; the CSV depends on the name, and Adobe says even a case difference "prevents
metadata from connecting to assets".

**One transform, and otherwise pass-through.** A raster that fails only on profile, size or
format gets a derivative: re-encoded as sRGB JPEG at quality 92, downscaled to 100 MP if
above it, re-encoded lower if still above 45 MB. A PNG keeps its alpha and is never
re-encoded to JPEG. A vector is never rewritten: a failing vector is reported, not repaired.
The derivative is a `product_assets` row with `derived_from` set, keyed on source checksum
plus spec hash like every derivative.

**Transport is one zip, named `{product-slug}-adobe-stock-files.zip`**, plus the CSV beside
it (§8). The zip is a convenience of delivery for a forty-file set, and the handoff says in the
same line to unzip it and upload the files, never the zip. Documentation, license and README
assets on the product are not sent: there is no field for them.

**Design templates, when invited.** One template becomes one zip with exactly three files and
nothing else:

- The template file: `.psdt`, `.ait` or `.indt`, under 500 MB. Print templates CMYK at 300
  ppi; screen templates RGB at 72 ppi. Every font from Adobe Fonts and none from the Adobe
  Font Marketplace, hidden layers included. Text editable unless it is a design element.
  Placeholder text as lorem ipsum and generic names ("Your Company", "555-555-5555",
  "You@Example.com", "@Username"). Years written 20XX. No brand names, Adobe's included, in
  content or layer names. Only self-created assets embedded: no licensed stock, no CC0, no
  public domain.
- `Thumbnail.jpg`: exactly 2,048 × 1,424, RGB, at least 72 ppi.
- `Preview1.jpg`: 2,048 wide by 1,536 to 6,144 tall, RGB, at least 72 ppi. Adobe Stock
  images may appear in the thumbnail and preview to show use, never in the template.

Fanwise can build the two JPEGs from the product's cover and preview images (a new derivative
spec, 2,048 × 1,424, and a tall 2,048-wide one), rename the template file, and check its
extension, size and the JPEG dimensions. Font sourcing, CMYK mode, layer names and editable
text are inside the document and are shown as info rules, not checked, in v1. Refusal reasons
Adobe lists: technical (nested Smart Objects, overset text, linked-file errors), fonts not
from Adobe Fonts, too similar, thumbnail or preview mismatch or marketing text, IP in text or
assets. Support for the program is `template-contributor-support@adobe.com`.

---

## 8. The CSV

The one artefact that makes this channel bulk rather than forty forms. Adobe's rules, from
the three CSV pages:

| Rule | Value |
|---|---|
| Format | `.csv`, comma-separated, UTF-8. `.xls` and `.xlsx` refused |
| Header row | Exactly the official template's headers, untranslated, unrenamed |
| Rows | One per uploaded file. **5,000 maximum** per file |
| Size | **1 MB maximum** |
| File name | No spaces; Adobe suggests `Name_Date.csv` |
| Where it is applied | Uploaded Files → New tab → Upload CSV → Choose CSV file → Refresh. The same batch can take a corrected CSV again until the row limit |
| `Filename` | Required. Exact uploaded name with extension, case-sensitive, **30 characters maximum** |
| `Title` | Required column. **70 characters maximum**, plain text, no commas or special characters |
| `Keywords` | Required column. Comma-separated inside one quoted cell, in order of importance, **50 maximum** (Fanwise writes 49) |
| `Category` | Optional. The number, 1 to 21 |
| `Releases` | Optional. Exact release filename, JPEG, 30 characters maximum; the most recent upload wins on a duplicate name |

Fanwise writes: `Filename,Title,Keywords,Category` when a batch category or any per-asset
category is set, and `Filename,Title,Keywords` otherwise, so an absent category leaves Adobe's
own suggestion on each asset. **[verify]** the exact header spelling and casing from the
downloadable template, and whether a row with an empty `Title` cell is accepted and leaves
Adobe's suggested title in place, or is refused; until confirmed, every row carries a title.
No `Releases` column in v1.

Deterministic guards on the writer, each also a rule in §9: a filename appears once; every
filename is one the build produced; no title contains a comma (a comma inside a quoted cell
is valid CSV but Adobe says not to); the keyword cell is quoted; the file is under 1 MB and
5,000 rows; encoding is UTF-8 without a byte-order mark **[verify]** Excel's "CSV UTF-8"
writes one and Adobe's template presumably tolerates it.

The CSV is named `{product-slug}-adobe-stock.csv` and is a `product_assets` row of type
`other` with `derived_from` null, regenerated on every build, so the handoff always offers the
file that matches the current asset rows.

**Portal-only fields the CSV cannot carry**, which is why the handoff has a step 4: the
generative AI checkbox, the fictional people and property checkbox, the single icon or icon
sheet checkbox, the content type where a JPEG is ambiguous, and the language dropdown. The
portal allows selecting many assets and editing them together, so a batch that is uniformly
generative AI is a few clicks; the handoff says which assets to select.

An alternative Adobe supports and Fanwise does not use in v1: titles and keywords embedded as
IPTC or XMP in a JPEG are preserved on upload. Writing them into the raster derivative would
remove the CSV for photo and illustration batches and leave it for vectors. Noted for later;
the CSV covers every kind today.

---

## 9. Requirements engine

Deterministic, synchronous, checkable without the portal. Expressed as `RequirementSpec`
data where the kinds allow (text, tags, enum, asset) and as `custom` where a rule reads the
asset readings or walks `metadata.assets[]`. Evaluated in the order of the portal's flow.

```
error   product_type_accepted        product_type is illustration, graphic, icon, photo, or (when designTemplatesInvited) template or mockup; font, brush-as-brush, three_d, theme and other are refused with a one-line reason
error   assets_present               at least one file of an accepted kind after exclusions (zip contents unpacked; PSD, TIFF, RAW, opaque PNG, web formats excluded)
error   asset_count_max              at most 5,000 assets, the CSV row limit
warning asset_count_high             more than 200 assets: Adobe's weekly and pending-moderation caps are undisclosed and reported between 200 and 1,000; the batch may pause mid-upload and resume later
error   filename_length              every filename at most 30 characters including the extension
error   filename_charset             ASCII letters, digits, hyphen, one dot; no spaces
error   filename_unique              no two assets share a filename, case-insensitively
error   raster_format                photo and illustration files are JPEG; png files are PNG with an alpha channel
error   raster_megapixels            every raster between 4 MP and 100 MP
error   raster_file_size             every raster under 45 MB
warning raster_color_profile         a raster whose profile is not sRGB, or has none recorded; "not checked" for files finalised before the reading existed
warning raster_scan_dpi              illustration with metadata.dpi set and under 300
warning png_and_jpeg_duplicate       the same source present as both PNG and JPEG
error   vector_format                vector files are AI, EPS or SVG; no zip, no JPEG standing in for a vector
error   vector_file_size             every vector under 45 MB
warning vector_artboard              artboard under 15 MP or over 65 MP where the reading exists; "not checked" otherwise
warning vector_color_mode            document color mode is CMYK where the reading exists
info    vector_hygiene               one artboard, no embedded rasters, outlined text and strokes, labelled unlocked layers, no signature; not checked from bytes
error   icon_min_size                icon product: every file at least 500 px on its shorter side
warning icon_sheet_padding           icon sheet under 1,000 px; padding is not measurable
warning similar_variants             more than three files whose names differ only by a color word or a trailing number; Adobe refuses color-only variants and treats runs of them as spam
error   batch_title_present          channel_listings.title set, 3 to 50 characters, no comma
error   asset_title_present          every asset row has a title, 3 to 70 characters, no comma
error   asset_title_unique           no two asset titles are identical
warning asset_title_generic          an asset title equals the batch phrase alone, or its per-asset phrase came from a filename like IMG_4471
error   title_denylist               no title contains a term from the adapter's denylist: brand and trademark list, camera makers and specs, "in the style of" and its siblings, "video", "vector", "illustration", "photo" as bare words (the content-type words are a warning in titles, §6)
error   batch_keywords_count         channel_listings.tags has 5 to 49 entries
error   asset_keywords_count         every asset row has 5 to 49 keywords
error   keyword_denylist             as title_denylist, for every keyword on every asset
warning keyword_title_words          an asset's title words are not all among its first ten keywords
warning keyword_compound             a keyword of four or more words, which Adobe will not translate or surface
warning keyword_content_type         a keyword that is a content-type word (vector, illustration, photo, image, video)
warning keyword_people_count         a batch whose FactSheet says people appear and no asset carries a people-count keyword or "nobody"
warning keywords_repetitive          more than half the batch shares an identical first ten keywords
error   language_single              every title and keyword is Latin-script English by heuristic; a mixed-language batch is never surfaced in search
error   category_valid               batch and per-asset categories, where set, are integers 1 to 21
error   ai_disclosure_set            the product's generative AI disclosure is answered (decision 24); null blocks
info    ai_checkboxes                the disclosure is yes: tick "Created using generative AI tools" on every asset in the portal, and "People and Property are fictional" where people or property appear; not a CSV column
warning ai_similar_prompt            the disclosure is yes and the batch has more than three assets: Adobe treats multiple versions from one prompt as spam
warning third_party_components       products.third_party_components is non-null: Adobe accepts only self-created assets, no licensed stock, no CC0, no public domain
warning release_needed               the FactSheet says a real person, a photograph or an artwork was the reference, or a place is named: a model or property release is required, even for the creator's own photo; not modelled in v1
error   csv_rows_match               the CSV writer produced exactly one row per asset and every row's filename is an asset filename
error   csv_size                     the CSV is under 1 MB
info    content_type_choice          JPEG batch: choose Photos or Illustrations in the portal; non-photorealistic generative AI is always Illustrations
info    language_dropdown            check "I'm writing title & keywords in" reads English before uploading the CSV; it resets every session
info    review                       moderation is per asset with no published turnaround; approve and refuse notifications arrive in the portal
info    royalty                      Adobe pays 33% of the net price per licensed asset; $25 payout minimum; 45 days after the first sale
info    removal_rule                 the agreement caps removals at 100 items or 10% of the portfolio per 90 days without 90 days' notice
info    training_use                 Adobe says submitted content feeds its generative AI training and reference systems; stated at connect
```

Readiness is errors resolved over errors total. Nothing here calls a model.

**Three rules need a measurement Fanwise does not store yet.** `raster_color_profile` needs
the ICC profile name or the colour-space tag; `vector_artboard` and `vector_color_mode` need
the artboard box and the document mode, read from an AI file's PDF `MediaBox` and its
`/ColorSpace` usage, or an EPS `%%BoundingBox`, or an SVG `viewBox` and `width`/`height`. The
finalize job gains fields on the image and vector readings: `colorProfile`, and for vectors
`artboard: { width, height, unit }` and `colorMode`. They are measurements of the file, like
dimensions, and carry no provider's name; the thresholds live in the adapter. Files finalised
before the fields exist have none, and the rules report "not checked" for them rather than
passing. `png` alpha presence is readable from the PNG header's colour type and is cheap.

**The denylist is data in the adapter**, seeded from Adobe's published examples (Porsche,
Ferrari, iPad, Nikon, Canon, 4K, 12MP) and the *Known image restrictions* page (Adidas, Amazon,
Apple, Barbie, and some hundreds more, updated 2 March 2026), and grown from refusals. It is a
backstop: the factuality validator refuses a named brand or artist the FactSheet lacks before
the denylist ever sees it. A creator whose product legitimately names a brand (a font specimen
is one case, but fonts are refused here anyway) gets the error, and the message says why.

The mapping tables for `category_valid` defaults and the content-type inference live in the
adapter, never in the product enum. The category numbering is the first thing to record from
inside the portal.

---

## 10. The handoff screen

Ordered to the Contributor Portal's own flow: upload, New tab, CSV, per-asset checkboxes,
releases, Submit. Whether the portal's current layout matches the June 2026 *Submit photos*
page is **[verify]**.

```
ADOBE STOCK SUBMISSION                Botanical Line Art, 40 assets

  Open the Contributor Portal  ↗      Readiness  19/19

  1  Files
     botanical-line-art-adobe-stock-files.zip  ·  61 MB           [download]
     40 EPS, 15 MP artboards, RGB. Unzip it and upload the files,
     not the zip. Named botanical-01.eps to botanical-40.eps;
     do not rename anything.
     Upload: drag the files into the portal's Upload target.
     Your account shows the SFTP option: sftp.contributor.adobestock.com,
     port 22, Generate password in the portal, then use your own client.

  2  Wait for the New tab
     The portal renders a preview of each file. All 40 should appear
     under Uploaded Files › New before the next step.

  3  Metadata
     botanical-line-art-adobe-stock.csv  ·  40 rows, 18 KB           [download]
     New tab › Upload CSV › choose the file › Refresh.
     Every row: a title under 70 characters, 22 to 31 keywords in order,
     category 14 Plants and Flowers.
     Check "I'm writing title & keywords in" reads English first.
     [ Review the 40 rows ]   ← a table: filename, title, first keywords; edit inline

  4  What the CSV cannot set
     Content type    Vectors (the portal reads this from the files)
     Generative AI   Not created with generative AI tools: leave both boxes clear.
                     Taken from the product record. Change it there, not here.
     Icons           Not an icon product: leave the icon boxes clear.

  5  Releases
     None needed from what the product says. If any file depicts a real
     person, a photograph, an artwork or a named place, attach a release
     before submitting.

  6  Submit
     Select all 40 › Submit. Moderation is per file, with no published
     turnaround. Nothing can be edited while a file is in review.

  ─────────────────────────────────────────────────
  Done?   [ Mark submitted ]
```

After Mark submitted the same panel shows the review state instead of the steps:

```
  Submitted 16 September 2026 · 40 assets in review.
  Adobe notifies you in the portal per file. Record the outcomes here.

  Approved 37   Refused 3   In review 0

  botanical-07.eps   Refused   Similar content already exists      [reason ▾]
  botanical-19.eps   Refused   Technical issues                     [reason ▾]
  botanical-33.eps   Refused   Metadata errors                      [reason ▾]

  [ Paste your contributor portfolio URL ]   [ Mark all approved ]   [ Resubmit refused ]
```

Design rules, inherited from Creative Market's handoff and unchanged:

- Each copy button and download holds a "done" state until the next is used.
- Downloads sit at the step that needs them.
- Nothing says "publish" or implies Fanwise did anything on Adobe Stock.
- The screen is one component that does not assume a full page's width, so the companion
  window of `docs/companion-window.md` shows it beside the portal unchanged. That window
  never reads or writes the portal's page.

Rules new here:

- **The asset table is the handoff.** Forty rows of filename, title and leading keywords,
  editable inline, sortable by readiness. Editing a row rewrites the CSV; the download at step
  3 is always the current one and says so ("regenerated 12 seconds ago").
- **The filename is sacred.** It is shown on every row and the table refuses to edit it. The
  one sentence at step 1 is repeated at step 3: do not rename anything.
- **Portal-only checkboxes are stated per batch**, with the list of assets to select when the
  batch is not uniform.
- **Outcomes are per asset and counted.** A batch says what happened to each file and counts
  the results, as a Publish Everywhere run does per channel. "Partially" appears nowhere.
  "Resubmit refused" builds a new asset set of the refused files only (fixed in Fanwise
  first) with a fresh CSV, on the same listing, as the next batch.
- **The royalty line is always shown**, once, above step 1: "Adobe sets the price and pays
  33% per license. Your Fanwise price is not sent."

---

## 11. Data written

On build: a `channel_listings` row at `ready`, `status_source = self_reported`, `title` (the
batch phrase), `tags` (the shared keywords), `category` (the batch number or null), `price`
and `currency` **null** (the channel has no price field, and resolution empties them), and in
`metadata`: `assets[]` as in §4, `batch: { index, builtAt, fileCount, csvAssetId, zipAssetId }`,
`contentType`, `iconMode`; a `generated` snapshot; derivative rows for any re-encoded raster,
the CSV and the transport zip; `ai_generations` rows with the FactSheet hash, one per asset
or one per batch depending on how B4 sizes §6.

On approve in the review UI: a snapshot with `snapshot_type = approved`, `approved_at` set.

On mark submitted: status `published`, `status_source` unchanged, `external_url` **null**,
`published_at` set, every `assets[].review = { state: "submitted", at }`, a `published`
snapshot, a `workspace_events` row. With no external reference the derived state is
`published_not_live`, which the UI words as **Submitted, in review**. This is the state
`docs/channels/myfonts.md` §11 also needs, and the two channels share it: a submitted
listing is not live until a person at the marketplace says so.

On the creator recording outcomes, per asset:

- **Approved.** `assets[i].review = { state: "approved", at, externalId, url }` where the URL
  is the asset's page, `stock.adobe.com/images/{slug}/{id}` **[verify]** the shape, and the
  numeric id is parsed from it. When the first asset is approved and the creator pastes the
  contributor portfolio URL, `external_url` is that URL and `external_listing_id` the
  contributor id. A `workspace_events` row per recording action, not per asset.
- **Refused.** `assets[i].review = { state: "refused", at, reason }` with the portal's refusal
  reason from its fixed list (technical issues, missing or incorrect releases, IP violation,
  metadata errors, generative AI anomalies, similar content exists), as the creator picks it.
  Nothing is deleted.

Derived state, computed on read as `lib/publishing/manual-steps.ts` computes today's:
`published_not_live` while any asset is `submitted`; `live` when at least one asset is
`approved` and none is `submitted`; back to `ready` by the creator's action when every asset
is `refused`, with the refusals kept on the rows. The listing is never described as
partially anything; the counts are shown.

**Resubmit** appends a new `batch` on the same listing with only the refused assets, rebuilt,
and a new CSV; each mark submitted writes another `published` snapshot. `published` to
`ready` and `published` to a second `published` are transitions the assisted status machine
does not have today and must gain, by human action only, never from a job.

Nothing in this flow may write a row another part of the system would read as verified. The
trigger that refuses `verified` on an assisted channel is untouched.

---

## 12. Prices, royalties, limits, the agreement, and SFTP

Facts the handoff and the requirements depend on, with their sources.

**There is no price.** Adobe sells plans (subscriptions, credit packs, on-demand) and custom
agreements, and pays the contributor a royalty on each license: **33%** of the net price per
licensed photo, vector or illustration, **35%** for video, on the U.S. purchase price
including discounts. Adobe's own worked example: a $29.99 plan for ten photos pays $0.99 per
license. Minimum royalty per standard asset under the Large Subscription (350 assets a month
or more): $0.33 for a contributor with under 1,000 lifetime licenses, $0.36 to 9,999, $0.38
above. Nothing is paid for licenses from the Free Collection. The product's `base_price` is
not sent and the handoff says so in words.

**Getting paid.** Payout at **$25**, at least **45 days** after the first sale, to PayPal,
Payoneer or Skrill; 7 to 10 business days to arrive. Credits are dollars, 1:1. Without a valid
tax form Adobe withholds 30%. The account's country must match the creator's legal documents.

**Decision 16 gets its sharpest case here.** Fanwise's $6 a month for an assisted channel sits
beside a marketplace that pays the creator between $0.33 and about $1 per license and sets
every price itself. Behance's 30% platform fee made the same argument from the other side.
The assisted price has to be obviously worth it, and on this channel "worth it" is measured in
refusals avoided and hours not spent on a CSV, not in revenue per listing. Say that on the
pricing page or price assisted channels differently; do not leave it to be discovered.

**Submission limits.** Announced 20 May 2025 and adjusted since: a weekly submission cap and a
cap on content pending moderation, both undisclosed and both per account; contributors report
weekly caps between 200 and 1,000 depending on history, and new accounts historically held
around 50 pending. Reaching either pauses submission, not upload: files already in the New tab
wait, and the same CSV applies to them when submission resumes. `asset_count_high` says so.

**Moderation.** Every asset, individually, with no published turnaround ("times vary based on
the volume of content in the review queue"); third-party guides report one to seven days and
longer for new accounts. Criteria: technical quality, IP compliance, commercial value, metadata
quality, uniqueness. Metadata cannot be edited while an asset is in review; it can be edited
before submission and after approval. Refused assets carry one of a fixed list of reasons and
no individual feedback.

**The agreement.** The Additional Terms of 5 June 2018, incorporated into Adobe's General
Terms. Clauses a Fanwise creator should know before connecting, stated in the handoff's
first-run text and not enforced by Fanwise:

- **Non-exclusive, worldwide, perpetual license to Adobe** to sublicense the work in any
  media, including derivative and merchandise uses within the customer license. Licenses
  granted before removal survive removal.
- **Adobe may use the work to develop new features and services** (§2), and the contributor
  overview page says plainly that submitted content "feeds Adobe's generative AI training and
  reference systems". A creator who objects to that should not connect.
- **Removal is rate-limited**: no more than 100 items or 10% of the portfolio, whichever is
  greater, in any 90 days without 90 days' written notice (§6.2). There is no `unpublish` on
  this channel, and if there were it could not honour that clause per listing.
- **Delivery is by the methods Adobe requests** (§6.1). SFTP and the portal are those methods.
- **Termination** by Adobe without notice; by the contributor with 90 days' notice.
- **Releases** for any identifiable person, trademark or protected property (§3.2).
- **One account per person** without an exception request; sharing is not addressed in the
  Additional Terms, and Adobe's General Terms §5.1 and §6.3 (cited in
  `docs/channels/behance.md`) forbid sharing account credentials.

**SFTP, and whether Fanwise should ever hold the credential.** Adobe's *Upload your content*
page describes SFTP for "qualified accounts": the portal shows a "Learn more" link under the
upload target, the creator clicks Generate password, and connects any SFTP client to
`sftp.contributor.adobestock.com` on port 22 with the generated password (a username is shown
alongside **[verify]**). The same page names a third-party tool, Stocksubmitter, and tells
users to update their credentials in it, which is the closest Adobe comes to acknowledging
tools that upload on a contributor's behalf. Three facts bear on a Fanwise SFTP job:

1. Generate password *changes* the password. A credential Fanwise held would go stale the
   moment the creator regenerated it in the portal, with no signal.
2. SFTP moves files only. The CSV, the checkboxes and Submit are portal actions, so the
   "one click" the feasibility doc imagined is still the creator's, and holding the credential
   removes one drag-and-drop from a flow that keeps four steps.
3. The community statement that automated *submission* is not allowed is about submission,
   which SFTP is not; but it is unconfirmed against any term, and Adobe's General Terms §6.6
   ("by any means other than the interface we provide or authorize") could be read either way
   for a third party using a creator's SFTP login.

**Recommendation:** not in v1. Register a decision in `docs/decisions/0002`: *whether Fanwise
transfers Adobe Stock files over the creator's SFTP account*, with an email to Adobe
Contributor Relations asking the question in writing, in the shape of decision 27's letter to
Gumroad. If the answer is yes, the change is `digitalFileUpload: true`, an encrypted SFTP
credential under invariant 7, a background job, and a handoff step 1 that says "uploaded" —
not a redesign.

**Sales data.** None by API. The Insights page shows balance, earnings and licenses;
whether it exports a file is **[verify]** and is B7's path if it does. Until then the honest
answer in analytics is decision 15's: no data from this channel, said as such.

**The Free Collection.** Adobe invites nominations for a free tier and pays a one-time credit
(four credits for a photo, vector or illustration for a one-year period, ten for perpetual;
one or two for an icon; five for a design template). Nominated assets earn no royalties. Out
of scope; named in §14 so nobody mistakes it for a price.

---

## 13. Open questions to resolve from inside the Contributor Portal

Open a contributor account, upload one JPEG, one PNG with transparency and one SVG, and
settle these before the adapter is written. Each is a guess above until it is.

1. The category numbers: whether the portal's 1 to 21 follow the order on the *Choose the
   right category* page (§5).
2. The exact header spelling and casing of the official CSV template, whether a BOM is
   tolerated, and whether an empty `Title` cell is accepted and leaves Adobe's suggestion in
   place or is refused.
3. The title limit in the portal itself (200 characters per secondary sources) versus the
   CSV's 70, and whether "illustration" or "photo" in a title is refused, warned, or ignored.
4. The keyword maximum: 49 (titles page), 50 (CSV page and the June 2026 submit page). And
   whether a keyword over some length is truncated or refused.
5. The contributor portfolio URL shape and the asset URL shape, and whether either changes
   when a title is edited after approval.
6. The exact wording and placement of the two generative AI checkboxes, the icon checkboxes,
   and the content-type selector; whether they can be set on many selected assets at once.
7. Whether PNG icons can be tagged as icons, or only AI and SVG as the icons page says.
8. SFTP: what "qualified" requires, whether the username is the contributor id, whether the
   password rotates on anything other than Generate password, and whether an `incoming`
   folder or the root is the drop target.
9. Whether the New tab shows CSV match failures per row, and what it does with a row whose
   filename matches nothing.
10. The weekly and pending-moderation caps as the account actually experiences them, and
    what the pause message says.
11. Whether Insights exports earnings or license history as a file, and its columns.
12. Whether the design templates application has a stated response time, and what the vetting
    step asks for.
13. Whether a refused asset can be resubmitted after a fix, or must be re-uploaded as a new
    file with a new name (which decides whether Resubmit reuses filenames).
14. The Premium and 3D collections: accepted 3D formats and the invitation path, to decide
    whether `three_d` ever maps.

Record the answers in this file as they are settled, and drop the **[verify]** markers.

---

## 14. What this channel is not

- **Not a storefront.** Nothing here has a price the creator sets, a product page, or a
  buyer who downloads a bundle. A creator who wants to sell the forty-illustration pack as a
  pack sells it on Creative Market, Gumroad, Etsy or their own shop; Adobe Stock licenses the
  forty pictures one at a time.
- **Not Adobe Fonts.** Type is not accepted on Adobe Stock. Adobe Fonts is a separate,
  curated foundry program with its own agreement, and it is not a channel Fanwise models.
- **Not the Adobe Stock API.** That API searches and licenses assets for buyers and their
  applications. It creates nothing and is not a contributor pipeline; the feasibility doc
  already warns it is easy to mistake for one.
- **Not the design templates program, until invited.** The package is specified in §7 so the
  build is ready; the program is invitation-only and the connection says whether the account
  is in it.
- **Not the Free Collection or Supplemental Work.** Both are Adobe-initiated programs paying
  fixed credits for nominated or requested work. Neither has a product to map.
- **Not Behance.** Behance can display a contributor's Adobe Stock assets on a profile tab,
  synced one way from Stock. That is a portfolio feature (`docs/channels/behance.md` §14),
  not a channel, and connecting Adobe Stock in Fanwise does nothing on Behance.
- **Not a place Fanwise holds a credential.** No login, no token, no SFTP password in v1. The
  companion window sits beside the portal and never touches it. §12 says how that would
  change and who decides.
