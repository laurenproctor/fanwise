# Fanwise: channel feasibility

What each candidate channel can and cannot support, verified against primary developer and
seller documentation in September 2026. Items marked *unconfirmed* could not be verified
from a primary source.

---

## The short version

**Five channels in this set can be automatic.** Shopify, Etsy, WooCommerce, Gumroad and Polar
are the only platforms assessed here with a public API that lets a third party create a listing
on a seller's behalf. WooCommerce was added to this document on 8 September 2026, after the
first two were built or filed for. Gumroad moved up from near miss on 11 September 2026,
when its product API turned out to have shipped in April; see its section under Tier 1.
Behance was added the same day under Tier 3, and it is assisted for good. A wider survey
that day found publishing APIs outside this set, at Polar, Fourthwall, Wix, Ecwid, CGTrader
and Cults3D. Polar was assessed on 23 September 2026 and qualifies as automatic; see its
section under Tier 1. The other five are not assessed here. Dribbble was assessed on 17
September 2026 and is cut under Tier 4: it stopped being a goods marketplace in July 2023
and its guidelines reject shots that sell a product. Everything else is a preparation problem, not an
integration problem.

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

### WooCommerce — full API, native digital products, one hard problem

Assessed 8 September 2026 against the REST API v3 reference and WooCommerce's own
downloadable-product documentation, and scheduled as B8 the same day at the founder's
request. The assessment is kept as written; the spec is `docs/channels/woocommerce.md` and
the roadmap's B8 section records what was built and what the exit still owes.

**It fits the adapter contract better than Shopify does.** `POST /wc/v3/products` takes
title, description, price, images by URL, categories, tags, slug and a `status` of `draft` or
`publish`, so `drafts: true` comes for free. Digital products are native: `virtual`,
`downloadable`, a `downloads` array of name and file URL, a download limit and an expiry.
Shopify has none of that, which is why ADR 0001 exists. `GET /orders` carries line items,
totals, dates and status, which is B5's ingestion.

**Authorization is a real flow.** `/wc-auth/v1/authorize` sends the creator to their own
store with an app name, a scope, a user reference, a return URL and a callback URL; the store
posts `consumer_key` and `consumer_secret` to the callback and redirects the creator back. It
maps onto `ChannelOAuth` with one difference: the keys arrive by a separate POST rather than
in the redirect, so the callback route needs a second entry point. The flow requires the
store to be on HTTPS with pretty permalinks enabled, which is typical hosting and worth
checking on a real one.

**The hard problem is where the file lives.** `downloads[].file` must be a URL the store can
already serve, and the WooCommerce API has no upload for it. Three ways through:

- **Fanwise hosts the download URL.** ADR 0001 ruled this out for Shopify and the reasons
  hold: Fanwise becomes the delivery infrastructure for every buyer.
- **Upload to the WordPress media library** through the WordPress REST API and point the
  download at the result. This works, and it is wrong: files in the media library are
  publicly reachable by anyone with the URL, which WooCommerce's own documentation says
  plainly. Its protected folder, `woocommerce_uploads`, is written only by the admin's
  product-file upload. Fanwise would be publishing the deliverable to a public address. It
  would also need a WordPress Application Password, a second credential the WooCommerce
  authorization flow does not grant.
- **An assisted file step**, as Shopify has today. The creator attaches the file in the
  WooCommerce admin, which puts it in the protected folder, and marks the step done. The
  manual-step machinery from A5 carries over unchanged.

**Superseded on 13 September 2026 by ADR 0012:** WooCommerce now takes the first route in a
revocable form — a Fanwise address per file that re-checks the listing on every request and
redirects to a five-minute download — and is fully automatic. What follows is the reasoning as
it stood.

So the channel takes Shopify's shape: automatic everything, assisted file, `digitalFileUpload:
false` for the second reason on this page — Fanwise will not, rather than the provider
cannot. **[verify]** the public-URL finding against a real store before building, because if
it is wrong WooCommerce becomes the first fully automatic channel in the set. B8 built on the
finding unverified; the exit test on a live store is where it gets checked, and if it is
wrong the change is `digitalFileUpload: true` and a media-library upload, not a redesign.

**Billing is a decision, not a detail.** The pricing model includes one owned storefront and
names Shopify. WooCommerce is also an owned storefront. See `docs/decisions/0002`, item 23.

Rate limits are not documented; the API is the store's own WordPress, so the ceiling is the
creator's hosting. Pagination is ten per page by default with `X-WP-Total` headers.

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

### Gumroad — full API since April 2026, one shared throttle

Reassessed 11 September 2026 against Gumroad's own source, `antiwork/gumroad` at commit
`409faee`, and planned as B10 the same day. The spec is `docs/channels/gumroad.md`.

The assessment this replaces said `POST /v2/products` and `PUT /v2/products/:id` were
documented as unimplemented and returned 404, that there was no file upload, and that the
thing to do was email Gumroad. It was true when first written and stopped being true in
spring 2026: presigned file upload shipped on 30 March, product creation on 6 April, and
API-created products began publishing by default on 6 September. Production answers 401 on
all of them, not 404.

**It fits the adapter contract as well as Etsy does.** OAuth authorization code, with PKCE
supported; one scope, `edit_products`, for everything a publish needs; access tokens that do
not expire. A create takes a name, an HTML description, a price in minor units in one of 19
currencies, tags, a category path and a custom permalink; `draft=true` holds the product
back and `PUT .../enable` puts it on sale. Up to eight covers and a square thumbnail attach
by URL.

**It takes the file.** A presigned multipart upload to the seller's own storage, in 100 MB
parts, up to 20 GB a file, then `files[][url]` on the product. No file-type restriction, and
no five-file ceiling of the kind that forces Etsy's packaging question.

**Sales data is there too.** `GET /v2/sales` under `view_sales`, cursor-paginated, with
price, Gumroad's fee, currency and refund flags, and webhooks for sale, refund and dispute.
The webhooks are unsigned.

**Three things to design around:**

- **The create limit is per IP address.** Ten creates a minute, escalating on repeat to 50
  per nine hours, keyed by IP rather than by token, so every Fanwise workspace shares one
  allowance. A seller may also create at most 100 products in a day.
- **Failures arrive as HTTP 200** with `success: false` in the body. A client that trusts
  the status records a refusal as a success.
- **The terms bar commercially exploiting the Services**, and there are no API-specific
  terms at all. The same shape of risk as Etsy's clause and the same answer: Fanwise charges
  for cross-channel catalog management. Decision 27 asks Gumroad rather than relying on the
  reading.

**Fees:** 10% plus $0.50 on a direct sale, plus card processing; a flat 30% on a sale that
came through Discover.

Gumroad's audience still overlaps almost perfectly with the Fanwise creator, which was the
reason the old section wanted the email sent.

### Polar — full API, the file ships with the product, not a marketplace

Assessed 23 September 2026 against Polar's own documentation at `polar.sh/docs` (the
Products, File Downloads, OAuth 2.0, API overview, API versioning, Fees, Account reviews,
Webhooks and Sandbox pages, and the `2026-04` OpenAPI reference for files, products and
benefits) and the Acceptable Use Policy effective 25 March 2026. Opened and built as B13
the same day; the spec is `docs/channels/polar.md`.

**It fits the adapter contract.** Third-party access is OpenID Connect, authorization code
only, PKCE for public clients. Tokens are user-scoped, and the seller can limit one to
chosen organizations on the consent screen. The access token lasts ten days
(`expires_in: 864000`) and comes with a refresh token. Every endpoint a publish needs lists
`oidc` among its security schemes, under four scopes: `files:write`, `benefits:write`,
`products:write` and `webhooks:write`.

**It takes the file, and delivers it.** A file is a File Downloads benefit, up to 10 GB a
file, of any type. `POST /v1/files` with `service: downloadable` returns presigned S3 URLs
for up to 10,000 parts, with optional SHA-256 per part; a complete call closes the upload.
The file ids go into a downloadables benefit, and the benefit attaches to the product. Polar
then hands every buyer a signed, personal download URL. There is no fulfilment question of
the kind ADR 0015 answers for Shopify, and no file-count ceiling like Etsy's.

**The product object is small and clean.** A name of 3 to 64 characters, a Markdown
description, visibility `draft`, `private` or `public` (the default is `public`), up to 10 MB
images in JPEG, PNG, GIF, WebP or SVG, and key–value metadata that travels on every order
and webhook. Price is fixed, pay-what-you-want or free, in any of 130+ currencies at once,
but one pricing model per product: Polar has no variants, and pricing type and billing cycle
cannot change after creation. A fixed amount can.

**Four things to design around:**

- **A publish is six calls, and none takes an idempotency key.** File create, part uploads,
  complete, benefit create, product create, then attach. Nothing documented dedupes a
  retried write. The list endpoint filters products by `metadata`, so the ADR 0005
  stamp-and-search guard works: stamp the Fanwise listing id into metadata, search before
  create.
- **It is a checkout, not a marketplace.** There is no discovery surface and no product page.
  A buyer arrives through a Checkout Link, a persistent URL created by API, and that is what
  `external_url` would hold. A Polar storefront is mentioned once, in a third-party
  integration guide, and is *unconfirmed*. Polar brings no buyers: it is closer to an owned
  storefront than to Etsy, which makes it a billing question for decision 23 rather than an
  obvious $6 channel.
- **The API contract expires.** Versions are date-based and released each January, April,
  July and October. Each lives about nine months, three of them as Current, and a removed
  version answers 404. An adapter pinned with `Polar-Version` has to be upgraded at least
  twice a year, forever. No other channel here imposes a schedule like that.
- **The seller is reviewed before the first payout.** Polar is the Merchant of Record and
  resells the goods, so the organization owner passes KYC through Stripe Identity and a
  review of up to 14 days, and continuous reviews follow at sales thresholds. Polar holds
  sellers to a 0.4% chargeback rate and expects a reply to a looped-in support thread within
  48 hours. Fanwise cannot do any of this for the creator.

**Terms.** The Acceptable Use Policy names "Templates, eBooks, PDFs, code, icons, fonts,
design assets, photos, videos, audio" as acceptable products. It prohibits marketplaces that
sell others' products and "any product or service that enables non-Polar Sellers to sell";
neither describes Fanwise, since each creator is the seller on their own organization and
Fanwise sells nothing through Polar. Its framing is "Polar serves software companies", and
review is discretionary, so a font foundry's first review is the real test.

**Rate limit:** 500 requests a minute per organization, customer or OAuth2 client, 429 with
`Retry-After`, raisable through support. Whether an OAuth client's allowance is shared
across every connected seller, as Etsy's is, is *unconfirmed*; at 500 a minute it matters far
less than Etsy's 10 QPS.

**Sales data:** orders by API, and `order.created`, `order.paid` and `order.updated`
webhooks, registrable per organization under `webhooks:write`. Secrets from 8 September 2026
sign with Standard Webhooks.

**Fees:** Starter is free, 5% plus 50¢ a transaction, plus 1.5% on non-US cards. Pro ($20 a
month, 3.8% plus 40¢), Growth ($100) and Scale ($400) trade a monthly fee for a lower rate.
Organizations created before 27 May 2026 keep the Early Member rate, 4% plus 40¢, until they
upgrade. Tax collection and remittance is included, since Polar is the seller of record.
Disputes cost $15. Stripe's payout fees apply on withdrawal: $2 a month of active payouts and
0.25% plus 25¢ a payout. Like Gumroad it costs nothing to keep and nothing to list, and on a
direct sale it takes about half Gumroad's cut.

**Testing is cheap.** A fully isolated sandbox at `sandbox-api.polar.sh`, 100 requests a
minute, with Stripe test cards. Polar asks sellers not to test with real cards in production.

**Verdict: automatic, and a good fit for the files, with a real maintenance cost.** It would
be the fifth automatic channel and the first whose file delivery needs no work at all. What
it lacks is buyers; what it costs is a version upgrade every two quarters.

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

### Behance — assisted, no review queue, and Adobe's terms close automation

Assessed 11 September 2026 against the seller help center, the Behance Product Specific
Terms (18 June 2024), the Adobe General Terms of Use (3 October 2025) and the Community
Guidelines, and planned as B9 the same day. The spec is `docs/channels/behance.md`.

**The marketplace is real and recent.** Behance opened asset sales to every profile on
21 June 2023 and replaced off-site "linked assets" with hosted files on 16 October 2023. A
seller attaches up to 5 downloadable assets to a project, each up to 500 MB in any of
"over 25" file types including ZIP, PDF, TTF, PSD, AI and SVG, with a cover image, a file
name, one of five categories, one of two licenses, a description, a price and up to 20
example images. The asset lists when the project is published. No pre-publication review is
documented; moderators remove assets after the fact, and adult content is refused as an
asset. Behance's own audience figure is 40 million members.

**There is no write API, and the read API is closed.** The v2 API is read-only by design
(projects, users, collections, statistics), `behance.net/dev` answered 404 on 11 September
2026, Adobe's developer forum has said since 2024 that new keys are not issued pending a
migration to adobe.io with no date, and §6 of the Product Specific Terms licenses the API
for non-commercial use only and bars any application that "replicates or attempts to
replace the essential user experience." Nothing there is a path to a listing.

**The browser-automation fallback is contractually closed, as at Creative Market.** Three
clauses, each sufficient on its own: the Community Guidelines' "Be Authentic" section
prohibits "using automated or scripting processes (such as bulk or automated uploading of
content through a script)"; Adobe's General Terms §6.6 forbid accessing the Services "by any
means other than the interface we provide or authorize"; and §5.1 and §6.3 forbid sharing
account information and enabling others to use the Services with it. So: assisted, with no
`publish`, and no credential held.

**The fee structure is the thing a creator will notice.** No listing fee, then a **30%
platform fee** on every sale plus Stripe's 2.9% + $0.30 or PayPal's local rate. The platform
fee is waived for Behance Pro, from $9.99 a month on an annual commitment. A creator on the
free plan keeps about two thirds of the price, and the handoff shows that arithmetic beside
the price rather than leaving it to Stripe. This also sharpens decision 16: Fanwise's $6 for
preparation sits next to Adobe's 30% for the storefront.

**Sales data: none from Behance, all of it in the seller's own Stripe.** Payments run
through a Stripe (or PayPal) account the seller connects; Behance's Assets tab shows asset
earnings and nothing else, and refunds issued in Stripe are not reflected on Behance at all.
A CSV export from that dashboard is B7's path. Because it is the seller's own Stripe
account, a read-only connection to it is a conceivable later source. Not planned.

**Specs worth encoding:** cover images at least 808 × 632 for a 202 × 158 display, which is a
1.278:1 ratio nothing else in the catalog uses; project images JPEG or PNG at 2800 wide or
under and under 10 MB, refused over 50 MB, PDF refused as project content, CMYK converted
with visible shifts; up to 10 project tags; at least one Creative Field; an 80-character
title per a secondary source (*unconfirmed*). Licenses are Personal or Standard Commercial
(up to 5,000 physical products and print uses, unlimited web and social), fixed by Behance,
no extended tier and no price floor.

**Eligibility:** a profile and a payment account, nothing to apply for. Stripe in 40
countries approved by both parties; six more that Stripe serves (Brazil, India, Indonesia,
Malaysia, Mexico, Thailand) cannot collect the platform fee and use PayPal, as do the other
PayPal-only countries on Behance's list. Behance Pro is for personal profiles only.

**Verdict: V2, assisted, scheduled as B9 after A8**, because it reuses every piece of A8's
handoff machinery and adds a shape the machinery has not met: a portfolio project composed
around the product rather than a product form filled in. Cheapest assisted channel after
Creative Market; not a candidate for B4, whose slot is reserved for heavy-metadata channels
under decision 14.

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

### Dribbble — a portfolio, not a store

Assessed 17 September 2026 against the Shot Guidelines (8 April 2025), the Community
Guidelines (9 September 2026), the Terms of Service (17 March 2025), the Pricing and Payment
Terms (3 February 2026), the v2 API documentation and terms, and the Wayback Machine's index
of `dribbble.com/marketplace`. Not a design tool, but it belongs in this tier for the same
reason the four above do: there is no product object to syndicate.

**The goods marketplace is gone.** The "Dribbble Marketplace" launched on 15 November 2021
was a Creative Market product feed: a shop owner connected a Creative Market shop, products
appeared on a Goods tab on a 12-hour sync, and "all transactions occur on Dribbble, powered by
Creative Market". `dribbble.com/marketplace` answered 200 through June 2023 and has redirected
to the homepage since at least 29 July 2023; `/goods` and the profile-level Goods tab redirect
too; Creative Market's help article for the integration was last archived in February 2023
and now answers 403; and no Dribbble help article, Pro page or product update since mentions
goods, shops or Creative Market. Creative Market is still "a Dribbble company" per its 2026
footer, so the Dribbble-family route to selling a product is Creative Market itself, which is
A8.

**What Dribbble monetizes now is design work.** Since September 2024 it has been a
transactional services marketplace (Projects and Services), and in March 2025 it made
on-platform transacting mandatory under a disintermediation policy. The fee page sets a
graduated designer fee of 10% on the first $500, 7% on the next $500 and 4% above $1,000 on
projects, a flat 3.5% on services, both waived on annual Pro Standard or Plus, plus client
fees and 2.9% + $0.30 processing. A Service is a package of work delivered to one client.
There is no price, file or checkout object for a downloadable product anywhere.

**Posting the product as a shot breaks three rules.** The Shot Guidelines list, under content
Dribbble reserves the right to reject, "No digital downloads and design assets: This includes
product mockups, icon packs, and web templates that are for sale or given away for free." The
Community Guidelines say "Do not use Dribbble Shots to advertise your product or service" and
"Do not include email addresses or websites/URLs in your Shot description or within the Shots
themselves." Dribbble's May 2025 product post states the policy behind them: "uploading
content to Dribbble to generate referral traffic to products or services sold elsewhere is,
functionally, advertising ... and we offer robust advertising solutions." The sanctioned
version is a paid Boosted Shot through BuySellAds, contact for pricing.

**The API cannot help, even where the rules allow it.** v2 is real and self-serve: OAuth
with two scopes, `public` and `upload`, and `POST /shots` creates a shot from a 400×300 or
800×600 GIF, JPG or PNG up to 8 MB (the documentation is stale against the site's 1600×1200
and 10 MB), at 60 requests a minute and 1,440 a day per user. That is the whole write
surface. The API terms forbid automating actions on behalf of users unless they request
them, forbid scraping, and let Dribbble refuse access at any time. It publishes portfolio
images and nothing else.

**What is legitimately allowed:** the profile's "Social Profiles + Portfolio URL" are
publicly visible, so a creator may put their `/@handle` page there. Fanwise already models
Dribbble exactly this way, as a social link on the public profile (`docs/data-model.md`).
That is the correct and complete treatment.

**Verdict: cut.** Not assisted either, because there is nothing to hand off: no listing form,
no file, no price. It differs from Behance, which sells assets. Two residues: Creative Market
is the Dribbble-family goods channel, already A8; and Dribbble also owns Fontspring (acquired
February 2022), a real font marketplace paying a 50% royalty plus a 35% bonus on releases in
their first 30 days, with a foundry application. If fonts turn out to be the wedge, Fontspring
belongs in the decision 14 conversation next to MyFonts. Not assessed here.

---

## Revised channel roadmap

| Channel | Mode | Publishing | Sales data | Verdict |
|---|---|---|---|---|
| Shopify | Automatic | API, file delivery needs a decision | API + webhooks | **V1** |
| Etsy | Automatic | Full API | API | **V1** |
| WooCommerce | Automatic | API, file step assisted, and `activate` verifies the file is on the product | API | **V1**, B8, code complete 8 Sep 2026, exit needs a live store. Billing is decision 23 |
| Creative Market | Assisted | Manual, no automation permitted | None | **V1** |
| Adobe Stock | Assisted | SFTP + 5,000-row CSV, manual submit | None | **V2, highest leverage** |
| MyFonts | Assisted | Portal only, exact specs | CSV download | **V2, if fonts are the wedge** |
| Gumroad | Automatic | Full API since April 2026, file by multipart upload, create limit shared per IP | API + webhooks | **B10**, built 16 Sep 2026, exit passed 17 Sep 2026 |
| Polar | Automatic | Full API, file create by presigned multipart upload, delivered by Polar | API + webhooks | **V2, B13**, assessed and built 23 Sep 2026, exit unrun. Checkout only, no marketplace; billing is decision 32 |
| Envato | Assisted | No item creation, FTP for audio/video only | **API** | **V2 for analytics only** |
| Behance | Assisted | Manual, a project plus an asset, no review queue documented | None; the seller's own Stripe | **V2, B9**, built 17 Sep 2026 ahead of A8, exit needs a profile with Stripe |
| Creative Fabrica | Assisted | Manual, 1 to 2 day review | None | **V3** |
| Design Bundles | Assisted | Manual, one design at a time by ToS | None | **V3, low priority** |
| Payhip | Blocked | API covers coupons and license keys only | Webhooks | Skip |
| Lemon Squeezy | Blocked | Products and files read-only, mid-migration to Stripe | API | Skip |
| Framer, Webflow, Canva, Figma | Blocked | No API, product lives in the tool | None | Cut |
| Dribbble | Blocked | No goods marketplace since July 2023; shots that sell a product are rejected | None | Cut, assessed 17 Sep 2026 |
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
Shopify, Etsy, Gumroad and Envato. Everything else is CSV import or nothing, and Behance's
sales sit in the seller's own Stripe account, the same CSV path today and a possible
read-only source later. The cross-channel revenue view, which is the strategically important
feature, will have holes in it for most creators. Say so honestly in the product rather than
showing zeros.

**Etsy concentration is real.** Under the current pricing model Shopify is the included
storefront, so at V1 the only billable automatic channel is Etsy. Etsy's ToS contains a
clause that could be read against Fanwise, its approval is discretionary, and its
application-level rate limit caps total platform throughput. That is a lot of dependency on
one relationship. Gumroad is the relief: its product API shipped in April 2026, and B10
makes it the second billable automatic channel. It brings its own dependency, a create limit
shared by every Fanwise workspace, so it spreads the risk rather than removing it.
