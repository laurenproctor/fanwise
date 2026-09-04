# Fanwise: channel feasibility

What each candidate channel can and cannot support, verified against primary developer and
seller documentation in September 2026. Items marked *unconfirmed* could not be verified
from a primary source.

---

## The short version

**Two channels can ever be automatic.** Shopify and Etsy are the only platforms in this set
with a public API that lets a third party create a listing on a seller's behalf. Everything
else is a preparation problem, not an integration problem.

Three findings change the plan:

1. **Design Cuts no longer exists.** It shut down in January 2025 and Creative Market
   acquired the brand. Remove it from every surface.
2. **Framer is a weak choice for the second assisted channel.** The product lives inside
   Framer as a remix link, there is no review queue, and submission is a form inside the
   app, so there is almost nothing worth preparing. **Adobe Stock or MyFonts is a far
   better second assisted channel**, because both carry heavy, precise metadata
   requirements and Adobe offers a sanctioned bulk pipeline.
3. **Etsy's rate limit is per application, not per seller.** 10,000 requests per rolling
   24 hours and 10 QPS across your entire customer base. A listing with five files and ten
   images costs roughly 16 calls, so the default ceiling is about 600 listings a day for
   all of Fanwise combined. A limit increase has to be requested from Etsy, and this needs
   to happen well before you have customers who need it.

---

## Tier 1: real publishing APIs

### Shopify — full API, one caveat

The GraphQL Admin API (2026-07) creates and updates products, attaches media, and exposes
orders and webhooks. Real OAuth for multi-tenant apps. This is the only platform here with
a genuinely complete integration surface.

The caveat is the one flagged in the earlier audit, now confirmed: **Shopify has no native
digital-download product type and no API for attaching a buyer-downloadable file.**
`stagedUploadsCreate` plus `fileCreate` uploads a file to the store's Files and gives you a
CDN URL, but that is a public link, not gated per-order delivery. Shopify's own free Digital
Downloads app has no public API.

Options, unchanged from the audit but now with a concrete third path: Fanwise hosts
delivery itself; or you take a dependency on a third-party app that does expose an API
(**Fileflare** documents a REST API with bearer auth, asset upload, and attachment to
Shopify product IDs, 100 IDs per request, 60 requests per minute); or the file step is
assisted.

Also note: legacy custom apps could not be created after 1 January 2026, so new apps go
through the Dev Dashboard. App Store review has no published SLA, but a merchant can
install an unlisted app without review, which is the right path for alpha.

Rate limits are cost-based: 100 points per second on Standard, up to 2,000 on Enterprise.

### Etsy — full API, with three real risks

Open API v3 does everything Fanwise needs: `createDraftListing`, `updateListing`,
`uploadListingFile`, `uploadListingImage`, receipts and transactions for sales data, OAuth
2.0 with mandatory PKCE. Digital products use `type=download`.

Three risks worth naming precisely:

- **Approval is discretionary and slow.** Commercial access is an upgrade request with no
  published SLA; applicants on Etsy's own GitHub discussions report waiting weeks to over a
  month with no response. This is the single strongest argument for filing on day one.
- **The ToS has a clause aimed at products like Fanwise.** Etsy's API terms bar apps that
  "charge Etsy sellers a fee for features Etsy provides free." Etsy's listing manager is
  free. Fanwise's defensible answer is that it charges for cross-channel canonical catalog
  management, not for Etsy listing creation, and the commercial access application should
  make that argument explicitly rather than describing Fanwise as an Etsy listing tool.
- **File limits are tight.** Five files per listing, 20 MB each, filenames capped at 70
  characters and not editable after upload. A font family with desktop, web and variable
  packages will bump into this, so Fanwise needs a packaging strategy for Etsy
  specifically, not just a generic zip.

Accepted file types include .zip, .pdf, .otf is *not* on Etsy's published list; sellers
report .psd is no longer accepted (*unconfirmed*). Images: .jpg, .png, .gif, .svg, .heic,
2000px recommended, files over 1 MB may fail.

### Gumroad — the near miss

Gumroad has proper OAuth 2.0 with `edit_products` scope, a good sales API, and webhooks. It
should be tier 1. It is not, because **the `POST /v2/products` and `PUT /v2/products/:id`
endpoints are documented as unimplemented and return 404**, with the docs stating that
product updates must be done through the dashboard. There is no file upload endpoint
either.

Gumroad is now open source (antiwork/gumroad) and there is an open issue requesting exactly
this API, closed with "tracked separately" and no public timeline. **Worth a direct email to
Gumroad**, because this is one merged PR away from becoming a tier 1 channel, and Gumroad's
audience overlaps almost perfectly with the Fanwise ICP.

For now: sales ingestion works, publishing does not.

---

## Tier 2: sanctioned bulk pipelines, no publishing API

### Adobe Stock — the best assisted channel

There is no Contributor API, and Adobe says so plainly in its own FAQ: no public API to
upload content or read sales. The buyer-side Adobe Stock API is search and licensing only,
which is easy to mistake for an integration path. It is not one.

What Adobe does offer is a **first-party, documented, sanctioned bulk pipeline**: SFTP
upload with no stated file or data limits, plus a **5,000-row CSV** for titles, keywords,
categories and releases, applied in one action from the portal's New tab. Filenames in the
CSV must match uploaded assets exactly, including extension and character case.

Only the final "submit for moderation" click is manual. That makes Adobe Stock the highest
leverage assisted channel by a wide margin: Fanwise could automate the SFTP transfer,
generate the CSV, and hand the creator a one-click finish. One caution: an Adobe Community
Expert states automated submission "is not allowed," which is *unconfirmed* against the
Contributor Terms themselves, so the last step should stay human by design.

### Envato — read-only API, real earnings data

The Envato API is genuinely useful and genuinely cannot publish. It offers OAuth 2.0 with
refresh tokens and private endpoints for sales, earnings, statements and balance, which
makes it a strong **analytics** integration. It has no item creation endpoint anywhere.

FTP upload exists but only for audio and stock video, at
`ftp.marketplace.envato.com` and `ftp.aws.portfolio.envato.com`, authenticated with username
plus API key, auto-purged after 24 hours, and the file still has to be attached to a listing
through the dashboard. Not available for ThemeForest, CodeCanyon or GraphicRiver.

Two blockers: the API terms prohibit "data mining, robots, or other similar data and image
gathering and extraction methods" and explicitly disclaim any agency relationship, so
headless dashboard automation is non-compliant; and **Envato Market author applications are
currently closed**, so new sellers cannot onboard at all. Elements has a separate
contributor dashboard and revised author terms effective 25 February 2026.

Rate limits are dynamic rather than numeric, returning 429 with `Retry-After`.

---

## Tier 3: assisted only, manual submission

### MyFonts / Monotype — highest preparation value

No public API, no FTP, no manifest spec. Submission is entirely through the Foundry Platform
portal at fontplatform.monotype.com, and the Monotype Fonts REST API is a webfont serving
product for licensees, not a foundry pipeline.

The reason this is still attractive: the metadata burden is heavy and the constraints are
exact, which is precisely what Fanwise is for. OTF and TTF only, **no ZIPs**, each file
under 52 MB, maximum 200 font files per submission, 5 to 15 marketing images at a **2:1
ratio in PNG**, description recommended under 500 words, and a two-level USD price table
covering both per-style and complete-family pricing. Foundry Support reviews within 24 hours
of the next business day.

Earnings are portal-only but downloadable as a spreadsheet, updated hourly, which makes CSV
ingestion a viable read-side integration.

The foundry stance on third-party automation is *unconfirmed*, governed by a non-public
distribution agreement.

### Creative Market — assisted, and browser automation is contractually closed

No seller API, no OAuth, no FTP ("Sorry, we do not offer nor support an FTP"), no earnings
API. Shop approval is human-reviewed against a portfolio of 10 to 20 samples; individual
products are not curated after approval, so sellers toggle listings live themselves.

The clause that matters: Creative Market's Terms of Use, last updated 1 July 2025, §6(c)
requires users to "never share login details or account access with anyone," and §8(b) bans
automated systems making more requests than a human reasonably could. **This forecloses the
browser-automation fallback contractually, not just technically.** The plan's decision to
avoid browser automation is now not merely prudent, it is required here.

Product specs worth encoding: zip up to 4 GB (Creative Market reads inside it to render a
file manifest), up to 100 screenshots, minimum 910×607, recommended 1820×1214, JPG/PNG/GIF
under 5 MB each, markdown descriptions, category-driven licensing (fonts must be installable
OTF/TTF, WordPress themes are GPL 2.0). There is a **Bulk Editor** that creates and edits
products in batch by drag and drop, though it is not a CSV importer and has no API.

### Creative Fabrica — assisted, mandatory human review

No seller API of any kind. The developer platform at platform.creativefabrica.com is an AI
image and video generation API and is unrelated to shop listings, which is an easy and
expensive thing to confuse.

Every design is human-reviewed before going live, typically one to two working days.
Specs: zip containing PNG/SVG/EPS/DXF, fonts as OTF/TTF and auto-zipped, graphics at 300
DPI or better, **preview images 3:2 at a recommended 1200×800**. Descriptions must state
formats and compatible software, and must not contain prices, discounts, licensing text,
links or contact info.

The designer terms are silent on APIs and automation, and are explicitly non-exclusive.

### Design Bundles — assisted, with an anti-bulk clause

No API, no developer portal. Uploads go through a proprietary Designer CMS.

The designer terms require submitting **"single digital designs and not 'packs' or
'bundles'"** one at a time through the CMS, which is the closest thing to an explicit
anti-bulk-submission clause in this whole set. Worth weighing before promising anything
here.

Store application requires a permanent unchangeable store name, a portfolio of 10 to 12
pieces on an approved platform, real name, socials and a bio, and **at least one uploaded
product before the application enters the queue**. Previews are 3:2; cut files as SVG, DXF,
EPS, PNG, tested in Cricut Design Space and Silhouette Studio.

Convenient overlap: Creative Fabrica and Design Bundles both want 3:2 previews, so one
derivative spec serves both.

### Design Cuts — gone

Shut down 16 January 2025 after eleven years. Creative Market acquired the brand, and the
old store application URL now redirects to creativemarket.com/designcuts. The customer
download portal was deactivated in June 2025. Remove from all roadmaps and marketing.

---

## Tier 4: design-tool marketplaces, structurally incompatible

Framer, Webflow, Canva and Figma share one property that breaks the canonical-file model:
**the product is not a file the seller uploads.** Framer sells a remix link, Webflow sells a
cloneable project, Canva publishes a design object into Canva's own library, Figma publishes
a duplicatable file. There is nothing to syndicate, and the creator must build natively in
each tool.

Zero of the four expose any listing-creation API. Zero expose a sales or earnings read API.
All four have a plugin SDK whose scope stops at the canvas and never reaches the
marketplace-publish action.

- **Framer**: open to all, submission is a form inside the app, and there is **no review
  process** at all, so templates go live immediately. Fields include name, byline,
  description, images, categories, styles, features, preview URL and remix URL. Because
  there is no queue and no gatekeeper, there is very little for Fanwise to prepare. The ToS
  says the account "is personal and may not be shared with any third party."
- **Webflow**: the most rigorous, and therefore the most assistable. An off-platform web
  form, human review in **3 to 5 days**, a published **Template Grading Rubric** covering
  design and functionality, minimum PageSpeed and accessibility scores, total weight under
  10 MB, and one revision round for near-misses. New designers are limited to one template
  at a time. A Designer Extension could audit a site against the rubric, which is a real
  product, though it is a different product from Fanwise.
- **Canva**: application-only, **in beta**, and Canva warns it can take "up to a couple of
  months" to hear back. Element Creator signups are on hold. Monetization is a royalty pool
  based on usage, not unit sales, so there is no price to set and no revenue to attribute.
- **Figma**: free publishing is open to all, but **Figma is not approving new creators to
  sell paid files at this time**, and only previously approved individual accounts can sell.
  Paid files pass an unpublished content review.

**Recommendation: cut all four from the roadmap.** Not because they are hard, but because
the canonical-product thesis does not apply to them. If you want the Framer creator as a
customer, the way in is their fonts and graphics, not their Framer templates.

---

## Revised channel roadmap

| Channel | Mode | Publishing | Sales data | Verdict |
|---|---|---|---|---|
| Shopify | Automatic | API, file delivery needs a decision | API + webhooks | **V1** |
| Etsy | Automatic | Full API | API | **V1** |
| Creative Market | Assisted | Manual, no automation permitted | None | **V1** |
| Adobe Stock | Assisted | SFTP + 5,000-row CSV, manual submit | None | **V2, highest leverage** |
| MyFonts | Assisted | Portal only, exact specs | CSV download | **V2, if fonts are the wedge** |
| Gumroad | Assisted now | Endpoints unimplemented, watch the repo | API | **V2, ask them** |
| Envato | Assisted | No item creation, FTP for audio/video only | **API** | **V2 for analytics only** |
| Creative Fabrica | Assisted | Manual, 1 to 2 day review | None | **V3** |
| Design Bundles | Assisted | Manual, one design at a time by ToS | None | **V3, low priority** |
| Payhip | Blocked | API covers coupons and license keys only | Webhooks | Skip |
| Lemon Squeezy | Blocked | Products and files read-only, mid-migration to Stripe | API | Skip |
| Framer, Webflow, Canva, Figma | Blocked | No API, product lives in the tool | None | Cut |
| Design Cuts | Defunct | Platform closed January 2025 | n/a | Remove |

---

## What this does to the business model

Three consequences worth sitting with.

**The pricing model needs a mode distinction.** Charging $6 a month for an automatic channel
that publishes and syncs by itself is easy to defend. Charging the same $6 for an assisted
channel where Fanwise builds a package and the creator still uploads it by hand is harder,
and a customer will notice. Two options: price assisted channels lower (say $3), or hold one
price and make the assisted preparation obviously worth it, which the Adobe Stock and
MyFonts specs suggest it can be. Decide before the pricing page goes live.

**The analytics promise is thinner than the plan assumes.** Verified sales data exists for
Shopify, Etsy, Gumroad and Envato. Everything else is CSV import or nothing. The
cross-channel revenue view, which is the strategically important feature, will have holes in
it for most creators. Say so honestly in the product rather than showing zeros.

**Etsy concentration is real.** Under the current pricing model Shopify is the included
storefront, so at V1 the only billable automatic channel is Etsy. Etsy's ToS contains a
clause that could be read against Fanwise, its approval is discretionary, and its
application-level rate limit caps total platform throughput. That is a lot of dependency on
one relationship. Getting Gumroad's product API unblocked would be the single highest-value
business development conversation available, and it costs one email.
