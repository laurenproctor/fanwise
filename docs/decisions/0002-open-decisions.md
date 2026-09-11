# 0002: The open decisions register

**Status:** living document, opened 4 September 2026
**Purpose:** hold every decision that is still owed an answer, and record where the
answered ones were written down

---

## How to use this

`0001` is an architecture decision record: one decision, argued once, closed. This file is
the opposite shape. It is a queue.

Every entry is either **open**, with the options and a recommendation, or **resolved**, with
a pointer to the document that now owns it. When something is resolved, move it to the
resolved table and delete the argument from here. The argument belongs wherever the decision
now lives, not in a register of things still to decide.

Entries are grouped by **when the answer is needed**, because a decision with no deadline is
a decision that gets made by accident.

---

## Already resolved

Keep these here only as pointers. Do not relitigate them from this file.

| Decision | Answer | Recorded in |
|---|---|---|
| Shopify digital delivery | Assisted file step. Not Fanwise-hosted, not a third-party app | `docs/decisions/0001` |
| Who owns the Shopify buyer relationship | Nobody at Fanwise. Option C means no buyer email ever reaches us | `docs/decisions/0001`, consequence |
| Does Creative Market join Gate A | Yes, as A8, decided 7 September 2026 and reversing the earlier no. It is the only billable channel no approval gates. The reversed argument is kept in full, and A8 cannot run the composed-listing test, which moves to B2a | `docs/roadmap.md`, under Gate A |
| Model and cost per generation | Sonnet 5 (`claude-sonnet-5`), profile prefix cached, effort low. About $0.01 per listing generation with the cache warm, ~$0.014 cold. Decided 7 September 2026 | this file, item 12 |
| Generations metered or unlimited | Unlimited on paid, 25 per month on free. At Sonnet 5 rates a heavy paid user costs about $2 of a $9 plan; a free cap of 25 costs about a quarter. Decided 7 September 2026 | this file, item 13 |
| Is the in-process job queue enough through Gate A | Overtaken: Trigger.dev arrived with B1's reorder, before A7. Selected by `TRIGGER_SECRET_KEY`, in-process otherwise. Decided 7 September 2026 | `docs/architecture.md`, Jobs |
| Where channel capabilities live | Code, in `lib/channels/registry.ts`. Never an editable row | `docs/data-model.md`, A3 |
| Listing uniqueness | `(product_id, channel_connection_id)`. Two shops on one marketplace are two listings and two billable units | `docs/data-model.md`, A3 |
| `channels.billable` | Ships at A3, unused until C1, rather than backfilled across live connections later | `docs/data-model.md`, A3 |
| Requirements as data or code | Declarative specs walked by one evaluator | `docs/channel-adapters.md` |
| Readiness arithmetic | Errors resolved over errors total. Warnings never block. `ready` is never a threshold | `docs/channel-adapters.md` |
| When `listing_snapshots` arrives | A3, so the insert-only constraint lands with the schema | `docs/data-model.md`, A3 |
| Where credentials live | Their own table with no grant to `authenticated` at all. RLS filters rows, not columns | `docs/data-model.md`, A3 revision |
| Listing editing model | Independent rows plus a per-field pull from canonical. Never a live binding | `docs/channel-adapters.md` |
| Re-verify ADR 0001 before A5 | Done, 4 September 2026. Shopify still has no digital-file API, so the ADR stands unchanged | this file |
| Reconnect gaming | A connection bills for a minimum of one full period | `CLAUDE.md`, pricing |
| V1 roles | Owner only. The enum holds four, the UI exposes one | `docs/data-model.md`, A1 |
| The three app registrations | All approved by 8 September 2026: Shopify by 5 September, Etsy's developer app and commercial access by 8 September. Submission dates went unrecorded | `docs/roadmap.md`, dependency table |
| How a Shopify product reaches a sales channel | Option A, Fanwise publishes it. `activate` sets ACTIVE then calls `publishablePublish`; two publication scopes, and Reconnect keeps the listings. Decided 7 September 2026, ran live the same day | `docs/decisions/0004`, `docs/channels/shopify.md` §16 |
| Credentials key rotation plan | Written 4 September 2026, before the first token was stored. `key_version` selects the key a row opens with; rotation is a migration, not a guess | `docs/decisions/0003` |
| `listing_manual_steps` | Landed at A5 with Shopify, migration `20260904190000_shopify_publishing`, and described in the data model | `docs/data-model.md` |
| `next dev` writes into `CLAUDE.md` | Committed, 5 September 2026. The block is part of the file, so a dev run no longer dirties the tree | `CLAUDE.md`, the `nextjs-agent-rules` block |
| Who sends Fanwise's email | Resend, over SMTP from a verified subdomain. Wired in `supabase/config.toml` and applied by `pnpm auth:push` from a temporary deployment worktree at an approved commit, which refuses to run until the four `SMTP_*` values are set. Decided 9 September 2026 | `docs/decisions/0008` |
| Email Gumroad about their product API | Overtaken on 11 September 2026: the API had shipped. File upload 30 March 2026, product creation 6 April, publish by default 6 September. Planned as B10; the email survives as item 27 with a different ask | `docs/channel-feasibility.md`, `docs/channels/gumroad.md` |

---

## Now: external waits that nobody controls

These cost nothing to start and cannot be hurried once started. They are first because the
queue is not ours.

### 3. Get a live Creative Market seller account

`docs/channels/creative-market.md` section 13 lists ten questions marked **[verify]** that
can only be settled by logging in: title limits, description rules, the tag and subcategory
trees, whether they parse the zip to build the buyer-facing manifest. A8 is blocked on a
login, and the login is free.

This moved up in urgency on 7 September 2026. Creative Market used to be B3, a whole gate
away; it is now A8 and inside the gate that closes the loop, so a login nobody has done sits
between Fanwise and Gate A. It is also the cheapest item on this page: no application, no
review, no waiting on anyone.

**Recommendation:** do it now, before A8 opens rather than during it, and record the answers
in that file as they land.

Partly overtaken on 7 September 2026: the upload step of the Shop Owner Application form was
observed without a shop login. It settled the tag minimum, the image hard cap and the image
minimum, and it surfaced a required generative AI disclosure the spec had not seen (item 24).
Section 13 of the spec now carries thirteen questions, three of them new, and the login is
still the only way to settle the rest.

### 25. Get a live WooCommerce store

B8 is code complete and its exit has not run. It needs a WordPress site with WooCommerce
active, on HTTPS with pretty permalinks, which is any managed WordPress host and an
afternoon. Nothing to apply for and nobody to wait on, so it sits in this section as a
prerequisite rather than as someone else's queue.

Five questions in `docs/channels/woocommerce.md` §13 can only be settled there, and two of
them decide code: the order of the store's POST and its redirect, which the callback route
currently tolerates in either order, and whether an admin-attached file shows in the API's
`downloads` array, which is what `activate` checks before it lets a product go live. If the
second is wrong the draft gate is a false refusal and B8 is not done.

The same store unblocks A7 on its own: a second live channel to orchestrate against Shopify,
without waiting on Etsy's exit.

**Recommendation:** get it now. After the Creative Market login it is the cheapest item on
this page, and unlike that login it moves two steps.

**Partly settled on 9 September 2026.** The store exists: `houseofproctor.com`, WooCommerce
active, pretty permalinks on, the `wc/v3` route index readable without credentials. The first
Connect, from a local dev server, failed on the store's own screen with "The callback_url
needs to be over SSL", and that uncovered a requirement on Fanwise's side the spec had not
stated: a public HTTPS origin, because the keys arrive by a server-to-server POST that no
`localhost` can receive. §9 of the spec and `.env.example` now say so. The run moves to the
hosted deployment, on a domain being bought for it. What is still owed is the run itself.

---

### 26. Get a Behance profile with Stripe connected

B9 is planned and not opened, and it is planned around a form nobody at Fanwise has seen from
the seller's side. It needs a Behance profile with a Stripe account connected, which is a
free signup and a Stripe onboarding, then one draft project with one asset attached. Nothing
to apply for and nobody to wait on, so it sits in this section as a prerequisite, like 25.

Twelve questions in `docs/channels/behance.md` §13 can only be settled there, and two decide
code before B9 can open: the names of the five asset categories in the dropdown, and the full
Creative Fields list. Both are mapping tables in the adapter, and a table guessed from the
marketplace's navigation is a table that will be wrong. A third, whether a generative-AI
disclosure field exists on the form, feeds decision 24.

**Recommendation:** do it before A8 closes, so B9 can open the day A8 does. It is the
cheapest item on this page after the Creative Market login, and unlike 25 it needs no host.

### 27. Register a Gumroad OAuth application, and tell Gumroad a multi-tenant app is coming

B10 is planned and not opened. Its build needs an OAuth application, which is self-serve in
a Gumroad account's settings at `gumroad.com/settings/advanced`: a name and one redirect URI,
so one application per environment, each with a client id and secret for that deployment.
Its exit needs a seller account with a confirmed email and a payout method, because Gumroad
refuses to publish without both. Nothing to apply for, so this sits in this section as a
prerequisite, like 25 and 26.

Eleven questions in `docs/channels/gumroad.md` §13 can only be settled with that account, and
one decides code: whether a file attached through the API reaches the buyer without a
rich-content embed.

The email item 2 used to recommend is still worth sending, with a different ask. Two things
only Gumroad can answer: whether its product-create limit, ten a minute per IP address and
escalating, has a sanctioned path for an app that creates for many sellers from shared
servers; and whether the terms' bar on commercially exploiting the Services is meant to reach
a paid tool built on the public API.

**Recommendation:** register the application and the seller account now, and send the email
now. The email is the only part of this that waits on someone else, and the per-IP answer
changes how B10 queues its creates.

---

## Shopify, before any public launch

### 4. Shopify app type: public or custom

Not answered anywhere in the docs, and it changes the shape of A5.

A **public app** means an App Store listing and Shopify's review process, with a single OAuth
flow any merchant can use. A **custom app** means a manual install per merchant, no review,
and a much shorter path to a working publish.

**Recommendation:** custom app for Gate A. The alpha is a handful of creators, review is a
queue Fanwise does not control, and the OAuth code is nearly identical either way. Revisit
before any public launch, because a custom app does not scale to self-serve signup.

---

## Before A7, orchestration

### 7. Partial-failure vocabulary

**Drafted as ADR 0005, 8 September 2026, and still open.** The proposal: a product is never
"published", a listing is; no product-level status word exists and "partially published" is
banned; a Publish Everywhere run reports *sent*, *failed* or *skipped* per channel, with a
reason on every skip, and its headline is a count. The argument and the alternatives live in
`0005-partial-failure-and-retry.md`.

### 8. Retry policy

**Drafted as ADR 0005, 8 September 2026, and still open.** What the draft found: the policy
already exists, copied into all three adapter clients, and nothing above the adapter retries
at all. The proposal: one table in two tiers, three in-call attempts within seconds and three
automatic re-attempts over twenty-one minutes, a create that is never retried after a lost
response, and a stamp on every created object so a retry can find an orphan.

### 10. Snapshot retention when a connection is disconnected

Found during A3. Disconnecting a channel cascades its listings away, and their snapshots go
with them. Correct at A3, where a listing carries no external object. Wrong the moment A5 and
A6 create listings that describe something real.

Retaining snapshots past their listing means loosening the composite foreign key, which
trades a proven tenancy guarantee for history. That trade was declined at A3, deliberately:
tenancy is one of the three things that never bend and history is not.

**Recommendation:** revisit at A7, when publication history first becomes load-bearing. If
snapshots must outlive listings, keep the workspace foreign key and drop only the listing
one, and prove the tenancy consequence with a test before shipping it.

---

## Gate A exit

### 11. Who is the outside creator

The gate is "an outside creator, unassisted, takes one of their real products from empty
workspace to two live listings, and leaves them up." That person needs recruiting well before
A7, and the "leaves them up" clause means it has to be their real catalog, not a test
product.

**Recommendation:** start the conversation during A5. A creator who has agreed in principle
two steps early is a very different prospect from one approached the week the gate is ready.

### 24. Where the generative AI disclosure lives

Discovered on 7 September 2026 from Creative Market's upload form. Every product must answer,
yes or no, whether it or one of its key features was primarily created with generative AI
tools. The answer is required and the spec at `docs/channels/creative-market.md` did not
know the field existed.

This is a factual claim about the product, not a channel preference, and other marketplaces
are adding the same question. That rules out two easy homes. It cannot live on
`channel_listings`, because the same product would be asked the same question once per
channel and could answer differently. It cannot be composed by AI, because invariant 5 says AI
never introduces a fact absent from the FactSheet, and this is exactly such a fact.

**Recommendation:** a nullable boolean on `products`, set by the creator in the product
editor, surfaced in the FactSheet as a stated fact, and required by the Creative Market
readiness check (`ai_disclosure_set`) rather than by the product schema, so products headed
only to channels that do not ask are not blocked. Null means unanswered, never no. The
migration lands with A8, since that is the first channel that needs it. Whether the wording
should be Creative Market's or a neutral Fanwise one that adapters map onto each channel's
question is the part still owed, and the neutral wording is the one consistent with adapters
being adapters.

Behance, planned 11 September 2026, asks a softer form of the same question: it encourages
every project to name the tools used, generative ones included, and supports Content
Credentials, but documents no required field. That is the neutral-wording argument made by a
second channel. The Behance adapter maps a yes onto Tools Used and the description
(`docs/channels/behance.md` §5, §9); whether the form has grown a required field since the
2023 FAQ is item 10 of that spec's §13.

### 28. Whether the assisted handoff gets a companion window

**Drafted as ADR 0010, 11 September 2026, and still open.** The founder chose a sidebar over a
browser extension that fills in marketplace forms, which Behance's, Adobe's and Creative
Market's terms forbid and `CLAUDE.md` excludes. The proposal: the handoff may be shown in a
companion window beside the marketplace's editor, under five constraints that do not bend.
It never touches the marketplace's page, holds no marketplace session, captures only what
the creator hands it, writes only `self_reported` rows, and renders the same handoff
component as the web page. Of the two forms, a pop-out window from the web app comes first,
with no install and no new client. An extension side panel comes only if the pop-out is
found wanting.

**Recommendation:** accept the constraints now, so no later session builds the other kind of
extension. Decide whether to build anything on A8's exit run and the B2a creator test:
build the pop-out if creators still lose their place between windows once the step order is
right.

---

## Gate B

### 12. Model choice and cost per generation

**Decided 7 September 2026: Sonnet 5, `claude-sonnet-5`.** Decided together with 13, as the
recommendation asked.

The comparison that decided it, at first-party API rates as of June 2026 and a listing
generation of roughly 3,000 input tokens (profile, FactSheet, rules, product facts) and 800
output (title, description, short description, tags, both meta fields):

| Model | Input / 1M | Output / 1M | Per generation, cache warm | Per 1,000 |
|---|---|---|---|---|
| Haiku 4.5 | $1 | $5 | ~$0.005 | ~$5 |
| **Sonnet 5** | $2 | $10 | **~$0.010** | **~$10** |
| Opus 5 | $5 | $25 | ~$0.027 | ~$27 |
| Fable 5.1 | $10 | $50 | ~$0.054 | ~$54 |

"Cache warm" assumes the merchandising profile and rules — about two thirds of the input —
sit in a cached prefix, which reads at roughly a tenth of the input rate. That is the shape
B1 should build to from the first request, not an optimisation for later: the profile is
the same bytes on every generation, and it is the part that makes the cost above true.

Why not Opus 5: the more capable writer, and the honest question is whether the difference
is visible *after* the factuality validator has removed anything not in the FactSheet. The
expectation is no; it is a measurement, and B1's generation logs are the eval set for it.
The provider abstraction makes the switch a configuration change if the measurement says
otherwise. Why not Haiku: cheaper still, but on the older thinking API, and the saving is
half a cent a generation against a plan priced at $9. Why not Fable 5.1: wrong shape — its
data-retention requirement is a constraint listing copy should not take on, and it costs
five times as much.

Effort: `low`. Structured copy under a validator does not repay deliberation, and it is the
first knob to turn if real usage comes in above the estimate. `ANTHROPIC_API_KEY` is set on
the development environment.

### 13. Are generations metered or unlimited

**Decided 7 September 2026: unlimited on paid, 25 per month on free.**

The number falls out of 12. A heavy paid user regenerating 200 listings a month costs about
$2 on Sonnet 5 — 22% of the $9 base — so the pricing page's promise of no cap on paid is
safe without a guardrail. On Opus 5 the same user would cost $5.40, 60% of base, and a paid
cap would have been necessary; that is the second reason 12 went the way it did.

A free cap of 25 costs about a quarter per free workspace per month, which is a real product
to try and a number nobody has to apologise for. The entitlement service gates on the count,
never on a plan name string, per `CLAUDE.md`. The cap is a starting value, not a principle:
it is expected to move once B1's logs show what a generation actually costs rather than what
this page estimates.

### 14. B4's second assisted channel

The roadmap says Adobe Stock is preferred over Framer. `docs/channel-feasibility.md` ranks
Adobe Stock "V2, highest leverage" against MyFonts "V2, if fonts are the wedge".

**Recommendation:** do not decide this now. It is a question about who the creator actually
is, and Gate A's alpha creators are the ones who answer it.

**Behance is not a third candidate**, as of 11 September 2026. It was planned as B9 on its
own, after A8, because what it tests is different: B4's two candidates carry heavy, exact
metadata, which is where assisted preparation earns its price, and Behance's metadata is
light. What Behance tests is a project-shaped handoff, and what it is worth is reach. See
`docs/channels/behance.md` §1.

### 15. How to show analytics holes honestly

Verified sales data exists for Shopify, Etsy, Gumroad and Envato only. Everything else is CSV
import or nothing, so the cross-channel revenue view — the strategically important feature —
will be partial for most creators.

`docs/channel-feasibility.md` says to "say so honestly in the product rather than showing
zeros". That is a design decision nobody has made, and a zero that means "no data" is
indistinguishable from a zero that means "no sales".

Behance, planned 11 September 2026, adds a third kind of hole: sales that exist, in full, in
the seller's own Stripe account, and nowhere Fanwise can see. "No data from this channel"
and "your Stripe has this, import it" are different sentences, and the second is B7's.

---

## Gate C, and the pricing page

### 21. How a product leaves a channel

Found on 5 September 2026, trying to disconnect a Shopify connection with one published
product.

`disconnectChannelAction` refuses while any listing on the connection carries an external id,
and that refusal is right: cascading the listing away does not remove the product from the
marketplace, it removes Fanwise's only record of it, leaving a live product nothing points at
and no way to publish again without creating a duplicate. Fanwise forgetting is worse than
Fanwise refusing.

The refusal says "remove it from the channel first." There is no way to do that. The actions
are `buildListing`, `updateListing` and `publishListing`; nothing removes one. So publishing a
single product to a channel makes that connection permanent.

That is a dead end today and a billing problem at C1, where disconnecting is the event that
decrements quantity. A creator who publishes once can never stop being charged for the
channel, and the entitlement service is coupled to `channel_connections` precisely so that
connecting and disconnecting are the billing signals.

The real question is what "remove from the channel" should mean, and it is not obvious:

- **Delist on the marketplace, then forget.** Honest, and the only version where the refusal's
  advice is literally true. Needs a `delist` capability that not every adapter can implement —
  an assisted channel cannot, so this becomes another capability with a UI that has to respect
  it.
- **Forget without delisting, behind an explicit acknowledgement.** Cheap, and re-creates the
  orphan the refusal exists to prevent, except now the creator chose it. Defensible only if
  the acknowledgement names the product and the marketplace.
- **Archive rather than delete.** Keeps the external id and the snapshots, drops the
  connection, and leaves a record that could be re-attached if the store is reconnected.
  Interacts directly with entry 10, which is the same tension seen from the snapshot side.

**Recommendation:** answer it with entry 10 rather than separately, since both are the same
question about what survives a disconnection, and decide before C1 rather than at it. Until
then the UI says the connection cannot be disconnected and why, rather than offering a button
whose only outcome is the refusal.

### 23. Is a second owned storefront included

Raised on 8 September 2026 by the WooCommerce assessment in `docs/channel-feasibility.md`.

The pricing model includes **one** owned storefront at no channel charge and names Shopify.
WooCommerce is also an owned storefront: the creator's own site, their own buyers, no
marketplace taking a cut. A creator with both is the case the model does not describe.

Two readings:

- **"Owned storefront" is a kind.** Every owned storefront is included; only marketplaces
  bill. Simple to explain, and `channels.billable` is already a property of the channel row.
  Costs the $6 on every creator who runs a Shopify and a WordPress shop, which is rare.
- **"One" means one.** The first owned storefront is included and the second bills at $6 like
  a marketplace. Truer to the sentence on the pricing page, and it turns `billable` from a
  channel property into a count against connections, which is the entitlement service's
  shape at C2 anyway.

**Recommendation:** the first reading, because the pricing page's argument is that Fanwise
charges for reach into marketplaces and not for the creator's own shop, and a second own shop
is still the creator's own shop. Decide before WooCommerce is scheduled, and write the answer
into `docs/billing.md` rule 4 either way.

**Overtaken in part on 8 September 2026.** WooCommerce was scheduled and built as B8 before
this was decided, and its migration (`20260908090000_woocommerce_channel`) took the first
reading: `billable = false`, with a comment saying the decision is still open and that
flipping it is one migration. Nothing bills before C1 either way. `docs/billing.md` rule 4
and the pricing paragraph in `CLAUDE.md` were rewritten the same day to name both rows and
this decision, so no document now describes one row where there are two. What is still owed
is the decision itself, and its deadline moved: not before B8, which has passed, but before
the pricing page is public, alongside 16 and 18. That page already lists WooCommerce as
Included, which is the first reading answered by accident, the way contradictions 2 and 3
below were.

**Gumroad, planned as B10 on 11 September 2026, is on the other side of the line.** It hosts
the creator's page on its own domain, takes a cut of every sale, and brings its own buyers
through Discover, which is what a marketplace does and an owned storefront does not. The
marketing handoff already prices it at $6. The B10 migration seeds it `billable = true`. It
is recorded here because a creator will reasonably call a Gumroad page their shop, and the
answer should not have to be reconstructed when they do.

### 16. Assisted versus automatic pricing

**The largest open commercial decision.** Charging $6 for a channel Fanwise cannot publish to
is harder to defend than charging $6 for one it can, and a customer will notice.

Two options: price assisted channels lower, around $3, or hold one price and make the
assisted preparation obviously worth it — which the Adobe Stock and MyFonts specs suggest it
can be.

**This must be settled before the pricing page is public.** See the contradictions section
below: the published mockup has already answered it by accident.

Behance, planned 11 September 2026, sharpens it. That marketplace takes 30% of every sale
unless the seller pays Adobe from $9.99 a month, so Fanwise's $6 for preparing the listing
will be read beside Adobe's cut for hosting it. An assisted price that is obviously worth it
has to be worth it against that comparison, not in the abstract.

C1 charges one channel price, 8 September 2026, because the ledger and the sync job do not
care which; a second price is a second subscription item and a second column in the provider
config, not a schema change. Still open.

### 17. Storage ceiling

"Unlimited catalog subject to fair use" needs a real number in the entitlement service. The
standing suggestion is 25 GB per workspace.

Note the interaction: the storage bucket already caps a single object at 4 GiB, so six
deliverables would exhaust a 25 GB workspace. Pick this number against real font and template
bundle sizes rather than in the abstract.

### 18. Free tier or trial

`docs/billing.md` describes neither. The roadmap's C1 says "trial". The published pricing
mockup ships a **free plan**: $0, one product, one assisted channel, limited generations, no
card required.

Those are different products with different implementations, and this is the largest
unresolved gap between the mockups and the written model.

**C1 built on an assumption rather than waiting, 8 September 2026, and the assumption is
shaped to lose cheaply.** The trial is fourteen days from workspace creation, kept on
Fanwise's side: no provider object exists until the creator subscribes, so neither answer
here needs a migration. A trial is a change to `TRIAL_DAYS`; a free plan is the entitlement
service at C2 gating on product count, channel count and the generation cap decision 13
already set. Still open.

---

## Contradictions to resolve

`CLAUDE.md` grants the marketing mockups authority over pricing and channel modes. That makes
them the de-facto answer to decisions they were never meant to settle.

1. ~~**Framer is listed "Live"** on the pricing page and **cut** in
   `docs/channel-feasibility.md`. One of the two is wrong.~~ **Resolved 7 September 2026.**
   The feasibility doc won, because it is the artefact with the research behind it: Framer
   sells a remix link rather than a file, so the canonical-product thesis does not reach it,
   and it is cut along with Webflow, Canva and Figma for the same structural reason. Framer
   is gone from `design/marketing/pricing.html` in both places it appeared — the external
   marketplace list and the "what counts as a marketplace" answer. Adobe Stock takes its slot
   in the list, marked Planned, which is also the channel that displaced it at B4.
2. **Creative Market appears as a $6 external marketplace**, which silently pre-answers
   decision 16 in favour of flat pricing.
3. **The free plan exists nowhere in `docs/billing.md`**, which pre-answers decision 18.

**Etsy and Creative Market stay marked "Live" on that page, and that is deliberate.** Etsy
became true on 11 September 2026, when A6's exit ran; Creative Market is A8, unstarted, so its
label is false today and will be true at Gate A exit. The mockup depicts the product at launch, and the marketing
site is its own deployment that ships after the gates rather than a route in this app, so it
never renders while the claim is wrong. Framer was different in kind: no amount of shipping
makes it true. Do not "correct" Etsy or Creative Market to Planned on the strength of item 1.

Envato is the weakest survivor on that list. It sits under **External marketplaces** marked
Planned, while the feasibility table rates it "V2 for analytics only" — no item creation, FTP
for audio and video alone. A creator reading that page would expect to publish to it. Not
changed here, because it is a smaller claim than Framer's and it is entangled with decision
16: whether an analytics-only connection is worth $6 at all.

**Recommendation:** decide 16 and 18 deliberately, then correct whichever artefact lost, and
narrow `CLAUDE.md`'s grant so the mockups are authoritative for **visual system and channel
modes** rather than for commercial policy. Item 1 is the precedent for how that correction
goes: the artefact with the research behind it wins.
