# Channel spec: Fontspring

The second font marketplace, and the one whose licence model is the font workspace's own.
Written on 17 September 2026 against Fontspring's *Become a Fontspring Foundry* page (the
live page answers 403 to fetchers; read from the Wayback Machine's capture of 31 August
2025), the Terms of Service (capture of 1 January 2026), the *Worry-Free Font Licenses*
page, the five articles in the help center's Foundry & Affiliate Support category
(*Commission and Sales*, updated 14 September 2026; *Tax & Payout Guide*, 3 July 2025;
*Adding a Promotion*, 23 October 2024; *Withholding Rates for Royalties* and *What Payment
Methods are Accepted in my Country?*, both 30 October 2024), the buyer-side articles *Pageviews
FAQ*, *What is a User?*, *Guide to Demo Fonts* and *OTF or TTF*, the *Site Content
Guidelines* (3 July 2025), Dribbble's acquisition release of 1 February 2022, and the
TypeDrawers thread on the November 2022 redesign. Not built. Items marked **[verify]** could
not be settled from those sources and need a logged-in look at the vendor tools, which needs
a foundry account: see §1.

`docs/channel-feasibility.md` carries the short assessment. Read it first for why the channel
is assisted and why that will not change: there is no API, no FTP and no documented upload
format, the only public foundry documentation is five help articles about money and
promotions, and the Terms of Service are Creative Market's, with the same two clauses that
closed browser automation and credential sharing for A8. Fanwise never holds a Fontspring
credential and never touches its pages.

`docs/channels/myfonts.md` (PR #118) is this spec's sibling. Where the two channels ask for
the same thing this file says so and does not repeat the reasoning; where they differ, the
difference is the point.

---

## 1. Why this channel, and what it waits on

- **It is the font marketplace that takes the creator's own licence.** Fontspring's
  foundry page: "You have control over licensing fees for both desktop and additional
  licenses. And you can use your license or ours. It doesn't matter." The font workspace
  (`lib/fonts`, merged 14 September 2026) prices desktop, web, app and ePub separately with
  the creator's own limits in `metadata.font.licenses`. On MyFonts that structure maps to
  nothing, because every licence there is Monotype's own at a multiple of one base price
  (`docs/channels/myfonts.md` §12). On Fontspring it maps one to one. This is the channel
  where the licence work a creator did in Fanwise is the listing.
- **The Worry-Free badge is a deterministic check Fanwise can run first.** Fontspring
  badges a licence that "covers the most common rights and uses a typical designer would
  expect", and publishes what that means per licence type (§12). Whether a creator's
  desktop licence permits logos, or their web licence tracks pageviews, is a fact in the
  licence summary. Fanwise can say, before the creator uploads anything, which of their
  licences will carry the badge and which will not, and why. No other channel has a
  published quality mark Fanwise can compute.
- **The money is better at launch and the same after.** 50% on every self-serve
  marketplace sale, plus a 35% bonus on sales of fonts released in the previous 30 days.
  Fontspring covers card processing and marketing. Payout is automatic through Tipalti,
  45 days after month end, from a $20 threshold. Monotype pays 50%, monthly, with no launch
  bonus.
- **It is the second foundry a type designer signs with**, after MyFonts or instead of it.
  Fontspring's page counts 900 vendors and 168,000 fonts in 30,000 families as of its 2025
  copy. Dribbble's acquisition release calls the combination "the second largest distributor
  of fonts online". A creator whose family is on MyFonts is asked by their peers whether it
  is on Fontspring too.
- **It is in the family Fanwise already lives under.** Dribbble bought Fontspring on
  1 February 2022; Creative Market is A8. Fontspring's Terms of Service name Creative Market
  Labs, LLC as the DMCA agent and carry, word for word, the two Creative Market clauses that
  settled A8's shape (§12). Nothing about the channel is a surprise to the assisted
  machinery.

**What it costs.** Less is published than for MyFonts, and that cuts against the argument
that assisted preparation earns its price where the rules are exact. Fontspring publishes no
character-set list, no word count, no image spec, no naming rules and no review time. Until
a foundry account settles §13, the requirements engine for this channel is shorter than
MyFonts's and the handoff is more "here is your package" than "here is what will be sent
back". That is the honest state, and the spec does not pad it.

**What it waits on.** Three things, none of them code.

1. **A foundry account.** The foundry page's whole application flow is "Contact the
   Fontspring team for more info", which links to the help center. No form, no published
   criteria beyond "Any font designer solely responsible for the design of their font(s), or
   with permission from the owner", and no published review time. The vendor tools, the
   upload form and the *Font Foundry Terms* the Terms of Service incorporate by reference
   are all behind that account. This is decision 31 in `docs/decisions/0002`, registered
   with this spec. As with Creative Market, Fanwise never asks a creator for their login;
   the answers in §13 come from the founder's own foundry or from an alpha creator reading
   their screen.
2. **Decision 14.** This spec is not a third candidate against Adobe Stock. It is the other
   half of the MyFonts answer: if fonts are the wedge, the second assisted channel is a
   pair of font marketplaces sharing one package, and this is the cheaper one to prove
   first. If fonts are not the wedge, neither is built.
3. **Nothing from A8 any more.** The handoff machinery this spec reuses (listing choices,
   channel-ordered handoff, handoff renditions, mark submitted with URL capture) shipped as
   shared, channel-neutral pieces with B9 on 17 September 2026. The one state MyFonts adds,
   a submission in review, is needed here only if §13 finds a review queue.

---

## 2. What the step proves

A creator carries one real font family, entered once in the Fanwise font workspace, through
the handoff into Fontspring's vendor tools, submits it, and it goes live with the licences
Fanwise said it would carry and the Worry-Free badges Fanwise predicted. The family URL is
captured. Every row reads `status_source = self_reported`. No surface anywhere offers
Publish for this channel.

Measures, in the spirit of `docs/channels/creative-market.md` §12:

| Metric | Target |
|---|---|
| Time from opening the handoff to clicking Submit in the vendor tools | Under 20 minutes |
| Fields materially rewritten before submit | Fewer than 2 of 6 |
| Posters used as built, without re-export | At least 4 of 5 |
| Licence prices entered without change | Every one |
| Worry-Free badges that appear on the live page | Exactly the set Fanwise predicted, no more, no fewer |

The last row is the one that matters. A badge Fanwise predicted that Fontspring withheld
means the §12 criteria are incomplete and the rule grows. A badge Fontspring granted that
Fanwise withheld means the rule is too strict. Either is a one-table change.

---

## 3. Adapter definition

```ts
export const fontspring: ChannelAdapter = {
  key: "fontspring",
  name: "Fontspring",
  integrationType: "assisted",
  // The family name is the product name and is not a listing field, as on MyFonts.
  // Tags are Fontspring's own: it hand-tags fonts and lets nobody else, so there is
  // no tag field unless §13 finds a keyword field for the foundry [verify].
  fields: ["description", "price"],
  capabilities: {
    automaticPublish: false,   // the provider cannot: no API, submission is a logged-in form
    automaticUpdate: false,    // same
    metrics: false,            // the provider cannot: the vendor tools show analytics, no API
    transactions: false,       // the provider cannot by API; Foundry Sales Reports is a page, export [verify], B7
    digitalFileUpload: false,  // the provider cannot; the font files are the submission
    imageUpload: false,        // the provider cannot
    drafts: false,             // [verify]; assume a family is submitted or not
  },
  requirements,                // §9
  manualSteps: [],
  merchandising,               // §6
  buildListing,
  // no publish, update, unpublish, activate, oauth
}
```

Every `false` is the permanent kind `docs/channel-adapters.md` distinguishes: the provider
cannot. None is a step Fanwise has not reached. `drafts` flips to `true` if §13 finds an
unsubmitted state in the vendor tools.

There is no `oauth` member, so Connect writes a row and starts no flow. The account hint is
the **foundry slug** from the public foundry page, `fontspring.com/foundry/{slug}`, stored as
`external_account_id`, with the display name as `external_account_name`. Whether one login
manages several foundries is **[verify]**; the connection is to a foundry either way. No
credential of any kind is held.

Seed: `('fontspring', 'Fontspring', 'assisted', 'available', true)` in a migration named
`<timestamp>_fontspring_channel.sql`. `billable` is true: it is an external marketplace, and
decision 16 (assisted versus automatic pricing) decides the price, not the row.

---

## 4. The submission and the family

**One submission is one family page on Fontspring**, at `fontspring.com/fonts/{foundry}/{family}`
**[verify]** the URL shape. One font product, whose `metadata.styles` is the family's style
list, becomes one submission. Fontspring's public pages price and badge per licence type, and
its help center says "we hand tag fonts, not families", so the unit buyers see is the family
with per-style purchase inside it.

What Fontspring's vendor tools ask for is **not published anywhere**. What follows is the set
of inputs the public pages prove exist, in the order the handoff will use until §13 fixes the
form's own:

**Files.** "CFF OpenType or TrueType fonts." Fontspring generates the webfonts itself:
"You give us your CFF OpenType or TrueType fonts and we will prepare the webfonts for you",
and its webfonts are subset, stripped of OpenType features and "completely disable[d] for
desktop use". Buyers of a desktop licence can download both OTF and TTF when the foundry
supplied both, and "in the rare case that the foundry hasn't provided us with OTF files" get
TTF alone. So the submission takes bare desktop files, in both static formats where both
exist. Whether a zip is accepted, a size limit, and how variable fonts are received are
**[verify]**.

**Licences and prices.** The foundry sets the desktop price and each additional licence's
price, and chooses its own EULA or Fontspring's. The five types on the site are Desktop (per
user), Webfont (per monthly pageviews, with an unlimited option), Application, Digital Ad and
Ebook. All are perpetual: "NONE of our licenses are sold by subscription." Requirements from
the foundry page: no personal-use-only licences, and every font must carry an `@font-face`
licence "unless the font is not suitable for web use". How tiers are entered (a price per
user count, a price per pageview tier, or a base and a multiplier) is **[verify]**.

**Description.** A description exists on every family page. Length, formatting and any
house style are **[verify]**.

**Posters.** Fontspring's word for the marketing images, used in its own promotions article.
A foundry reported supplying 2000 × 1000 PNGs before the November 2022 redesign and being
told the new site needed higher resolution; the current spec is **[verify]**. Promotions
take their own posters, separately.

**Demo fonts.** Optional: "fully installable versions with a reduced character set" that
Fontspring offers free. Whether the foundry uploads a demo cut or Fontspring subsets one is
**[verify]**.

**Tags.** Fontspring's own: "we hand tag fonts, not families, and we don't allow customers
to tag your products." Whether the foundry may suggest keywords is **[verify]**; until then
there is no tag field on this listing.

**Review.** None is documented. Whether a submitted family goes live at once or after a
person at Fontspring looks at it is **[verify]**, and it decides whether this channel needs
the in-review state MyFonts adds (§11).

Fanwise's rule for what it emits: everything above that is derivable, with a deterministic
check on each, and nothing it cannot derive presented as if it could.

---

## 5. Canonical product to submission field map

| Fontspring input | Source | Transform | Notes |
|---|---|---|---|
| Foundry | connection `external_account_name` | Pass through | |
| Font files | `deliverable` and `archive` assets that read as OTF or TTF | File set, §7 | Both static formats when both exist; WOFF, WOFF2 and EOT excluded, Fontspring makes its own |
| Family name | `products.name` | **None.** Never rewritten | Read from the files' name table by any marketplace; shown as a check, §9 |
| Style names and order | `metadata.font.styles`, sorted by weight then name | Pass through as a checklist | |
| Desktop price | `metadata.font.licenses.desktop`, else `base_price` | USD, two decimals | Per-user tiers **[verify]** |
| Webfont price and tier | `metadata.font.licenses.web` | USD and the pageview limit | Required unless the product is marked not suitable for web, §9 |
| Application price | `metadata.font.licenses.app` | USD | Optional |
| Ebook price | `metadata.font.licenses.epub` | USD | Optional |
| Digital Ad price | **nothing** in v1 | | The workspace has no digital-ad licence; the handoff says the type exists and is left unset |
| EULA | `metadata.font.licenseSummary` and the licence asset | Shown; creator chooses own or Fontspring's | Worry-Free prediction per licence, §9 and §12 |
| Description | `canonical_description` | AI rewrite to the Fontspring profile, then plain text, §6 | Length **[verify]** |
| Posters | `cover_image` then `preview_image` assets, in `sort_order` | Derivatives, §8 | 2:1 PNG shared with MyFonts until §13 says otherwise |
| Demo fonts | `deliverable` assets flagged as demo, if any | Pass through | Optional |
| Tags, category, SEO fields, version, support URL | **nothing** | | No known field |

Every channel-specific value lives on `channel_listings.metadata`, never on `products`. The
per-licence USD prices are Fontspring facts about this listing; the product keeps its own
price in its own currency, and the licence summary stays the product's.

---

## 6. Description transform

The merchandising profile is the typeface standard in `docs/merchandising/typefaces.md`,
unchanged, with one addition: the audience is a designer who filters by licence. Fontspring
sells the licence as much as the face, its buyers are told to "browse fonts without your
lawyer", and a description that says plainly what the desktop licence permits is doing the
marketplace's own job. Everything it says about the licence must be in the FactSheet, which
carries the licence summary since the font workspace merged; the validator refuses the rest.

No house-style rules are published, so `description_house_style` from MyFonts is not
carried over. The generic prose rules of the typeface standard apply.

```ts
merchandising: {
  promptVersion: "2026-09-17.1",
  audience: "A designer shopping on a font marketplace who filters by licence terms and compares families by classification, features and price, reading in English.",
  voice: "Editorial and specific. Third person. Every sentence carries a fact or a use. No hype, no exclamation, no salutation.",
  structure: "Identity and classification in the first sentence; design story; visual behaviour; best uses; family, coverage and OpenType features; one closing sentence on what the licence permits, taken from the licence summary. Plain paragraphs separated by blank lines. No Markdown.",
  fields: {
    title: "Leave empty. The family name is the product's name and is never rewritten.",
    description: "60 to 450 words. Name the family exactly as given. Do not list files or formats. State licence permissions only as the licence summary states them.",
    shortDescription: "Leave empty.",
    seoTitle: "Leave empty.",
    seoDescription: "Leave empty.",
    tags: "Leave empty. Fontspring tags fonts itself.",
  },
}
```

---

## 7. Files

As MyFonts (`docs/channels/myfonts.md` §7), with two differences:

- **Both static formats go, when both exist.** Fontspring lets buyers choose OTF or TTF at
  download, so a family with both is worth more to the buyer with both. A family with one
  format sends that one. Variable files ride alongside **[verify]** that Fontspring takes
  them.
- **Demo cuts are part of the file set**, when the product has assets flagged as demo. They
  are the same reduced-character-set files the MyFonts spec recommends listing there, so a
  creator who made one serves both channels.

Transport is one zip, `{product-slug}-fontspring-files.zip`, for delivery only, with the
same line in the handoff: unzip it and upload the files, unless §13 finds the form takes a
zip. Web formats are left out silently, with the one-line explanation. Every file must have a
reading.

---

## 8. Image derivative spec

| Property | Value |
|---|---|
| Count | No published rule. Fanwise emits every source up to 15, cover first |
| Ratio | **2:1**, inferred from a foundry's 2000 × 1000 posters **[verify]** |
| Build target | 2000 × 1000 PNG, sRGB, centred crop, the MyFonts rendition reused byte for byte |
| Minimum | **[verify]**; the redesign asked for more than 2000 wide, so expect the build target to rise |

**The rendition is shared with MyFonts.** The derivative service keys on source checksum plus
spec hash, so a product prepared for both channels builds each poster once. That overlap is
the practical case for the pair: one file set, one poster set, two family pages. If §13 sets
a different ratio, this channel gets its own row and the overlap is lost, which is worth
knowing before decision 14 assumes it.

Content rules: none published. The MyFonts rules (no prices on images, no political or
religious content, a cohesive set) are shown as guidance, not as rules, because Fontspring
has not stated them.

---

## 9. Requirements engine

Deterministic, synchronous, checkable without the vendor tools. Shorter than MyFonts's
because less is published, and honest about it: every rule below is backed by a public
Fontspring statement or by Fanwise's own file readings, and nothing is invented to make the
list longer.

```
error   family_name_present          products.name set, 2 to 60 characters
error   family_name_matches_files    equals the family name in every submission file's name table
error   files_present                at least one readable OTF or TTF after web formats are excluded
error   files_readable               every submission file has a reading; none carries a fontProblem
error   styles_listed                metadata.styles is non-empty and every listed style has a submission file
error   desktop_price                a USD desktop price above 0
error   commercial_only              no licence in the summary is personal-use only; Fontspring sells none
error   webfont_offered              a web licence with a USD price exists, or the product is marked not suitable for web use
warning webfont_missing_reason       marked not suitable for web without a reason in the licence summary
error   not_free                     base_price above 0; every Fontspring licence is a paid commercial licence
warning embedding_restricted         any submission file's fsType is restricted; Fontspring must generate webfonts from it
error   description_present          set
error   description_words            60 to 450 words, pending [verify] of the field's limit
error   description_names_family     contains products.name spelled exactly, at least once
error   images_present               at least one poster derivative built
error   image_format                 PNG
warning image_source_crop            a source loses more than a quarter of its area to the 2:1 crop
warning worry_free_desktop           the desktop licence would not earn the badge; the message names the missing right, §12
warning worry_free_web               the web licence would not earn the badge
warning worry_free_app               the app licence, if offered, would not earn the badge
warning worry_free_ebook             the ebook licence, if offered, would not earn the badge
info    licence_is_yours             Fontspring sells the creator's own EULA or its own, at the creator's prices
info    royalty                      50% of the price, plus 35% on sales in the family's first 30 days; 30% on enterprise sales
info    payout                       through Tipalti, 45 days after month end, from a $20 threshold; US withholding without a treaty is 30%
info    promotions                   introductory, holiday and standard sales are set in the vendor tools; Fanwise does not run promotions
```

Readiness is errors resolved over errors total. Nothing here calls a model.

**The four `worry_free_*` rules are the channel's contribution.** Each reads
`metadata.font.licenses` and the licence summary against the published criteria in §12 and
says which right is missing. They are warnings, not errors, because a foundry may sell a
restrictive licence at a lower price on purpose; Fontspring says so on the badge page. The
rule tells the creator what the badge costs them, and the choice is theirs.

**The character-set rules are not here.** MyFonts publishes a 186-glyph set and Fontspring
publishes nothing. When the `codepoints` field the MyFonts spec adds to the reading exists,
a Fontspring rule can reuse it the day §13 finds a published set; until then a rule with no
source is a guess.

---

## 10. The handoff screen

Ordered as §4 until §13 fixes the form's own order.

```
FONTSPRING SUBMISSION                 Aster Grotesk

  Open your Fontspring vendor tools  ↗   Readiness  14/14

  1  Files
     Files            aster-grotesk-fontspring-files.zip  ·  17 MB  [download]
                      14 OTF, 14 TTF, 1 variable TTF, 2 demo cuts. Unzip it and
                      upload the files. Your WOFF2 files stay here: Fontspring
                      makes its own.
     Family name      Aster Grotesk           matches all 29 files
     Styles           Thin → Black, italics after uprights   14 styles

  2  Licences, in USD
     Desktop          39.00 per user            Worry-Free ✓          [copy]
     Webfont          39.00 · 500,000 pageviews/month · unlimited 195.00
                                               Worry-Free ✓          [copy]
     Application      99.00                    Not Worry-Free: your licence caps
                                               apps at 1. The badge needs unlimited apps.
     Ebook            59.00                    Worry-Free ✓          [copy]
     Digital Ad       not set
     EULA             Your own: aster-grotesk-eula.pdf                [download]
     Fontspring pays 50%, and 85% on sales in the first 30 days.

  3  Description
     [ plain-text preview ]                                          [copy]
     298 words · names the family 3 times · licence sentence from your summary

  4  Posters
     8 posters, 2000 × 1000 PNG                              [download all]
     01-cover  02-waterfall  03-in-use  …
     Upload in filename order.

  ─────────────────────────────────────────────────
  Done?   [ Mark submitted ]
```

After Mark submitted:

```
  Submitted 17 September 2026.
  [ Live: paste the family URL ]   [ Fontspring asked for changes ]
```

Design rules, inherited from Creative Market's handoff and unchanged: copy buttons hold a
"copied" state until the next is used, downloads sit at the step that needs them, nothing
says "publish", and the screen is one component the companion window shows beside the vendor
tools without reading or writing their page.

Rules new here:

- **The licence block is the centre of the screen.** On every other assisted channel the
  description is the work; here the licences are, and each line shows its price, its limit
  and its badge prediction with the reason when the badge is withheld.
- **The EULA is a download, not a copy.** A creator using their own licence uploads the
  document; one using Fontspring's ticks a box. The handoff says which the product's licence
  summary implies and does not decide for them.

---

## 11. Data written

As MyFonts (`docs/channels/myfonts.md` §11) for build, approve and mark submitted, with
`metadata` holding `licensePrices` (per type: `priceUsd`, `limit`, `worryFree`,
`worryFreeReason`), `eulaSource` (`own` or `fontspring`), `fileFormats`, `demoIncluded`.

Whether mark submitted means live is **[verify]**. Until settled the flow is MyFonts's:
`published` with `external_url` null, derived state `published_not_live`, worded
**Submitted**, then the creator pastes the family URL and the state is `live`. If §13 finds
no review, the second step is the same paste and the interim state simply lasts minutes. If
it finds one, `metadata.review` and the `published` to `ready` transition MyFonts adds are
reused as they are. Nothing here writes a row another part of the system would read as
verified; the trigger that refuses `verified` on an assisted channel is untouched.

---

## 12. Prices, licences, royalties and the agreement

Facts the handoff and the requirements depend on, with their sources.

**Licences are the creator's.** The foundry sets the desktop fee and each additional
licence's fee, and may use its own EULA or Fontspring's. Five types are sold: Desktop,
Webfont, Application, Digital Ad, Ebook. All perpetual; none by subscription. Two
requirements: no personal-use-only licences, and a webfont licence on every font unless it
is not suitable for web use. Enterprise and custom licensing are Fontspring's own sales,
quoted by request.

**Desktop licences are counted in users**, and Fontspring's own article defines a user three
ways: a person with the font installed on any number of their devices; a person with access
to a font server; or a shared device limited to one person at a time. **Webfont licences are
counted in monthly pageviews**, on an honour system with no tracking; the smallest tier
offered is half a million a month, an unlimited option is always in the cart, and a
webfont may be embedded only on sites owned by the licence holder.

**The Worry-Free badge**, per licence type, from Fontspring's own page. A licence earns it
when it includes:

| Licence | Must permit |
|---|---|
| Desktop | Fixed-size images used anywhere; logos and branding; broadcast; websites; software; unlimited impressions, files and uses, no "large campaign" limits; perpetual |
| Webfont | No pageview tracking; unlimited domains; perpetual |
| Application | Unlimited apps on one licence; generous user limits with no tracking software; unlimited platforms; perpetual |
| Ebook | Unlimited copies of the title; unlimited ebook formats; perpetual |

These are the tables behind the four `worry_free_*` rules. Fontspring says a licence without
the badge is not bad, only restrictive, and that a prestigious face may carry one on purpose
at a lower price. Who decides the badge, and whether it is applied per licence type or per
family, is **[verify]**; the page shows it per licence in the cart.

**Prices.** USD. No published minimum, maximum, parity rule or price-change window; each is
**[verify]**. Promotions are the foundry's own, set in the vendor tools with a name, a type
(standard, introductory for new releases, holiday), dates, a percentage or fixed discount,
the licences it applies to, optional posters and the families or fonts included, and they go
live on their start date. Fanwise does not run promotions on any channel.

**Demo fonts.** Optional, free to the buyer, reduced character set, for mockups and testing;
some foundries allow limited commercial use of the demo and say so in its licence.

**Royalties.** 50% of every self-serve marketplace sale, "commission rates do vary per shop
and product", plus a 35% bonus royalty on sales of fonts released in the previous 30 days.
Enterprise sales pay 30%. Fontspring covers credit card processing and marketing. The 50%
replaced a 70% rate in November 2022, announced to foundries by email as "unsustainable";
foundries on TypeDrawers noted it at the time. Fair to say to a creator: the launch window
is the best rate on any channel Fanwise supports, and the steady rate is the industry's.

**Payment.** Automatic, 45 days after the end of the month, once owed royalties pass a
threshold the foundry sets (default $20), through Tipalti, by ACH, PayPal or wire depending
on country, with one fee-waived method per country. US withholding applies to sales to US
customers: 30% without a treaty claim, treaty rates (0% for the UK, Canada, Germany, Japan
and most of the EU) with the tax form filed. Tax questions go to Tipalti first. An email
arrives per sale.

**The agreement.** The Terms of Service incorporate *Font Foundry Terms* by reference, and
those terms are not public: the site has no page for them and the help center's *Site
Content Guidelines* say only that "Shop Owner Terms" are entered into "when creating your
account and/or opening a shop". Exclusivity, a parity rule, notice periods and the stance on
third-party tooling are all **[verify]**. The TypeDrawers foundry thread discusses the
contract's compatibility with a MyFonts agreement, which suggests both are signed together
in practice; MyFonts's agreement is non-exclusive by its own summary.

**Two clauses that are public**, in the Terms of Service as archived on 1 January 2026, and
identical to Creative Market's §6(c) and §8(b):

- Users agree "to never share login details or account access with anyone, including
  clients or team members, unless explicitly permitted by additional terms applicable to
  your account type."
- Prohibited activities include "using any automated system, including without limitation
  'robots,' 'spiders,' 'offline readers,' etc., to access the Website or any Services in a
  manner that sends more request messages to the Fontspring servers than a human can
  reasonably produce in the same period of time by using a conventional online web
  browser", and "accessing any User Content or Fonts [or] any Services through any
  technology or means other than those provided or authorized by the Services."

Together they foreclose browser automation and credential sharing, contractually. Assisted
is not a stage this channel passes through.

**Sales data.** None by API. The vendor tools include a Foundry Sales Reports page listing
purchases with the customer and licence assignee shown on hover, and "tracking sales
analytics" is on the foundry page's list of vendor tools. Whether either exports a file, and
its columns, is **[verify]**. That export, if it exists, is B7's path.

---

## 13. Open questions to resolve from inside the vendor tools

Get a foundry account, open the tools, and settle these before the adapter is written. Each
is a guess above until it is.

1. The upload form's fields, in its own order, and whether a family can be saved unsubmitted.
2. Whether a zip is accepted, a per-file size limit, and how variable fonts are received.
3. Whether a submitted family goes live at once or after review, and if reviewed, how long
   and with what outcomes.
4. How licence prices are entered: a price per user tier, per pageview tier, or a base with
   multipliers Fontspring sets; and whether the desktop, webfont, application, digital-ad and
   ebook types can each be switched off.
5. The exact poster spec: ratio, minimum and recommended size, format, size limit, count.
6. The description field's limit and whether it renders formatting.
7. Whether the foundry may supply keywords or a classification, or whether Fontspring's
   hand-tagging is the whole of it.
8. Who applies the Worry-Free badge, per licence or per family, and whether a foundry
   using Fontspring's own EULA gets it automatically.
9. How demo fonts are supplied: uploaded by the foundry, or subset by Fontspring.
10. The family page URL shape and whether it changes on rename.
11. Whether one login manages several foundries.
12. The Font Foundry Terms in full: exclusivity, price parity, notice periods, and any clause
    on third-party tools preparing submissions.
13. Whether the Foundry Sales Reports page or the analytics tool exports a file, and its
    columns.
14. Whether a family sold on Creative Market, the same company, is treated any differently:
    shared listing, shared review, or nothing.

Record the answers in this file as they are settled, and drop the **[verify]** markers.

---

## 14. What this channel is not

- **Not Font Squirrel.** Fontspring runs the free-font site the Terms of Service also
  cover. A free family belongs to neither channel Fanwise models, and a demo cut is not a
  free family.
- **Not the Webfont Generator or the Matcherator.** Both are buyer-side tools on the site.
  Neither creates a listing and neither is an API.
- **Not Creative Market.** Same company since 2022, separate marketplace, separate shop,
  separate terms document, separate listing. A font on both is two listings in Fanwise, as
  it is everywhere else.
- **Not enterprise licensing.** Fontspring quotes and sells custom and enterprise licences
  itself at a 30% royalty. That is a consequence of being a foundry there, stated in the
  handoff's info rule, not a channel Fanwise models.
- **Not promotions.** Set in the vendor tools by the foundry; Fanwise has no promotion
  object and does not want one.
- **Not a place Fanwise holds a credential.** No login, no token, no session. The companion
  window sits beside the vendor tools and never touches them.
