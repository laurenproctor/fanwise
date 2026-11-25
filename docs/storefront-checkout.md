# Storefront checkout

**Status:** proposed, 25 November 2026. Planned, not built, and not yet opened as a step.
It waits on ADR 0016 (`docs/decisions/0016-storefront-payments.md`). This document assumes
that ADR's recommended answers and says where a different answer changes it.

**Proposed step:** B13.

## 1. What it is

A Buy button on a product's public page, `/@handle/<slug>`, that takes a card payment into
the creator's own Stripe account and delivers the file to the buyer.

The first version sells **one digital product at one price to one buyer at a time**.
Typefaces are the first product type, because the product record, the deliverable files,
the license record and the public page all exist already. Nothing here is specific to a
typeface: any product with a ready deliverable can be sold the same way.

## 2. What it is not

Left out on purpose. Each is a later step the founder opens, not a gap.

- A cart, or more than one product in an order
- Discount codes, sales, bundles, pay-what-you-want, free downloads
- License tiers (desktop, web, app, seat counts). One product, one price, one license
- Physical products: stock, variants, shipping, addresses
- Mac apps: builds, release notes, update feeds, license keys
- Subscriptions and memberships
- Buyer accounts, order history for buyers, re-download after the link expires
- A Refund button inside Fanwise (ADR 0016, question 2)
- Fanwise calculating tax (ADR 0016, question 3)
- Showing prices in the buyer's currency. A product sells in its own currency

## 3. Where it sits in the model

**The storefront is not a `ChannelAdapter`.** The public page is already the storefront's
representation of a product: `public_product_pages` inherits from the canonical product and
keeps only deliberate overrides. A storefront adapter would put a second representation of
the same page in `channel_listings` and leave two rows to disagree. Checkout is a property
of the public page.

What that costs: a storefront sale does not appear in a Publish Everywhere run, and the
storefront has no row on the Channels page. If the founder wants "Fanwise" listed beside
Etsy in the run summary, as the marketing mockup draws it, that is a presentation question
for the run screen and does not need an adapter.

**The payment provider sits behind a gateway**, as billing's does. `lib/payments/gateway.ts`
states what Fanwise needs in Fanwise's words; the vendor lives under
`lib/payments/providers/` and is named nowhere else. Billing and payments stay separate
contracts: one charges the creator for Fanwise, the other lets a buyer pay the creator.

Invariants this step touches, and how:

| Invariant | How it is kept |
|---|---|
| 1. The product is the source of truth | Price and currency default from `products.base_price` and `products.currency`. The offer stores an override only when the creator sets one |
| 3. External writes are idempotent | The order row and its idempotency key are written before the provider is called. A second click, or a retried job, reuses the same checkout |
| 4. Snapshots are immutable | An order records the price, currency, product title, license text and file list as they were at purchase. An order is never edited, only moved through its states |
| 6. Row Level Security | Every new table is a tenant table. `anon` holds no grant on any of them. A buyer reaches an order only through an unguessable token, by way of a server route |
| 7. Credentials | Fanwise stores the connected account's identifier, never a key for it |

## 4. The flow

### The creator, once

1. In Settings, **Storefront payments**, the creator chooses Connect Stripe.
2. Fanwise creates a connected account and sends the creator to Stripe's own onboarding.
   Fanwise never sees the bank details or identity documents.
3. Stripe tells Fanwise, by webhook, when the account can take payments. The settings
   screen shows one of three states: not connected, connected and waiting on Stripe,
   ready to sell.

### The creator, per product

4. On a product's public page settings, a switch: **Sell on Fanwise**.
5. Readiness decides whether the switch can turn on. It is deterministic, like every other
   readiness check:
   - the payments account is ready to sell
   - the product has at least one ready deliverable or archive asset
   - the price is greater than zero, in a currency the account can charge
   - the product has license terms to show the buyer
   - the workspace subscription is active (ADR 0016, question 5)
6. With it on, the public page shows the price and a Buy button above the list of other
   places to buy. With it off, the page is exactly what it is today.

### The buyer

7. The buyer chooses Buy. Fanwise records a `pending` order, then asks the provider for a
   hosted checkout page on the creator's account, and redirects the buyer to it.
   The checkout is the provider's page: no card field is ever rendered by Fanwise, so the
   content security policy (ADR 0007) does not change.
8. The buyer pays. The provider sends them back to `/@handle/<slug>/thanks`, carrying the
   order's token.
9. The provider's webhook tells Fanwise the payment succeeded. A background job marks the
   order `paid`, creates a download grant, and sends the buyer one email with the link.
10. The thanks page shows the download as soon as the order is `paid`. It waits and checks
    again while the order is still `pending`, because the buyer can arrive before the
    webhook does.
11. The download link is a Fanwise address that mints a short-lived storage link on each
    request, the mechanism ADR 0012 built. Unlike ADR 0012's link it belongs to one order,
    expires, and counts its uses.

### Afterwards

12. The creator sees the sale on a new **Orders** list: date, product, amount, buyer email,
    state.
13. A refund, made by the creator in Stripe, reaches Fanwise by webhook. The order moves to
    `refunded` and its download grant is revoked.
14. A dispute marks the order `disputed` and tells the creator. Fanwise takes no action on
    the money.

## 5. Data

Four tables, one migration each or one together, decided at build. Columns are the plan,
not the schema.

**storefront_payment_accounts**: id, workspace_id (unique), provider,
external_account_id (unique), country, default_currency, charges_enabled,
details_submitted, requirements_due (jsonb), connected_at, disconnected_at, updated_at

One per workspace. No secret column exists to protect.

**storefront_offers**: id, workspace_id, public_product_page_id (unique), product_id,
status (`off`, `on`), price_override, currency_override, created_at, updated_at

One per public page. An empty override means "use the product's price". Composite foreign
keys carry `workspace_id`, as everywhere else.

**storefront_orders**: id, workspace_id, offer_id, product_id, public_product_page_id,
status (`pending`, `paid`, `refunded`, `disputed`, `expired`, `failed`), idempotency_key
(unique), access_token_hash (unique), external_checkout_id, external_payment_id (unique
when present), amount, currency, tax_amount, buyer_email, buyer_name, buyer_country,
snapshot (jsonb: title, price, license text, files), paid_at, refunded_at, created_at,
updated_at

The snapshot is written once, at creation. `buyer_*` columns are empty until payment.

**storefront_download_grants**: id, workspace_id, order_id, product_asset_id, token_hash
(unique), expires_at, max_downloads, download_count, revoked_at, created_at

No grant to `anon` or `authenticated`; the service role alone reads it, as with
`delivery_links`.

**Sales reporting.** `sales_events` belongs to B5 and is not built. This step does not
build it. When B5 lands, a paid storefront order becomes a sale event like any channel's.
Until then the Orders list is the storefront's own record.

## 6. Failure and edge cases the build must cover

- **Double click on Buy.** One order, one checkout. The idempotency key decides.
- **The buyer abandons checkout.** The order stays `pending` and becomes `expired` when the
  provider says the checkout expired.
- **The webhook arrives twice, or out of order.** Each event is recorded by its provider
  id before it is acted on. A second delivery does nothing.
- **The webhook never arrives.** The thanks page asks the provider for the checkout's
  state after a wait, through the same job the webhook would have started.
- **The creator disconnects Stripe, or Stripe pauses the account.** Every offer in the
  workspace stops showing Buy at once. Pages stay up.
- **The deliverable is replaced after a sale.** The grant points at the asset the buyer
  paid for. Whether a buyer should get the newer file is a product question, left open in
  section 9.
- **The email bounces.** The thanks page still has the download. The creator's Orders list
  shows the email as undelivered.
- **A provider error.** Normalized to a sentence a buyer can read; the original is stored
  on the order (rule 8).

## 7. Security and privacy

- Buyer email, name and country are the first buyer personal data Fanwise holds. They are
  visible only to members of the selling workspace, by Row Level Security, with a
  `pnpm test:db` case proving workspace A cannot read workspace B's orders.
- The order token and each download token are random, shown once, and stored only as a
  hash.
- The webhook route verifies the provider's signature before reading the body, and every
  payload is validated with Zod before use (rule 6).
- Buyer email addresses are never logged and never placed in an AI prompt.
- The Privacy Policy gains a section on buyers. The creator is the party the buyer deals
  with; Fanwise processes the buyer's details on the creator's behalf.
- GA4 must not receive the thanks page's order token. The analytics code already strips
  query strings; the build confirms it with a test.

## 8. How it would be built

Four pull requests, each leaving `main` deployable. Nothing is sellable until the third.

| Part | Scope | Done when |
|---|---|---|
| B13.1 | Payments gateway contract, the provider behind it, connected-account onboarding, `storefront_payment_accounts`, the settings screen | A creator connects a test account and the screen reads "ready to sell" |
| B13.2 | `storefront_offers`, readiness, the Sell on Fanwise switch, the Buy button, `storefront_orders`, the hosted checkout | A test card reaches the provider's success page and one `pending` order exists, however many times Buy was clicked |
| B13.3 | The webhook, the paid job, `storefront_download_grants`, the buyer email, the thanks page | A test purchase delivers the real file by email and on the page. A replayed webhook creates nothing |
| B13.4 | The Orders list, refund and dispute handling, the disconnected-account state | A refund in the provider's dashboard revokes the download within a minute |

**Exit, run by a person:** a stranger buys a typeface on a live page with a real card,
receives the file, and the creator sees the order. The creator refunds it and the link
stops working. Clicking Buy twice produced one order.

**What only the founder can do:**

- Answer ADR 0016
- Turn Connect on in the Fanwise Stripe account and complete its platform profile
- Enter the Connect webhook signing secret in Netlify
- Verify a sending domain in Resend for buyer email, if question 4 is yes
- Have a lawyer read the Terms and Privacy changes, and a tax adviser the directory
  question in ADR 0016

## 9. Open questions that do not block a start

1. When a creator uploads a newer file, do past buyers get it? The plan says no, until
   there is a reason.
2. How long does a download link live, and how many uses? Proposed: 30 days and 5
   downloads, with the creator able to reissue from the Orders list.
3. Does the Buy button sit above the other shops on the page, or among them? Proposed:
   above. The creator keeps the whole sale there.
4. Does a storefront sale show in the Publish Everywhere run summary? See section 3.
