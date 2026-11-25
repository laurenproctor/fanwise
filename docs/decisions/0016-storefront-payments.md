# ADR 0016: How a buyer pays on a Fanwise storefront

**Status:** proposed, 25 November 2026. Not accepted. Nothing is built on it until the
founder answers the five questions under "Decision wanted".
**Date:** November 2026
**Blocks:** B13, storefront checkout (`docs/storefront-checkout.md`)
**Amends, if accepted:** the register's resolved line "Who owns the Shopify buyer
relationship: nobody at Fanwise". That stays true for Shopify. It stops being true for a
sale made on a Fanwise page.

---

## Context

The public site has said since 20 November 2026 that a creator's Fanwise page sells:
"Turn on checkout and your product page starts selling. Buyers pay you." The app does not
do that. `app/profile/[handle]/[productSlug]/page.tsx` opens with the sentence "Fanwise
takes no payment here and holds no cart", and every purchase path leaves for a channel.

Three things the site and the pricing model already promise constrain the answer:

- **"Buyers pay you."** The money is the creator's, not Fanwise's to hold.
- **"Fanwise never takes a percentage of sales."** Pricing is $9 flat plus $6 a channel.
- **The storefront is included in the $9 base.** So a sale cannot cost Fanwise a fee that
  grows with the creator's volume.

Stripe is already the billing provider, behind `lib/billing/gateway.ts`. Its platform
product, Connect, offers the three shapes weighed here. The facts below were read from
Stripe's documentation on 25 November 2026 and should be read again at build time.

### Option A. The creator connects their own Stripe account, and the buyer pays it directly

Stripe calls this a direct charge. The payment is made on the creator's account.

- **Who the seller is.** The creator. Stripe's documentation says that for direct charges
  the merchant of record is the connected account. The buyer's card statement shows the
  creator's name.
- **Refunds and disputes.** They land on the creator's Stripe balance, and the creator
  handles them in their own Stripe dashboard.
- **What it costs Fanwise.** Nothing per sale. Under Stripe's "Stripe handles pricing"
  model Stripe sets and collects processing fees from the connected account and lists no
  platform fee. The creator pays Stripe's standard card rate, as they would on any store.
- **Tax.** The creator's, as on their own Shopify store. They can turn on Stripe Tax in
  their own account.
- **What Fanwise holds.** No money, no card data, and no secret for the creator's account:
  the platform's own key acts on a connected account by naming it.

### Option B. Fanwise takes the payment and pays the creator out

Stripe calls these destination charges, or separate charges and transfers.

- **Who the seller is.** Fanwise, unless each charge is made "on behalf of" the creator.
- **Refunds and disputes.** They land on Fanwise. Stripe's risk documentation says that
  because these charges occur on the platform, the platform is responsible for the related
  negative balances.
- **What it costs Fanwise.** Stripe's Connect pricing page lists, for platforms that handle
  pricing, $2 per monthly active account and 0.25% plus 25 cents per payout, and the
  platform is responsible for the processing fees. A flat $9 cannot absorb that, so this
  option ends "never takes a percentage" or ends the margin.
- **Tax.** A platform that lists a seller's goods and collects the payment is what US
  states call a marketplace facilitator. Past a state's threshold the platform registers
  there and collects and remits the sales tax itself.

### Option C. No Fanwise checkout: the creator pastes their own payment link

The Buy button opens a link the creator made somewhere else.

- **Cheapest to build**, and no new provider relationship.
- **Fanwise never learns a sale happened.** So it cannot deliver the file, cannot show the
  sale in "every sale in one place", and the site's storefront promise stays unmet.

## Recommendation

**Option A.** It is the only one of the three that keeps all three promises at once, it
puts Fanwise in the position a software tool holds rather than the position a marketplace
holds, and it costs Fanwise nothing per sale.

What it gives up: a creator must have, or open, a Stripe account before their first sale,
and Stripe decides which countries can. A creator Stripe will not onboard cannot sell on
their Fanwise page. Option B would not help them either, since B also needs a connected
account to pay out to.

One caution that no option removes. Fanwise also runs a public directory of creators.
States define "marketplace facilitator" differently, and some definitions turn on listing
plus payment processing rather than on who the merchant of record is. Option A is the
strongest position available, and it is still a question for a tax adviser, not for this
file.

## Decision wanted

Each has a recommended answer. The spec is written to the recommendations and changes where
an answer differs.

1. **Payment model.** A, B or C above. *Recommended: A.*
2. **Who issues a refund.** The creator, in their own Stripe dashboard, with Fanwise
   noticing and revoking the download; or a Refund button inside Fanwise. *Recommended: the
   creator in Stripe, for the first version. A button is a later step.*
3. **Sales tax.** Leave it to the creator's own Stripe settings; or give Fanwise a switch
   that turns Stripe Tax on for their checkout. *Recommended: leave it to their Stripe
   settings, and say so plainly on the setup screen.*
4. **Who emails the buyer the download.** Fanwise, through Resend (ADR 0008); or nobody,
   and the download lives only on the page shown after payment. *Recommended: Fanwise sends
   one email. A buyer who closes the tab otherwise has no way back to the file. This makes
   Fanwise hold buyer email addresses for the first time, which the Privacy Policy must
   say.*
5. **Does selling need a paid workspace.** Yes, checkout turns off when the subscription
   lapses; or no, the storefront keeps selling. *Recommended: yes, with the page itself
   staying up. This touches register entry 18, free tier or trial, which is still open.*

## Consequences, if A is accepted

- A second gateway contract, `lib/payments/gateway.ts`, beside the billing one, with the
  vendor named only under `lib/payments/providers/`. The same tree-reading unit test that
  keeps the vendor out of `lib/billing` covers it.
- Fanwise stores a connected account's identifier and its readiness flags. It stores no
  credential for it, so invariant 7 is met by having nothing to protect.
- The first buyer personal data in Fanwise: an email address and a country per order. New
  tenant tables with Row Level Security, proven by `pnpm test:db`.
- The Terms need a section on storefront sales: the creator is the seller, Stripe's terms
  apply to the payment, Fanwise is not a party to the sale. A lawyer should read it.
- The founder turns Connect on in the Fanwise Stripe account and enters one new webhook
  signing secret in Netlify. An agent does neither.
