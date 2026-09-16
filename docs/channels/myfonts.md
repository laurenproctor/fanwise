# Channel spec: MyFonts

The assisted channel whose metadata burden is heaviest and whose rules are most exact, which
is the case `docs/channel-feasibility.md` made for it as a B4 candidate under decision 14.
Written on 16 September 2026 against Monotype's Foundry Support help center, read through
its article API: *Uploading a new font family* (updated 10 September 2026), *Common Reasons
for Font Rejection* (31 August 2026), *Get Started* (15 September 2026), *Editing an existing
font family* (5 September 2026), *Font Naming Best Practices* (15 September 2026), *Tagging
Fonts to Improve Search Visibility* (24 June 2026), *Recommended Character Set*
(1 September 2026), *Font Description Best Practices* (2 September 2026), the six license
articles (March to August 2026), *The 45 Day Rule*, *Free Fonts*, *Updating existing font
files*, *Font Modifications*, *Currencies on MyFonts*, *Earnings Reports* and the summary of
the *Monotype Distribution Agreement* (5 September 2026). Not built. Items marked
**[verify]** could not be settled from those articles and need a logged-in look at the
Foundry Platform, which needs a foundry account: see §1.

`docs/channel-feasibility.md` carries the short assessment. Read it first for why the channel
is assisted and why that will not change: there is no public API, no FTP and no manifest
format, the Monotype Fonts REST API is a webfont-serving product for licensees, and the
distribution agreement is non-public, so its stance on third-party automation is
unconfirmed. Fanwise never holds a Foundry Platform credential and never touches its pages.

---

## 1. Why this channel, and what it waits on

- **It is the strongest case for assisted preparation.** Every other assisted channel asks
  for a title, a description, some tags and some images. MyFonts asks for a family with
  ordered styles in one file format, a 186-glyph character set in every style, five to
  fifteen marketing images at an exact ratio, a two-level USD price table, a description
  under 500 words written to a house style, and a name that survives a trademark review.
  Then a human reviews it and sends it back if anything is off. That is a list of things a
  creator gets wrong on the first try and Fanwise can check before they try.
- **Fanwise already holds the facts it needs.** The font workspace (`lib/fonts`, merged
  14 September 2026) puts the style list, classification, scripts, glyph count, OpenType
  features, variable axes and licence types on the product, and the finalize job reads
  every uploaded file's name table, `OS/2` and `cmap`. MyFonts is the first channel whose
  requirements consume all of that rather than the four listing columns.
- **The review is the test.** Foundry Support answers within 24 hours of the next business
  day with approve, return or reject. A submission Fanwise prepared that is approved first
  time, unedited, is the composed-listing hypothesis of `docs/channels/creative-market.md`
  §2 with a stricter judge than the creator.
- **The money is real.** Monotype pays 50% of the price on MyFonts sales, monthly, and
  MyFonts is where a type designer who already sells expects to be. The creator Fanwise's
  font workspace was built for is a MyFonts foundry or wants to be one.

**What it waits on.** Three things, none of them code.

1. **A foundry account.** Selling needs an application on fontplatform.monotype.com with a
   foundry name, a foundry description and a designer bio, all in English, and a signed
   distribution agreement. Monotype accepts or declines the foundry before any font is
   submitted, and does not transact with Russia, Belarus, Iran, Syria, North Korea, Cuba or
   Crimea. This is the same shape as decision 3 (Creative Market) and decision 26 (Behance):
   an external wait nobody controls, to be registered in `docs/decisions/0002`. As with
   Creative Market, Fanwise never asks a creator for their login; the answers in §13 come
   from the founder's own foundry or from an alpha creator reading their screen.
2. **A8.** The handoff machinery (the package build, the handoff screen, mark submitted,
   URL capture, the `self_reported` discipline) is A8's to build and this channel reuses
   every piece, plus one new state for a submission that is in review (§11).
3. **Decision 14.** This spec answers the MyFonts half. Adobe Stock needs its own before the
   two can be compared on evidence rather than on which was written first.

**What it does not wait on.** B2a's creators or Behance. A font designer with a live
foundry is a different person from a Creative Market template seller, and this channel's
exit can run with one of them.

---

## 2. What the step proves

A creator carries one real font family, entered once in the Fanwise font workspace, through
the handoff into the Foundry Platform's four-step form, submits it, and Foundry Support
approves it without returning it. The family URL is captured. Every row reads
`status_source = self_reported`. No surface anywhere offers Publish for this channel.

Measures, in the spirit of `docs/channels/creative-market.md` §12:

| Metric | Target |
|---|---|
| Time from opening the handoff to clicking Submit on the Foundry Platform | Under 20 minutes |
| Fields materially rewritten before submit | Fewer than 2 of 6 |
| Marketing images used as built, without re-export | At least 4 of 5 |
| Submission approved by Foundry Support without being returned | Yes |
| Character-set and naming warnings Fanwise raised that review also raised | Every one Fanwise raised; none it missed |

The last row is the one that matters. If review returns the family for a reason Fanwise
could have checked and did not, the requirements engine is wrong and §9 grows a rule. If
review returns it for a reason Fanwise cannot check (design quality, a name Monotype judges
too close to another), that is the ceiling of assisted preparation and worth knowing.

---

## 3. Adapter definition

```ts
export const myfonts: ChannelAdapter = {
  key: "myfonts",
  name: "MyFonts",
  integrationType: "assisted",
  // The family name is the product name and is not a listing field: a rewritten
  // family name is a naming inconsistency MyFonts rejects. No short description,
  // no search-engine fields: the Foundry Platform has no place for them.
  fields: ["description", "price", "category", "tags"],
  capabilities: {
    automaticPublish: false,   // the provider cannot: no API, submission is a logged-in form
    automaticUpdate: false,    // same; edits also re-enter review
    metrics: false,            // the provider cannot: no API. The Foundry Platform shows a dashboard
    transactions: false,       // the provider cannot by API; Earnings Reports export a spreadsheet, B7
    digitalFileUpload: false,  // the provider cannot; the font files are the submission
    imageUpload: false,        // the provider cannot
    drafts: true,              // an in-progress submission autosaves and is resumed by the seller
  },
  requirements,                // §9, data where the kinds allow it
  manualSteps: [],             // a manual step tracks work after a publish; nothing here publishes
  merchandising,               // §6
  buildListing,
  // no publish, update, unpublish, activate, oauth
}
```

Every `false` is the permanent kind `docs/channel-adapters.md` distinguishes: the provider
cannot. None is a step Fanwise has not reached.

There is no `oauth` member, so Connect writes a row and starts no flow. The account hint is
the **foundry name** exactly as it appears on MyFonts, stored as `external_account_name`. A
Foundry Platform login can manage several foundries and picks one from a dropdown at the top
of every submission, so the connection is to a foundry, not to a login, and a creator with
two foundries has two connections. No credential of any kind is held.

Seed: `('myfonts', 'MyFonts', 'assisted', 'available', true)` in a migration named
`<timestamp>_myfonts_channel.sql`. `billable` is true: it is an external marketplace, and
decision 16 (assisted versus automatic pricing) decides the price, not the row.

---

## 4. The submission and the family

**One submission is one family page on MyFonts.** That is Monotype's own framing, and it
maps onto Fanwise's without translation: one font product, whose `metadata.styles` is the
family's style list, becomes one submission. Files inside the submission may be style-linked
into several menu families, which is a fact about the files, not about the listing.

What the Foundry Platform's form asks for, in its own order, and where each answer comes
from:

**Step 1, family and files.** The foundry (from the dropdown, §3). The font files, dropped
in bare: no zip, OTF or TTF only, **one file type per submission**, each file under 52 MB,
up to 200 files at once. Variable fonts ride alongside as OpenType TTF variable files, and
the three permitted combinations are CFF OTF with variable TTF, TTF with variable TTF, and
TrueType-flavoured with variable TTF. Monotype's validator then runs: yellow warnings do not
block submission, red errors do, and every file is malware-scanned. The family name and
style names are reviewed as the files declare them. Styles are ordered lightest to heaviest
by drag and drop. Designers are chosen from Monotype's designer registry, and a designer not
in it is added by emailing foundry support. A **default display style** is chosen to
represent the family in search results and lists; Monotype recommends Regular.

**Step 2, prices.** In USD, required, for each style and for the complete family pack. One
price can be applied across every style with one click. Up to five sub-family packs, each
named, with a chosen set of styles and a price (the editing article says three
**[verify]**). Other currencies convert automatically from USD and can be overridden with a
fixed price per currency.

**Step 3, description, tags and category.** A description under 500 words, in English. Tags,
typed or pasted comma-separated, up to 20, each up to 30 characters. A category from a list
the articles do not publish **[verify]**.

**Step 4, images.** Five to fifteen PNG images at exactly 2:1, 2000 × 1000 recommended,
1440 × 720 minimum, reordered by drag and drop.

**Final.** Generate Preview, a note to Foundry Support, a release date (as soon as possible
or a calendar date), Submit. **Nothing can be edited after Submit until review returns it.**

Fanwise's rule for what it emits: everything above that is derivable, in that order, with a
deterministic check on each, and nothing it cannot derive presented as if it could. The
designer registry and the category list are the two places the creator chooses on the
Foundry Platform and Fanwise records what they chose.

---

## 5. Canonical product to submission field map

| Foundry Platform field | Source | Transform | Notes |
|---|---|---|---|
| Foundry | connection `external_account_name` | Pass through | The dropdown at the top of the form |
| Font files | `deliverable` and `archive` assets that read as OTF or TTF | File set, §7 | WOFF, WOFF2 and EOT are excluded, not errors: Monotype generates webfonts itself |
| Family name | `products.name` | **None.** Never rewritten | Must equal the family name in every file's name table, and appear spelled identically in the description and images, §9 |
| Style names and order | `metadata.font.styles`, sorted by weight then name | Pass through as a checklist | The Foundry Platform reads names from the files; Fanwise shows the expected order so the creator can confirm it |
| Designers | `brand_name` | Shown, creator picks in the registry | Fanwise cannot know the registry entry. If absent, the handoff says to email foundry support before submitting |
| Default display style | `metadata.myfonts.defaultDisplayStyleKey` | Creator's choice, recommended | Recommendation: the upright style with weight nearest 400; if the family has one style, that style |
| Price per style | `metadata.myfonts.stylePriceUsd`, per-style overrides in `stylePrices` | USD, two decimals | The **base price** from which every licence price derives, §12. Pre-filled from `base_price` only when the product currency is USD and the family has one style; otherwise the creator enters it |
| Complete family pack price | `metadata.myfonts.familyPriceUsd` | USD | Pre-filled from `base_price` when the currency is USD and the family has more than one style |
| Sub-family packs | `metadata.myfonts.packs[]` | Name, style keys, USD price | Optional. v1 offers none by default; the creator may add up to the platform's limit |
| Description | `canonical_description` | AI rewrite to the MyFonts profile, then plain text, §6 | Under 500 words. The family name must appear exactly |
| Tags | `channel_listings.tags`, seeded from `metadata.tags` | Title Case, deduplicated, at most 20, each at most 30 characters | Mix of broad and specific. Monotype title-cases new tags itself; Fanwise emits them already cased so what is pasted is what is saved |
| Category | `metadata.font.classification` | Mapping table in the adapter, creator confirms | Target list **[verify]**, §13 |
| Marketing images | `cover_image` then `preview_image` assets, in `sort_order` | Derivatives, §8 | 5 to 15, 2:1, PNG. The cover is emitted first |
| Note to Foundry Support | Derived, §10 | Composed deterministically from facts | Double-mapped capitals, accessory styles with a smaller character set, name rights, permission for a derived design. Never composed by the model |
| Release date | `metadata.myfonts.releaseDate`, optional | Pass through | Default: as soon as possible |
| Licence summary, EULA link, per-licence prices and limits | **nothing** | | MyFonts sells every family under Monotype's own EULAs at prices derived from the base price, §12. The handoff says so in words |
| Short description, SEO fields, version, support URL | **nothing** | | No field on the form |

Every `metadata.myfonts.*` value lives on `channel_listings.metadata`, never on `products`.
A per-style USD price is a MyFonts fact about this listing, and the product keeps its own
price in its own currency.

---

## 6. Description transform

The Foundry Platform's description field is plain prose as far as the articles show:
paragraphs separated by a blank line, in accessible English, with links to documentation
PDFs and to other families in the foundry permitted. Whether the field renders any
formatting is **[verify]**; assume none, convert the canonical Markdown with
`markdownToPlainText` as Etsy does, and keep link URLs as bare text.

The merchandising profile for this channel is the typeface standard in
`docs/merchandising/typefaces.md` with Monotype's own guidance laid on top, and the two
agree almost line for line: identity and classification first, the design story, visual
behaviour, best uses, then family, coverage, features. Monotype adds a list of habits that
get a description returned, and each is either a rule in the profile or a deterministic
check in §9:

- Under 500 words. House floor: 60 words.
- The family name spelled exactly as in the files, in standard capitalisation, never in all
  capitals even if the images set it that way.
- Never open with "Introducing" or "Welcome". Never write it like an email.
- No exclamation marks, no ampersands, no emoji, no "etc." (Monotype asks for "and more").
- No "Files included" section, no file names, no format list: the family page shows formats
  automatically. This is the one place the typeface standard's §9, formats and
  compatibility, is switched off for a channel.
- Glyph count, OpenType features, alternates, swashes, ligatures, language support and the
  differences between weights are welcome, and every one of them is in the FactSheet since
  15 September 2026, so the model states them or leaves them out and the validator refuses
  anything else.
- Not copied from another family, including the foundry's own. Fanwise composes per product
  from that product's facts, which is the strongest guarantee available short of review.

Monotype may make small edits during review for clarity and consistency. The `published`
snapshot therefore records what was submitted, and the live page may differ by a few words.
That is not a defect and the docs should not promise otherwise.

```ts
merchandising: {
  promptVersion: "2026-09-16.1",
  audience: "A designer browsing a type catalogue who compares families by classification, features and price, reading in English from anywhere in the world.",
  voice: "Editorial and specific. Third person. Every sentence carries a fact or a use. No hype, no exclamation, no salutation.",
  structure: "Identity and classification in the first sentence; design story; visual behaviour; best uses; family, coverage and OpenType features. Plain paragraphs separated by blank lines. No Markdown. Under 500 words.",
  fields: {
    title: "Leave empty. The family name is the product's name and is never rewritten.",
    description: "60 to 450 words. Name the family exactly as given, in normal capitalisation. Do not list files or formats. Never open with 'Introducing'. No exclamation marks, ampersands, emoji or 'etc.'.",
    shortDescription: "Leave empty.",
    seoTitle: "Leave empty.",
    seoDescription: "Leave empty.",
    tags: "Up to 20, each up to 30 characters, Title Case. Mix broad and specific: classification, subclassification, mood, use, era. No single characters, no bare four-digit years.",
  },
}
```

---

## 7. Files

This channel has no package. The Foundry Platform refuses a zip and takes bare font files,
so what Fanwise emits is a **file set**:

- **One static format.** If the product's readable font files include both OTF and TTF,
  the creator chooses which format the submission uses and the other is left out. The
  default is OTF where it exists, because CFF outlines are what most foundries submit
  **[verify]** that Monotype has no preference. Variable files are included whenever
  present; Monotype expects them as OpenType TTF variable files, and a variable OTF with CFF2
  outlines is **[verify]**.
- **Web formats are left out silently.** WOFF, WOFF2 and EOT are not submission files here.
  Monotype generates webfonts from the desktop files at order time, under the modification
  rights in the agreement. The handoff says this once so nobody wonders where their WOFF2
  went.
- **Each file under 52 MB, at most 200 files.** Both are errors.
- **Every file must have a reading.** A file the finalize job could not parse is a file
  Monotype's validator will refuse, and Fanwise says so first.
- **Transport is one zip, named `{product-slug}-myfonts-files.zip`**, because a 30-style
  family is 30 downloads otherwise. The handoff says, in the same line, to unzip it and drop
  the files in, and never the zip. The zip is a convenience of delivery, not a package, and
  contains no README, licence or documentation: there is no field for them.

Documentation and licence assets on the product are not sent. A PDF of feature usage may be
linked from the description if the creator hosts it somewhere public; Fanwise does not host
it for this purpose in v1.

---

## 8. Image derivative spec

| Property | Value |
|---|---|
| Count | 5 to 15. Fewer than 5 is an error; Fanwise emits every source up to 15 |
| Ratio | **Exactly 2:1** |
| Recommended | 2000 × 1000 |
| Minimum | 1440 × 720 |
| Format | **PNG** |
| File size | No published limit **[verify]**. A 2000 × 1000 PNG of a specimen is typically 1 to 3 MB; a photograph can exceed 10 |

**Build target: 2000 × 1000 PNG, sRGB, centred crop from the source.** The ratio is new to
the catalogue: Creative Market builds 3:2, Behance 1.278:1 and 2800-wide, Etsy a 2000-pixel
long edge, so this is one more row in the derivative service, keyed on source checksum plus
spec hash like the others. A source narrower than 2000 is upscaled to meet the minimum only
if it is at least 1440 wide; below that the derivative is not built and the rule in §9 says
which source to replace. A source whose centred 2:1 crop discards more than a quarter of
its area is built anyway and flagged, because a specimen with its headline cut off is the
"stretched or poorly coordinated" image that review rejects.

Content rules Monotype states, and what Fanwise does with them:

- **No prices or discounts on images.** Not checkable from pixels in v1; shown as an info
  rule in the handoff. When the workspace's image alt text names a price, the rule turns to a
  warning, which is cheap and catches the common case.
- No racist, sexist, religious or political content, no expletives. Info rule.
- A small, cohesive set with a consistent palette; real-world use, mock logos, layouts,
  panels showing alternates, ligatures, swashes; photography works. This is guidance for the
  creator, shown once above the image step, not a rule.
- Pixelated or stretched images are rejected. The minimum-width rule and the exact-ratio
  crop are what prevent both.

Filenames carry numeric prefixes (`01-`, `02-`) so the carousel order is the order Fanwise
chose, with the cover first. Whether the first image is also the family's card image on
list pages is **[verify]**; the default display style, not an image, represents the family
in search results.

---

## 9. Requirements engine

Deterministic, synchronous, and checkable without the Foundry Platform. Expressed as
`RequirementSpec` data where the kinds allow (text, number, tags, enum, asset) and as
`custom` where a rule reads the asset readings. Evaluated in the order of the form.

```
error   family_name_present          products.name set, 2 to 60 characters
error   family_name_not_generic      not composed solely of generic typographic words (sans, serif, script, mono, bold, italic, font, typeface, standard, pro, the, ...)
error   family_name_matches_files    equals the family name in every ready submission file's name table, case-sensitively
warning family_name_punctuation      contains a hyphen or other punctuation
warning family_name_all_caps         the name is entirely upper case
error   files_present                at least one readable OTF or TTF after web formats are excluded
error   files_one_format             the static files are all OTF or all TTF; variable TTF may accompany either
error   files_readable               every submission file has a reading; none carries a fontProblem
error   file_size_max                every submission file under 52 MB
error   file_count_max               at most 200 submission files
error   styles_listed                metadata.styles is non-empty and every listed style has a submission file
error   default_display_style        one style is chosen
warning single_weight_text_family    classification is sans_serif, serif or slab_serif and the family has one style
warning character_set                every style covers the 186-glyph recommended set; the message lists what is missing per style
warning currency_symbols             $ € ¥ £ ¢ present in every style
warning character_set_consistent     every style covers the same set of the 186; the message names the odd ones out
warning embedding_restricted         any submission file's fsType is restricted; Monotype must generate webfonts from it
error   style_price_usd              every style has a USD price of 0 or more, and at least one style is above 0
error   family_price_usd             the complete family pack has a USD price above 0 when the family has more than one style
error   not_free                     products.base_price is above 0; MyFonts does not list free families
warning price_low                    any style under $9: not marketed in newsletters and not recommended
info    price_parity                 the price must be the same or lower than anywhere else the family is sold; the workspace lists this product's other listings
error   description_present          set
error   description_words            60 to 500 words
error   description_names_family     contains products.name spelled exactly, at least once
warning description_house_style      opens with "Introducing" or "Welcome"; contains "!", "&", an emoji, "etc."; contains "files included", a filename or a format name; sets the family name in all capitals
error   tags_count                   1 to 20, each 1 to 30 characters
warning tags_min                     fewer than 5
warning tags_quality                 a single-character tag, a bare four-digit year, or two tags equal after title-casing
error   category_mapped              classification maps to a category and the creator has confirmed it
error   images_count                 5 to 15 derivatives built
error   image_ratio                  every derivative is exactly 2:1
error   image_dimensions             every derivative at least 1440 × 720
error   image_format                 PNG
warning image_source_crop            a source loses more than a quarter of its area to the 2:1 crop
warning image_source_small           a source narrower than 2000; below 1440 the derivative is not built and this is an error
warning image_price_text             an image's alt text mentions a price or a discount
info    image_content                no prices, discounts, political or religious content, expletives; a cohesive set in one palette
info    licences_are_monotypes       the six licence types, their multipliers and the fact that the Fanwise licence summary is not sent, §12
info    royalty                      Monotype pays 50% of the MyFonts price, monthly
info    review                       reviewed within 24 hours of the next business day; not editable after Submit until returned
info    price_change_window          prices cannot change for 45 days after release, after a change, or during a promotion
```

Readiness is errors resolved over errors total. Nothing here calls a model.

**Two rules need a measurement Fanwise does not store yet.** `character_set` and
`currency_symbols` need the code points a file covers, and the reading in
`lib/fonts/detected.ts` records a glyph count, a code point count and per-block coverage
counts, none of which says whether `¢` is present. The finalize job gains one field on the
reading, `codepoints`, a sorted list of inclusive ranges, capped in length and written the
same way for every font. It is a measurement of the file, like `blocks`, and carries no
provider's name; the 186-glyph list and the five currency symbols live in the adapter,
where every other channel's constants live. Files finalised before the field exists have no
`codepoints`, and the two rules report "not checked" for them rather than passing.

**The exceptions Monotype allows are the creator's to claim, in the note.** An icon font, a
swash or ornament style, an all-caps design with double-mapped lowercase, or a non-Latin
family with no Latin at all will fail `character_set` here and get a yellow warning from
Monotype's validator, and Monotype's article says to leave a note for the reviewer or expect
rejection. Fanwise does the same: the warning stays, the handoff's note step offers the
matching sentence, and the creator chooses to include it. Fanwise never silences a rule
because the creator says the exception applies.

The mapping table for `category_mapped` lives in the adapter, never in the product enum, per
`docs/data-model.md`. The category list is the first thing to record from inside the form.

---

## 10. The handoff screen

Ordered to the Foundry Platform's own four steps and its final page, so the creator works
top to bottom in both windows. Whether the current form still runs in this order is
**[verify]**; the articles it is taken from were updated in September 2026.

```
MYFONTS SUBMISSION                    Aster Grotesk

  Open the Foundry Platform  ↗        Readiness  22/22

  1  Family and files
     Foundry          Proctor Type                            [copy]
     Files            aster-grotesk-myfonts-files.zip  ·  9 MB  [download]
                      14 OTF, 1 variable TTF. Unzip it and drop the files in,
                      not the zip. Your WOFF2 files stay here: MyFonts makes its own.
     Family name      Aster Grotesk           matches all 15 files
     Styles           Thin → Black, italics after uprights   14 styles, expected order
     Designers        Lauren Proctor          pick from the list, or email foundry support first
     Display style    Aster Grotesk Regular                   recommended

  2  Prices, in USD
     Each style       39.00                                  [copy]
     Complete family  299.00                                 [copy]
     At $39 a style, MyFonts sells a 5-user desktop licence at $140.40,
     a 100,000-pageview webfont licence at $195, and pays you 50%.
     [ Show every licence price ]

  3  Description, tags and category
     Description      [ plain-text preview ]                 [copy]
                      312 words · names the family 3 times
     Tags             Grotesque, Sans Serif, Neo-Grotesk, Variable Font,
                      Editorial, Headline, Corporate, 1950s, …  18 tags   [copy]
     Category         Sans Serif                             [copy]

  4  Images
     8 images, 2000 × 1000 PNG                              [download all]
     01-cover  02-waterfall  03-in-use  …
     Upload in filename order. No prices or discounts on any image.

  5  Final page
     Note to Foundry Support                                 [copy]
       "The Ornaments style is an accessory font with a reduced character
        set, by design. The other 13 styles share the full set."
     Release date     As soon as possible
     Generate Preview, check it, Submit. Nothing can be edited after
     Submit until review returns it, usually within 24 hours of the next
     business day.

  ─────────────────────────────────────────────────
  Done?   [ Mark submitted ]
```

After Mark submitted the same panel shows the review state instead of the steps:

```
  Submitted 16 September 2026, in review.
  Foundry Support answers within 24 hours of the next business day.

  [ Approved: paste the family URL ] [ Returned with changes ] [ Rejected ]
```

Design rules, inherited from Creative Market's handoff and unchanged:

- Each copy button holds a "copied" state until the next one is used.
- Downloads sit at the step that needs them.
- Nothing says "publish" or implies Fanwise did anything on MyFonts.
- The screen is one component that does not assume a full page's width, so the companion
  window of `docs/companion-window.md` shows it beside the Foundry Platform unchanged. That
  window never reads or writes the Foundry Platform's page.

Rules new here:

- **The family name and the style list are checks, not copies.** The Foundry Platform reads
  both from the files. Fanwise shows what the files will say and whether the product agrees,
  so a mismatch is found before the upload rather than by the reviewer.
- **The licence price line is always shown.** A creator entering one number should see what
  buyers will be charged for six licence types at up to 200 users, and what half of it is.
  The full table is one click away and computed from the multipliers in §12.
- **The note to Foundry Support is composed from facts.** Fanwise offers one sentence per
  claimed exception (double-mapped capitals, an accessory style, rights to a name, permission
  for a derived design) and the creator keeps the ones that apply. No model writes it.
- **Returned is a state, not a failure.** Review sends most first submissions back with
  questions. The handoff shows the state, the creator fixes the product or the listing in
  Fanwise, and the same panel is the next attempt.

---

## 11. Data written

On build: a `channel_listings` row at `ready`, `status_source = self_reported`, the composed
description, tags and category, `price` and `currency = "USD"` holding the per-style base
price, and in `metadata`: `stylePriceUsd`, `stylePrices`, `familyPriceUsd`, `packs`,
`defaultDisplayStyleKey`, `fileFormat` (`otf` or `ttf`), `categoryLabel`, `supportNote`,
`releaseDate`; a `generated` snapshot; derivative rows for the 2:1 spec; `ai_generations`
rows with the FactSheet hash.

On approve in the review UI: a snapshot with `snapshot_type = approved`, `approved_at` set.

On mark submitted: status `published`, `status_source` unchanged, `external_url` **null**,
`published_at` set, `metadata.review = { state: "submitted", submittedAt }`, a `published`
snapshot, a `workspace_events` row. With no external reference the derived state is
`published_not_live`, which the UI words as **Submitted, in review**. This is the one new
thing the assisted machinery needs: on Creative Market and Behance a submitted listing is
live, and here it is not until a person in Monotype says so.

On the creator reporting the outcome:

- **Approved.** `external_url` is the family page URL, `external_listing_id` the family's
  slug parsed from it (URL shape and stability **[verify]**), `metadata.review.state =
  "approved"`, `metadata.review.liveAt`. Derived state `live`. A `workspace_events` row.
- **Returned.** Status back to `ready`, `metadata.review = { state: "returned", returnedAt,
  note }` with the reviewer's message as the creator pastes it, a `workspace_events` row.
  The `published` snapshot of what was submitted stays, immutable, and the next mark
  submitted writes another.
- **Rejected.** As returned, with `state: "rejected"`. Nothing is deleted.

`published` to `ready` is a transition the assisted status machine does not have today and
must gain for this channel, by human action only, never from a job.

Nothing in this flow may write a row another part of the system would read as verified. The
trigger that refuses `verified` on an assisted channel is untouched.

---

## 12. Prices, licences, royalties and the agreement

Facts the handoff and the requirements depend on, with their sources.

**The base price is the whole price table.** A foundry enters one USD price per style (and
one for the complete family, and optionally for packs). Every licence a buyer can choose is
that base price times a multiplier Monotype sets, and the foundry does not set the
multipliers:

| Licence | Basis | Multipliers, from the base price |
|---|---|---|
| Desktop | Users, perpetual | 1 user × 1.00, 2 × 1.60, 3 × 2.30, 5 × 3.60, 10 × 6.00, 20 × 11.50, 50 × 25.00, 100 × 45.00, 200 × 70.00 |
| Webfont | Pageviews per month, annual, one domain | 10,000 × 1, 25,000 × 2.5, 100,000 × 5, 250,000 × 10, 500,000 × 15, 1,000,000 × 20, 2,000,000 × 30 |
| App | Titles, annual | 1 × 17, 2 × 29, 3 × 43 |
| Electronic Doc (ePub) | Publications, annual | 1 × 2, 2 × 4, 4 × 8, 6 × 12, 8 × 16, 10 × 20, 12 × 24 |
| Digital Ad / Email | Impressions, annual | 250,000 × 1 up to 10,000,000 × 6; the article says these are not yet live on MyFonts **[verify]** |
| Server | Not published | **[verify]** |

Two consequences for Fanwise. First, the product's `metadata.font.licenses`, which prices
desktop, web, app and ePub separately with the creator's own limits, does not map to
anything here and is not sent; the handoff says so, because a creator who priced a web
licence at twice desktop will otherwise expect it to arrive. Second, whether a foundry can
switch a licence type off for a family, or attach its own EULA in place of Monotype's, is
**[verify]**; the articles offer Monotype's EULAs to foundries for use elsewhere and say
nothing about the reverse. Until answered, Fanwise's rule is that the family will be sold
under all of Monotype's licence types, and a product whose `license_summary` forbids app
embedding, say, gets a warning rather than a silent listing.

**Prices.** USD required. No published minimum or maximum; $0 families are refused, under $9
is discouraged and not marketed, $20 to $35 is Monotype's range for display and script
faces, $35 to $70 for professional families. A family sold elsewhere must be priced the
same or lower on MyFonts. Seven other currencies (GBP, EUR, JPY, CAD, AUD, NZD, BRL)
convert automatically from the USD price and each can be fixed by hand; v1 sends USD only.
VAT is added at checkout.

**The 45-day rule.** Prices cannot change for 45 days after release, for 45 days after a
price change, for 45 days after a promotion ends, or while a promotion runs; a promotion
lasts at most 45 days. Fanwise does not run promotions on any channel. A price edit in
Fanwise to a live MyFonts listing is copied across by hand like any assisted edit, and the
handoff's info rule names the window.

**Free fonts and demos.** No free families, and no family that is free anywhere else,
which Monotype checks at review. A demo cut down elsewhere is fine and Monotype recommends
listing the same demo on the family page. Personal-use licences are not offered on MyFonts
at all. One or two free styles inside a paid family are allowed and common.

**Royalties and payment.** 50% of the customer's price for sales on myfonts.com; 25% for
everything else the agreement covers (Monotype Fonts subscriptions, enterprise sales,
enforcement orders). No listing fee. MyFonts sales are paid monthly.

**The agreement.** One non-exclusive distribution agreement covering MyFonts, Monotype Fonts
and offline enterprise sales, with a mutual NDA and a non-solicit. Three clauses a Fanwise
creator should know before connecting, stated in the handoff's first-run text and not
enforced by Fanwise:

- **Release all your fonts with us.** A foundry in the programme makes all its publicly
  available fonts available through Monotype's channels. A creator who sells some families
  only on Creative Market is making a choice the agreement speaks to.
- **Modification rights.** Monotype may make non-design modifications (format conversion,
  subsetting, renaming, embedding settings) without asking, which is how it generates
  webfonts; design changes go to the foundry first. The foundry owns the modifications.
- **90 days' notice** of material business changes, including offering the fonts in a
  subscription.

**Updates after release.** Editing a released family reopens the four-step form; new or
replaced files are matched to existing styles by PostScript name, buyers see a link to the
updated files in their order history with a change note the foundry writes, and the edit is
reviewed within 24 hours. Deleting a style needs Foundry Support. A major revision can be a
new family with a new name, which is eligible for What's New again but leaves old buyers
without updates. Fanwise v1 has no update handoff for this channel; a changed listing is
copied across by hand.

**Sales data.** None by API. Earnings Reports on the Foundry Platform update hourly, filter
by month or date range and by foundry and by source, and export a spreadsheet delivered by
an emailed link. Rows carry no customer names or emails, by Monotype's policy. That
spreadsheet is B7's path, and its columns are **[verify]**.

---

## 13. Open questions to resolve from inside the Foundry Platform

Get a foundry account, open Submit a new font, and settle these before the adapter is
written. Each is a guess above until it is.

1. The category list in Step 3, by name, and whether more than one may be chosen.
2. Whether the description field renders any formatting, and its enforced maximum if the
   500 words is more than a recommendation.
3. Whether the tags control offers a dropdown vocabulary, whether an unknown tag is
   accepted, and what the banned-word list catches.
4. The number of sub-family packs: five per the upload article, three per the editing one.
5. Whether a licence type can be switched off per family, and whether a foundry may attach
   its own EULA.
6. Whether Monotype prefers OTF or TTF when a foundry has both, and whether a variable font
   with CFF2 outlines is accepted.
7. Whether the validator's character-set test is exactly the 186-glyph published list, and
   which of its other tests are red (blocking) rather than yellow.
8. The family page URL shape, whether it changes when the family name changes (the editing
   article says URLs remain the same), and whether the submission has an id of its own.
9. A PNG size limit, and whether the first image is the card image on list pages.
10. Whether the designer registry can be searched before submitting, so the handoff can say
    whether the name is there.
11. Whether the form's order in §10 is current, and whether the note to Foundry Support is a
    free-text field on the final page.
12. The columns of the Earnings Reports spreadsheet.
13. Whether the Digital Ad licence and a Server licence are live and how the latter is priced.
14. Whether a foundry's own storefront (Shopify, at a lower price) counts as "sold elsewhere"
    for the parity rule, which it plainly does on a literal reading.

Record the answers in this file as they are settled, and drop the **[verify]** markers.

---

## 14. What this channel is not

- **Not Monotype Fonts.** Signing the agreement places the foundry's fonts in Monotype's
  subscription product for agencies and enterprises, paid at 25% under a proxy-based royalty
  model. That is a consequence of connecting MyFonts, stated in the handoff's first-run
  text, not a channel Fanwise models.
- **Not Fonts.com, Linotype or FontShop.** Monotype announced on 30 August 2023 that those
  storefronts would be retired into MyFonts.com. A creator with legacy earnings there sees
  them in the same Earnings Reports, filtered by source.
- **Not the Monotype Fonts REST API.** That serves webfonts to licensees. It creates nothing
  and is not a foundry pipeline.
- **Not bundles or promotions.** Bundles are a separate product of 35 to 50 fonts from at
  least two families; promotions are governed by the 45-day rule. Both are foundry-level
  merchandising with no product to map, and out of scope.
- **Not a place Fanwise holds a credential.** No login, no token, no session. The companion
  window sits beside the Foundry Platform and never touches it.
