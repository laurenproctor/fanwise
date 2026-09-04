# Channel spec: Creative Market

The first channel to build and test end to end. Complete enough to implement from.
Verified against Creative Market seller documentation, September 2026. Items marked
**[verify]** could not be confirmed from published docs and need checking against a live
shop.

---

## 1. Why this channel first

Creative Market is the right first test for four reasons, and the fourth is the one that
matters.

- **No approval blocks the build.** No API key, no OAuth app, no commercial access review.
  Work can start today.
- **No per-product review.** Creative Market states plainly that it does not review each
  item, and saved products "go live instantly." Every other assisted channel has a queue of
  a day or more. Here the feedback loop closes in one sitting.
- **It is the archetype.** Eight of the candidate channels are assisted. Whatever handoff
  pattern works here is the pattern for all of them, and the adapter contract gets exercised
  by a real case rather than a mock.
- **Its category-drives-license rule is genuinely hard.** Selecting Fonts versus Templates
  does not change a few numbers, it swaps the entire license and price schema. That forces
  the requirements engine and the canonical-to-listing mapping to be properly general on the
  very first channel, which is exactly what you want before Shopify and Etsy arrive and
  tempt you into shortcuts.

Run the Etsy commercial API application **in parallel, starting now**, since its approval
has no published SLA and applicants report waiting weeks. This test does not depend on it,
which is the point.

---

## 2. What the test proves

**Hypothesis:** a creator with a real product will accept a Fanwise-composed listing and
publish it substantially unchanged.

That is the whole company in one sentence. If they rewrite everything, Fanwise is a file
converter. If they paste and publish, Fanwise is the catalog.

Test protocol and success criteria are in section 12.

---

## 3. Adapter definition

```ts
export const creativeMarket: ChannelAdapter = {
  key: "creative_market",
  integrationType: "assisted",
  capabilities: {
    automaticPublish: false,
    automaticUpdate: false,
    metrics: false,
    transactions: false,   // CSV import only
    digitalFileUpload: false,
    imageUpload: false,
    drafts: true,          // Creative Market's own Draft state, set by the seller
  },
  getRequirements,
  validateProduct,
  buildListing,
  // no publish, update, unpublish, sync, fetchMetrics, fetchTransactions
}
```

`publish` is deliberately absent. The UI must never offer it, and `channel_listings.status`
for this channel moves `draft → ready → self_reported_published` by human action, with
`status_source = "self_reported"` on every row.

---

## 4. Category and license schema

This is the part to get right first, because everything else depends on it. Category is
selected before anything else and determines the license structure, the price floors, and
the file rules.

Three structurally different shapes:

**Shape A: standard tiers.** Applies to Templates, Graphics, Photos, Illustrations, Icons,
Mockups, Brushes & More, Add-ons, 3D.

| License | Scope |
|---|---|
| Personal | Non-commercial use |
| Commercial | Up to 5,000 end products |
| Extended Commercial | Up to 250,000 end products |

**Shape B: fonts.** Four license *types*, not tiers, priced separately, and priced
differently again for a family versus an individual weight.

| License type | Family | Individual weight |
|---|---|---|
| Desktop & Webfont (Tier 1) | $15 | $12 |
| E-Pub | $23 | $18 |
| App | $72 | $72 |

**Shape C: WordPress themes.** Exactly one option, GPL 2.0. No tier selection at all.

**Price floors for Shape A**, Personal / Commercial / Extended Commercial, in USD:

| Category | Personal | Commercial | Extended |
|---|---|---|---|
| Templates | $9 | $14 | $36 |
| Graphics | $6 | $9 | $24 |
| Add-ons | $9 | $14 | $36 |
| Photos | $3 | $4 | $5 |
| Themes | $19 | $29 | $76 |
| 3D | $19 | $29 | $76 |

Products must be listed at or above the floor for their category and license type. The
editor shows suggested prices from category averages, which are suggestions only.

Maximum price, price increments, and whether a seller can disable individual license tiers
are all **[verify]**. The Buybox FAQ suggests adding a note in the description as a
workaround for unwanted tiers, which implies tiers cannot be switched off.

**Mixed content rule:** a font-categorized product containing graphics grants the chosen
font license plus a Commercial License on the graphics. A non-font product containing fonts
grants the chosen tier plus a Desktop License on the fonts. Fanwise should state this in the
handoff so the creator is not surprised.

Top-level categories: Fonts, Templates & Themes, Graphics, Photos, Illustrations, Icons,
Mockups, Brushes & More, 3D. The full subcategory tree is not published **[verify]**, so v1
should let the creator pick the subcategory in Creative Market and record what they chose.

---

## 5. Canonical product to listing field map

| Creative Market field | Source | Transform | Notes |
|---|---|---|---|
| Category | `product.product_type` | Mapping table, creator confirms | Locked first. Drives everything below. |
| Product name | `product.canonical_title` | AI rewrite to CM profile | No published character limit **[verify]**. House rule: 60 chars, no shop name, no promo language, must read sensibly off-platform. |
| Description | `product.canonical_description` | AI rewrite, then markdown restriction | Minimum 10 words. See section 6. |
| Tags | `product.metadata` + AI | 5 to 10, deduplicated | Free-form. No controlled list, no published cap **[verify]**. Reject near-duplicates and tags not evidenced by the FactSheet. |
| Price per license | `product.base_price` | Floor check per section 4 | Never emit a price below the floor. If the canonical price is lower, flag it as an error, do not silently raise it. |
| Product file | `product_assets` where `asset_type = deliverable` | Package build, section 7 | |
| Screenshots | `product_assets` where `asset_type in (preview_image, specimen)` | Derivative build, section 8 | |
| Attachments | `product_assets` where `asset_type in (documentation, license)` | Pass through into the zip | Optional. README, PDF, TXT. |

---

## 6. Description transform

Creative Market accepts a narrow markdown subset, and nothing else. The transform must
**strip** anything outside it rather than passing it through, because unsupported syntax
renders as literal characters on the product page.

Permitted:

- `*italic*`
- `**bold**`
- Unordered lists with `*` or `-`
- `---` horizontal rule
- Line break via two or more trailing spaces

Not permitted, and therefore stripped or converted: headings, tables, links, images, code
fences, blockquotes, ordered lists. Convert headings to bold lines. Convert ordered lists to
unordered. Strip links to their text.

Minimum 10 words. No published maximum **[verify]**.

Content prohibitions are **[verify]** for links, prices and contact information, which
Creative Market does not publish. Two published requirements do apply: third-party assets a
buyer must download separately have to be disclosed, and the description must not
misrepresent what is delivered.

---

## 7. Package spec

- **Format: .zip.** `.rar` and `.7z` risk removal.
- **Maximum 4 GB.** Under 4 GB the file must be hosted on Creative Market, external hosting
  is not permitted. Only products over 4 GB may be externally hosted, and only with immediate
  delivery and close support.
- Folder structure expectations are **[verify]**, as is whether Creative Market parses the
  zip to build a buyer-facing manifest. The product page shows a Product Specs sidebar, but
  it is not documented as auto-generated. Assume the creator enters specs by hand and give
  them the values.

**Fonts specifically:**

- OTF or TTF only. Listing in Fonts implies to buyers that the product is installable.
- EPS or AI letter sets are explicitly not fonts and must not go in the Fonts category. The
  requirements engine should catch this from the canonical product's file types and block it.
- A license file inside the zip is not required, but README, PDF and TXT files are supported
  as attachments and Fanwise should include one by default.

---

## 8. Image derivative spec

| Property | Value |
|---|---|
| Minimum count | 1 per the editor; the PDP quality guide says most categories want at least 2. Fanwise should require **3**. |
| Maximum count | 100 |
| Minimum dimensions | 910 × 607 px |
| Recommended | 1820 × 1214 px |
| Maximum | 3640 × 10920 px |
| Aspect | 3:2 implied by the recommended size, never stated as a rule |
| Formats | JPG, PNG, GIF |
| File size | Under 5 MB recommended, no published hard cap |

**Build target: 1820 × 1214 JPG, quality tuned to land under 5 MB.**

Cover image designation, focal point and crop controls are **[verify]** and the relevant
FAQ is login-gated. Observed behavior suggests the first screenshot becomes the thumbnail
and ordering is the only control, so Fanwise must emit images in a deliberate order with
numeric filename prefixes (`01-`, `02-`), which also survives the Bulk Editor's
sort-by-filename behavior.

Published content guidance: show the product in real-world context, consistent backgrounds,
consistent sizing, crisp resolution. One enforceable rule: **no visible trademarks anywhere
in the product**. Watermark and mockup rules are **[verify]**.

Derivative caching keys on source checksum plus spec hash, per the architecture doc, so
re-running a build costs nothing.

---

## 9. Requirements engine

Deterministic checks, in the order they should be evaluated. Every one of these is checkable
without calling Creative Market.

```
error   category_selected          A category is chosen and mapped
error   category_matches_files     Fonts category implies OTF/TTF present; EPS/AI letter set blocks it
error   package_format             Deliverable is .zip
error   package_size               Package under 4 GB
error   title_present              Title exists, under the house limit, no shop name
error   description_min_words      At least 10 words after markdown stripping
error   description_markdown_safe  No syntax outside the permitted subset survives
error   images_min                 At least 3 derivatives built
error   image_dimensions           Every image at least 910 x 607, at most 3640 x 10920
error   image_format               JPG, PNG or GIF only
error   price_floor                Every license price at or above its floor
warning image_size                 Any image over 5 MB
warning tag_count                  Fewer than 5 or more than 10 tags
warning tag_quality                Near-duplicate tags, or tags unsupported by the FactSheet
warning font_license_file          Fonts product with no license attachment
info    mixed_content_license      Fonts product containing graphics, or vice versa
```

Readiness percentage is errors resolved over errors total. No AI scoring anywhere near this.

---

## 10. The handoff screen

Ordered to match Creative Market's own editor sequence exactly, so the creator moves top to
bottom in both windows without hunting. Their documented order is: category, files, name,
description, screenshots, prices, tags, set Live, Save all Changes.

```
CREATIVE MARKET SUBMISSION            Aster Grotesk

  Open Creative Market  ↗              Readiness  11/11

  1  Category
     Fonts › Sans Serif                              [copy]
     Locked first. This sets the license and price structure.

  2  Product files
     aster-grotesk-cm.zip  ·  68 MB    [download]
     Contains 14 OTF, 14 TTF, README.txt, license.pdf

  3  Product name
     Aster Grotesk Variable Sans Family              [copy]

  4  Description
     [ rendered preview of the CM-safe markdown ]    [copy]
     176 words · markdown restricted to CM's subset

  5  Screenshots
     8 images, 1820 × 1214           [download all]
     01-specimen  02-waterfall  03-in-use  …
     Upload in filename order. The first becomes the thumbnail.

  6  Prices
     Desktop & Webfont (family)   $15               [copy]
     E-Pub (family)               $23               [copy]
     App (family)                 $72               [copy]
     All at or above Creative Market's floors.

  7  Tags
     grotesque, sans serif, variable font, editorial,
     display, type family, modern sans, headline      [copy]

  8  Set the product Live, then Save all Changes.

  ─────────────────────────────────────────────────
  Done?   [ Mark submitted ]   Listing URL [___________]
```

Design rules that make this work:

- Each copy button holds a "copied" state until the next one is used, so the creator can see
  their position in the sequence.
- Downloads are inline at the step that needs them, not collected at the top.
- Nothing here says "publish" or implies Fanwise did anything on Creative Market.
- The final step captures the listing URL. That URL is what links the live listing back to
  the canonical product, and without it there is no analytics story later.

---

## 11. Data written

On build:

- `channel_listings` row: status `ready`, `status_source` `self_reported`, generated title,
  description, tags, price map, category.
- `listing_snapshots` row: `snapshot_type` `generated`, full payload.
- `product_assets` rows for each derivative, with `derived_from` pointing at the source.
- `ai_generations` row per generated field, with the FactSheet hash.

On approve: `listing_snapshots` with `snapshot_type` `approved`, `approved_at` set.

On mark submitted: status `published`, `status_source` stays `self_reported`,
`external_url` captured, `published_at` set, `listing_snapshots` with `snapshot_type`
`published`, `workspace_events` row.

Nothing in this flow may write a row that another part of the system would read as verified.

---

## 12. Test protocol

**Who:** three creators who already sell on Creative Market and have at least ten products.
Not friends who will be kind. Ideally one font designer, one template designer, one graphics
seller, since the license schema differs across all three.

**Task:** bring one product they have not yet listed. Go from empty Fanwise workspace to a
live Creative Market listing. No help, screen recorded, thinking aloud.

**Measure:**

| Metric | Target |
|---|---|
| Time from first upload to live listing | Under 15 minutes |
| Fields materially rewritten before submit | Fewer than 3 of 8 |
| Screenshots used as built, without re-export | At least 6 of 8 |
| Listing still live and unedited at 7 days | All 3 |
| Would they list their next product this way | All 3, unprompted |

**The real signal is the 7-day check.** Publishing under observation proves nothing. A
listing they left alone for a week is a listing they endorsed.

**Failure modes to watch for, and what each means:**

- They rewrite the description entirely → the merchandising profile is wrong, not the
  product. Fixable.
- They re-export the screenshots → the derivative pipeline is the problem, which is a deeper
  issue because that is the hardest part to fake and the most valuable to get right.
- They get lost between windows → the handoff order is wrong. Cheap fix, and exactly what
  this test is for.
- They say "this is nice but I would only use it for a new marketplace, not Creative Market
  where I already have a workflow" → the wedge is wrong, and the product should lead with
  channels the creator does not yet sell on. That is a strategy finding worth more than the
  build.

---

## 13. Open questions to resolve against a live shop

Log in once with a real seller account and settle these. Each one is currently a guess in
the spec above.

1. Title character limit.
2. Description maximum length, and whether links, prices or contact details are rejected.
3. Tag minimum, maximum, and per-tag character limit.
4. The full subcategory tree, and whether more than one category can be selected.
5. Maximum price and permitted increments.
6. Whether individual license tiers can be disabled per product.
7. Whether a cover image can be designated, and whether focal point or crop controls exist.
   The Product Screenshots FAQ is login-gated and probably answers this.
8. Whether Creative Market parses the zip to build the buyer-facing file manifest, or
   whether the seller types the Product Specs by hand.
9. Folder structure conventions inside the zip that experienced sellers follow.
10. Whether the Bulk Editor accepts anything that could serve as a structured import path.

Record the answers in this file as they are settled, and drop the **[verify]** markers.
