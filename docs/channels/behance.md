# Channel spec: Behance

The second assisted channel, and the first whose unit is not a product. Written on
11 September 2026 against Behance's seller help center, the Behance Product Specific Terms
(18 June 2024), the Adobe General Terms of Use (3 October 2025) and the Behance Community
Guidelines. Planned as B9 and not built; the roadmap's B9 section says what it waits on.
Items marked **[verify]** could not be confirmed from published documentation and need
checking from inside a profile with a payment account connected, which is decision 26 in
`docs/decisions/0002`.

The assessment that preceded this is in `docs/channel-feasibility.md`. Read it first for why
the channel is assisted and why that will not change: Behance's only API is read-only and no
longer issues keys, and Adobe's terms close the browser-automation fallback in writing.

---

## 1. Why this channel, and why not yet

- **Nothing gates it.** No application, no seller review, no developer account, no
  commercial access. A Behance profile and a Stripe account connected to it. After Creative
  Market it is the cheapest assisted channel in the set to reach.
- **No pre-publication review is documented.** An asset lists when its project is published
  or updated. Moderation is after the fact: assets that break the Community Guidelines are
  removed, and adult content is refused as an asset outright. The feedback loop closes in
  one sitting, as it does on Creative Market.
- **It is a different shape, and that is the point.** Creative Market's editor is a product
  form. Behance's unit is a **Project**, a portfolio piece with a cover, a title, creative
  fields and a canvas of images, and the sellable file is an **Asset** attached to it.
  Fanwise has to compose a portfolio piece around the product rather than fill in a
  product form. If the A8 handoff pattern survives that, it generalizes; if it does not,
  better to learn on the second assisted channel than the fifth.
- **The audience is the pitch.** Behance's own figure is 40 million members, and the creator
  Fanwise is for very likely already has a profile there with the product's specimen
  images on it. The marketplace is a tab on a page they already maintain.

**Why not before A8.** A8 builds the assisted machinery: the package build, the handoff
screen, mark submitted, URL capture, and the `self_reported` discipline around all of it.
Behance reuses every piece. Building that twice is the failure the adapter contract exists
to prevent, so B9 opens after A8 closes and not before.

**Why not as B4.** Decision 14 chooses B4 between Adobe Stock and MyFonts, and both were
chosen as candidates because their metadata burden is heavy and exact, which is where
assisted preparation earns its price. Behance's metadata burden is light. What it tests is
the project-shaped handoff, and what it is worth is reach, so it takes its own step rather
than competing for that slot.

---

## 2. What the step proves

A creator carries one real product through the handoff to a live Behance project with the
asset marked For Sale, without composing anything outside Fanwise. The project URL is
captured. Every row reads `status_source = self_reported`. No surface anywhere offers
Publish for this channel.

The composed-listing hypothesis in `docs/channels/creative-market.md` §2 is not re-run
here. B9 comes after B1 and B2, so the copy is AI-composed, but the three-creator test
belongs to B2a and its findings carry across; B9's exit is about the mechanics of a
project-shaped handoff.

---

## 3. Adapter definition

```ts
export const behance: ChannelAdapter = {
  key: "behance",
  integrationType: "assisted",
  capabilities: {
    automaticPublish: false,   // the provider cannot: no write API, and the terms forbid the alternative
    automaticUpdate: false,    // same
    metrics: false,            // the provider cannot: Pro Stats is a page, not an API
    transactions: false,       // the provider cannot: sales live in the seller's own Stripe
    digitalFileUpload: false,  // the provider cannot
    imageUpload: false,        // the provider cannot
    drafts: true,              // Save keeps a project as a Draft, set by the seller
  },
  getRequirements,
  validateProduct,
  buildListing,
  // no publish, update, unpublish, sync, fetchMetrics, fetchTransactions
  // no oauth member: there is nothing to authorize against
}
```

Every `false` above is the first of the two reasons `docs/channel-adapters.md` names, the
permanent one: the provider cannot. None is a step Fanwise has not reached.

There is no `oauth` member, so Connect writes a row and starts no flow. The account hint is
the profile URL or username, parsed against `behance.net/{username}`, and it is stored as
`external_account_id`. No credential of any kind is held for this channel.

---

## 4. The project and the asset

Two objects, and Fanwise must be clear which fields belong to which.

**A Project** is the portfolio piece. To publish one, Behance requires a cover image, a
title and at least one Creative Field. It also carries up to 10 project tags, a Tools Used
list, a description (behind "Co-owners, Credits, and More"), a copyright and license
setting, and a canvas of content modules: images, text, embeds. Save keeps it as a Draft;
Publish makes it public; a published project is edited and re-published with Update.
Scheduled publishing exists and is a Behance Pro feature.

**An Asset** is a downloadable file attached to a project from the editor's Attach Assets
control. Its form has seven fields, in this order: cover image, file name, category (one of
five in a dropdown), license type, description, pricing, and up to 20 example images. A
project holds at most **5 assets**, paid and free together, each up to **500 MB**, in any of
"over 25" file types including JPG, PNG, SVG, PSD, AI, PDF, TTF and ZIP. Pricing is one of
Free, For Sale, or subscribers only; For Sale requires a connected Stripe account, and the
fees are computed on the form as the price is typed. The asset lists when the project is
published or updated, and is edited or deleted from the project editor or from the profile's
Assets tab.

**What Fanwise maps.** One product becomes one project carrying one asset. That is the v1
rule, chosen so the requirements are checkable and the handoff is one sequence. Two things
it deliberately leaves for §13: a creator who already has a specimen project for the product
and wants the asset attached to it rather than a new project built, and a product that
would sell better as several assets on one project, which is how Behance would let a font
family price its desktop, web and variable packages separately.

The handoff therefore has two modes, and the creator picks at the top of the screen:

- **New project**, the default. Fanwise emits the whole project and the asset.
- **Existing project.** The creator pastes the project URL and Fanwise emits only the asset
  block. Readiness for the project fields is skipped, not faked; the screen says the project
  is theirs and Fanwise is not checking it.

---

## 5. Canonical product to listing field map

Project fields:

| Behance field | Source | Transform | Notes |
|---|---|---|---|
| Cover image | `cover_image` asset | Derivative, §8 | Required to publish. Minimum 808 × 632, cropped by Behance to 202 × 158 |
| Project title | `canonical_title` | AI rewrite to the Behance profile | Required. 80 characters per a secondary source **[verify]**. House rule: 60 |
| Creative Fields | `product_type` | Mapping table, creator confirms | At least one required. The list is Behance's and fixed; the mapping lives in the adapter, §9 |
| Project tags | `tags` | Deduplicated, at most 10 | Optional on Behance. Fanwise emits 5 to 10 |
| Tools Used | product `metadata` | Pass through where known | Optional. Also where Behance asks generative-AI work to be labelled, see decision 24 |
| Project description | `canonical_description` | Plain text, §6 | Optional on Behance. Fanwise always emits one |
| Project content | `preview_image` and `specimen` assets | Derivatives, §8, in order | The canvas. Fanwise emits images only in v1; the creator may add text modules |
| Copyright & license | nothing | | Behance's project-level Creative Commons setting. Left at the profile default; not the asset license |

Asset fields:

| Behance field | Source | Transform | Notes |
|---|---|---|---|
| Cover image | `cover_image` asset | Same derivative as the project cover | Assumed to share the project cover spec **[verify]** |
| File name | the package filename | §7 | Shown to buyers as the thing they get. Fanwise names it deliberately |
| Category | `product_type` | Mapping table, creator confirms | One of five options whose names are not published **[verify]**; the marketplace navigation shows fonts, templates, illustrations, icons, mockups, vectors and photos, which is more than five |
| License type | creator's choice, recommended from `license_summary` | Pass through | Two fixed options, §12. Fanwise recommends and records; it never invents a license the product does not grant |
| Description | `short_description`, falling back to `canonical_description` | Plain text, §6 | Length limit **[verify]** |
| Pricing | `base_price` | Currency check, fee arithmetic shown, §12 | For Sale. Fanwise never nets the fee out of the price silently |
| Example images | `preview_image` assets | Derivatives, §8, at most 20 | Optional. Fanwise emits at least 3 |
| Generative AI disclosure | `products`, field owed by decision 24 | Pass through into Tools Used and the description | Behance encourages labelling and supports Content Credentials; it does not document a required field **[verify]** |

---

## 6. Description transform

Both descriptions are plain text as far as the published guidance goes. Whether either
field renders any formatting is **[verify]**; assume none, and emit paragraphs separated by
blank lines with no Markdown. Links are permitted on a project canvas, in a text module,
which is what Behance told sellers to use when it discontinued linked assets on
16 October 2023; whether they are permitted in the asset description is **[verify]**.

Content rules that do apply: the work must be the seller's own, the file must not be adult
or mature content, and nothing may misrepresent what the buyer receives. Nothing published
forbids prices or contact details in the copy.

---

## 7. Package spec

- **One file per asset**, up to 500 MB. A product delivered as several files ships as one
  zip, which is on the accepted list. TTF is on the published list and OTF is not among the
  examples; whether a bare OTF is accepted is **[verify]**, and inside a zip it is moot.
- **The file name is a buyer-facing field.** Fanwise names the package
  `{product-slug}-behance.zip` and states the contents in the description, because Behance
  publishes no manifest and the buyer sees the name before the purchase.
- **Five assets per project** is the cap. v1 uses one.
- The Creative Market package (`docs/channels/creative-market.md` §7) is reusable as is
  where the product already has one: same zip, same README and license attachments inside,
  under the Behance size limit rather than Creative Market's 4 GB.

---

## 8. Image derivative spec

Two specs, and the second is new to Fanwise.

**Project and asset cover.** Minimum 808 × 632, displayed at 202 × 158, so the ratio is
1.278:1 and nothing else in the catalog shares it. JPEG or PNG; GIF is refused for covers.
Behance crops with a slider at upload, so Fanwise builds the cover already cropped to the
ratio and the creator's only action is to accept. **Build target: 1616 × 1264 JPEG, sRGB.**

**Project and example images.** Behance displays project images at 1400 wide and up to 2800
in the lightbox; it recommends 2800 wide or smaller and under 10 MB, refuses anything over
50 MB, refuses PDF as project content, and converts CMYK to RGB with visible shifts. **Build
target: 2800 wide JPEG, sRGB, quality tuned to land under 10 MB**, emitted with numeric
filename prefixes (`01-`, `02-`) so the canvas order is the order Fanwise chose. Example
images on the asset are assumed to take the same spec **[verify]**; the count cap is 20.

Neither spec is Creative Market's 3:2 nor Etsy's 2000-pixel long edge, so this channel adds
two rows to the derivative service. Derivatives key on source checksum plus spec hash, per
`docs/architecture.md`, so the cost of a second build of the same source is nothing.

---

## 9. Requirements engine

Deterministic, synchronous, and checkable without Behance. Evaluated in this order.

```
error   creative_field_mapped       product_type maps to at least one Creative Field, confirmed
error   category_mapped             product_type maps to an asset category, confirmed
error   license_selected            Personal or Standard Commercial is chosen
error   title_present               Title exists, 3 to 60 characters, no shop name
error   price_present               Price set, above Stripe's minimum charge, §12
error   package_single_file         Exactly one deliverable file after the package build
error   package_size                Under 500 MB
error   package_type                Extension on the accepted list, or the package is a zip
error   cover_image_built           Cover derivative exists at 808 x 632 or larger, JPEG or PNG
error   images_min                  At least 3 project image derivatives built
error   image_width                 Every image at most 2800 wide
error   image_size_max              Every image under 50 MB
error   image_format                JPEG or PNG only; GIF never for the cover
warning image_size                  Any image over 10 MB
warning description_min             Fewer than 40 characters of description
warning tag_count                   Fewer than 5 tags; more than 10 is an error on Behance's side, so 10 is a hard cap in the tags rule
warning example_images_min          Fewer than 3 example images on the asset
warning ai_tools_untagged           AI disclosure is yes on the product and Tools Used names no generative tool
info    net_proceeds                The fee arithmetic in §12, at the listed price
info    payment_country             Behance sells through Stripe in 40 countries and PayPal in others, §12
```

The mapping tables for `creative_field_mapped` and `category_mapped` live in the adapter,
never in the product enum, per `docs/data-model.md`. Behance's Creative Fields are its own
fixed list, of which the marketplace page today surfaces Graphic Design, Illustration,
Typography, Type Design, Icon Design, Product Design, 3D Modeling, Photography, Branding and
others; the full list and the five asset categories are the first things to record from
inside a profile.

Readiness is errors resolved over errors total. Nothing here calls a model.

---

## 10. The handoff screen

Ordered to Behance's own editor sequence, which runs: create the project, add content,
Attach Assets (cover, file name, category, license, description, pricing, example images,
Add Asset), Continue, cover crop and title and Creative Fields and tags and Tools Used,
then Co-owners, Credits and More for the description, then Publish. The handoff follows
that order so the creator moves top to bottom in both windows. Whether the current editor
still runs in this order is **[verify]**.

```
BEHANCE SUBMISSION                    Aster Grotesk

  Open Behance  ↗                     Readiness  13/13

  ( ) New project    ( ) Existing project  behance.net/gallery/__________

  1  Project images
     8 images, 2800 wide            [download all]
     01-specimen  02-waterfall  03-in-use  …
     Upload in filename order onto the canvas.

  2  Attach Assets
     Cover           aster-grotesk-cover.jpg   [download]
     File name       aster-grotesk-behance.zip [copy]   68 MB  [download]
     Category        Fonts                                   [copy]
     License         Standard Commercial
     Description     [ plain-text preview ]                 [copy]
     Price           $24
                     Behance keeps $7.20 and Stripe about $1.00.
                     You receive about $15.80. Behance Pro waives the $7.20.
     Example images  6 images                          [download all]
     Click Add Asset, then Done.

  3  Project settings
     Cover           same file as above, accept the crop
     Title           Aster Grotesk Variable Sans Family      [copy]
     Creative Fields Typography, Type Design               [copy]
     Tags            grotesque, sans serif, variable font,
                     editorial, display, type family         [copy]
     Tools Used      Glyphs                                  [copy]

  4  Co-owners, Credits, and More
     Description     [ plain-text preview ]                 [copy]

  5  Publish.

  ─────────────────────────────────────────────────
  Done?   [ Mark submitted ]   Project URL [___________]
```

Design rules, inherited from Creative Market's handoff and unchanged:

- Each copy button holds a "copied" state until the next one is used.
- Downloads sit at the step that needs them.
- Nothing says "publish" or implies Fanwise did anything on Behance.
- The final step captures the project URL, which is the only handle Fanwise will ever have
  on this listing.

Two rules new here:

- **The fee line is always shown.** A Behance seller who is not on Behance Pro receives
  about two thirds of the price. Fanwise shows the arithmetic beside the price rather than
  letting the creator find out in Stripe.
- **Existing-project mode hides steps 1, 3 and 4** and says so, rather than showing them
  greyed out. Fanwise did not compose that project and should not look as if it had.

---

## 11. Data written

Identical in shape to `docs/channels/creative-market.md` §11. On build: `channel_listings`
at `ready`, `status_source = self_reported`, the composed title, description, tags, the
chosen creative fields, category and license in `metadata`; a `generated` snapshot;
derivative rows for both image specs; `ai_generations` rows with the FactSheet hash. On mark
submitted: status `published`, `status_source` unchanged, `external_url` the project URL,
`external_listing_id` the numeric project id parsed from it (`behance.net/gallery/{id}/{slug}`;
whether the id is stable across edits is **[verify]**), `published_at`, a `published`
snapshot, a `workspace_events` row. `metadata.handoffMode` records `new` or `existing`.

Nothing in this flow may write a row another part of the system would read as verified.

---

## 12. Fees, licenses and eligibility

Facts the handoff and the requirements depend on, with their sources.

**Fees.** No fee to list. On each sale Behance takes a **30% platform fee** plus the
processor's fee, **2.9% + $0.30** on Stripe or PayPal's location-based rate. The platform fee
is waived for **Behance Pro** subscribers, from **$9.99 a month** on an annual commitment
and varying by region; Pro is available to personal profiles only. The terms let Behance
change or waive the fee at its discretion. Refunds are issued from the seller's Stripe
dashboard and are not reflected on Behance.

**Licenses.** Two, fixed by Behance, and the seller picks one per asset:

| License | Grants |
|---|---|
| Personal | Non-exclusive use in personal, non-commercial projects |
| Standard Commercial | Personal use plus up to 5,000 physical products for sale, up to 5,000 print, advertising and decorative uses, unlimited web, app and social use. Excludes broadcast and streaming distribution |

Both forbid resale, standalone use, and use in registered marks. There is no extended tier,
no per-category schema and no price floor, which is why this channel's license mapping is a
choice and not a table. A product whose `license_summary` grants less than Standard
Commercial must not be recommended Standard Commercial; the adapter recommends Personal and
says why.

**Pricing.** Set per asset, For Sale, in the seller's Stripe currency **[verify]**. No
published minimum or maximum; Stripe's own minimum charge is $0.50, which is the floor the
requirement uses until a real one is observed. Subscribers-only pricing is out of scope.

**Eligibility.** A Behance profile with a payment account connected. Stripe is available in
40 countries approved by both Stripe and Behance; six others that Stripe serves (Brazil,
India, Indonesia, Malaysia, Mexico, Thailand) cannot collect the platform fee and are
routed to PayPal, as are the other PayPal-only countries on Behance's list. Adobe ID
location, login location and bank location must agree or signup fails. Behance Pro and its
fee waiver are not available to Enterprise or Team accounts.

**Sales data.** None from Behance. The Assets tab shows asset earnings only; everything else
is the seller's Stripe dashboard. That dashboard exports CSV, which is B7's path, and it is
the seller's own Stripe account, so a read-only connection to it is a conceivable later
source that is not planned.

---

## 13. Open questions to resolve from inside a profile

Get a profile with Stripe connected (decision 26), attach one asset to one draft project,
and settle these. Each is a guess above until it is.

1. The five asset categories in the dropdown, by name, and how they relate to the
   marketplace's navigation, which shows more than five.
2. The full Creative Fields list, and whether more than a handful may be selected.
3. Project title, project description and asset description length limits.
4. Whether either description field renders formatting, and whether links are permitted in
   the asset description.
5. Whether the asset cover takes the project cover's 808 × 632 minimum, and what spec the
   example images take.
6. Whether an OTF file is accepted bare, and the complete accepted-type list.
7. Minimum and maximum price, the currency the price is entered in, and whether it can be
   changed after the first sale.
8. Whether the project id in the URL is stable across edits and slug changes, and whether
   an asset has a URL of its own.
9. Whether the editor's sequence in §10 is current, and where Attach Assets sits in it.
10. Whether a generative-AI disclosure field exists on the asset or project form, or whether
    Tools Used is the only place to say so.
11. Whether a published project with a For Sale asset is visible on the marketplace
    immediately or after any delay.
12. Whether one product would be better served by several assets on one project, and what
    that does to the one-product-one-listing rule in `docs/data-model.md`.

Record the answers in this file as they are settled, and drop the **[verify]** markers.

---

## 14. What this channel is not

- **Not Adobe Stock.** Behance can display a contributor's Adobe Stock assets on a profile
  tab, synced one way from Stock; that is a portfolio feature, not a sales channel, and it
  does not touch the Behance marketplace. Adobe Stock remains a B4 candidate under decision
  14 with its own spec to write.
- **Not an API channel, and never one on present terms.** Behance's v2 API is read-only,
  new keys are not issued, and the Product Specific Terms license it for non-commercial use
  only. See `docs/channel-feasibility.md`.
- **Not a place Fanwise holds a credential.** No OAuth, no token, no password. The
  Community Guidelines' "Be Authentic" section and §5.1 of Adobe's General Terms both forbid
  the only alternative.
- **Not subscriptions or livestreams.** Behance's other paid offerings are out of scope.
