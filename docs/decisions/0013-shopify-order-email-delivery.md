# ADR 0013: Shopify delivers through a download link in the order email

**Status:** accepted, 15 September 2026, at the founder's request.
**Date:** September 2026
**Supersedes:** ADR 0001's assisted file step for Shopify, and its draft gate
(`docs/channels/shopify.md` §6 before this date). ADR 0004's sales-channel publication is
unchanged and now runs on every publish and update.
**Builds on:** ADR 0012, whose download links and `delivery_links` table this reuses unchanged.

---

## Context

ADR 0012 made WooCommerce fully automatic on 13 September 2026 by giving each product a Fanwise
download address. The founder asked the same of Shopify on 15 September. Shopify is harder:
WooCommerce stores a download as an address and serves it to buyers, and Shopify has no
downloadable-file field at all, in any API, including its own Digital Downloads app.

Two ways to get a Fanwise link to a Shopify buyer were put to the founder:

1. **The shop's own order confirmation email prints it.** Fanwise writes the link onto the
   product as a metafield, which `write_products` already permits, and the creator adds a short
   Liquid snippet to the Order confirmation template once per shop.
2. **Fanwise emails each buyer.** An `orders/paid` webhook, `read_orders`, Shopify's
   protected-customer-data approval to read the buyer's email, and a transactional email
   provider. No template edit, but a new scope and reconnect, an external approval that can take
   days, and email infrastructure Fanwise does not yet send from.

## Decision

**The first.**

- **On the product.** Every `productSet` writes two metafields in namespace `fanwise`:
  `download_url` (type `url`), the Fanwise address for the first ready `deliverable` or
  `archive` asset, minted through `PublishContext.deliveryUrl` and reused on every write; and
  `download_name` (`single_line_text_field`), its filename. A product with no deliverable gets
  neither. Only the first file: a readiness warning, `one_download`, says so when there are more.
- **In the email.** `ORDER_EMAIL_SNIPPET` loops the order's line items and prints a download
  button for each whose product carries `fanwise.download_url`, only when `financial_status` is
  `paid`, and otherwise a line saying the link follows payment.
- **Setup, once per connected shop.** The adapter declares `deliverySetup` (title, why, steps,
  snippet). The Channels page renders it generically with a Copy button and **I've added it**,
  which records `deliverySetupConfirmedAt` on the connection's metadata
  (`setDeliverySetupAction`). The OAuth callback carries that key across a reconnect of the same
  account (`carryDurableMetadata`), because the template lives in the shop, not in the token.
- **Readiness gates it.** A new error requirement, `download_email_ready`, is unsatisfied until
  that confirmation exists. No Shopify product can go on sale before the shop's email prints the
  link, which keeps ADR 0001's one non-negotiable: a product that can take money with nothing
  behind it does not happen.
- **Publishing is one action.** `publish` and `update` both set `ACTIVE`, put the product on the
  Online Store (ADR 0004) and read `purchasable` from the publication count. An update leaves an
  `ARCHIVED` product archived and refuses a status it cannot read, as before. `activate`, the
  manual step and `drafts` are gone; `digitalFileUpload` is true.
- **Listings published under ADR 0001** show **Publish changes** once readiness passes (the
  resend rule from ADR 0012), which puts them on sale with their link.
- **Replace download link** works as on WooCommerce, with a warning first
  (`deliveryLinkReplaceNote`): the old link already sits in past buyers' order emails, and
  replacing it takes their download away.

## What this does not protect

Everything ADR 0012 says about a bearer address holds. In addition, the link is in an email, so
anyone the buyer forwards it to can download until it is replaced, and replacing it cuts off
every past buyer. The confirmation is the creator's claim about their own template; Fanwise
cannot read the template to check it.

## Consequences

- **[verify] on a live shop:** that the Order confirmation template resolves
  `line.product.metafields.fanwise.download_url` to the address. Shopify's notification variables
  reference documents product metafields on line items; one community report says otherwise.
  The founder's first test order settles it.
- An order paid by a manual method (bank transfer) gets the "after payment" line and no link;
  Shopify sends no second email when payment arrives. The creator sends the link by hand in that
  case, from the product's metafield. Card payments are paid at checkout and unaffected.
- A disconnect deletes the connection and with it the confirmation. Reconnecting after a
  disconnect asks for it again; the snippet in the shop still works.
- The metafield has no definition and no storefront access, so a theme does not show it unless
  someone writes theme code to.
- Option 2 remains open if the template route proves unreliable on real shops. It would need
  `read_orders`, which B5 adds anyway, and protected-customer-data approval.
