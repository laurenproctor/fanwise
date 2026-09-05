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
| Does Creative Market join Gate A | No. It stays at B3; A3's assisted mock proves the capability matrix instead | `docs/roadmap.md`, under Gate A |
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

---

## Now: external waits that nobody controls

These cost nothing to start and cannot be hurried once started. They are first because the
queue is not ours.

### 1. The three app registrations

**Status:** in progress as of 4 September 2026, none confirmed submitted.

Etsy developer app, Etsy commercial access, Shopify Partner account. None blocks A3 or A4,
which are mock-only. The Shopify Partner account gates **A5's exit test**, and it is
self-serve and free, so it is minutes of work rather than a queue. Etsy commercial access is
different: discretionary, no published SLA, applicants report waiting weeks, and it gates
A6.

**Recommendation:** treat Etsy commercial access as the single largest schedule risk in
Gate A and file it before anything else. Record real submission dates in the roadmap's
dependency table as each goes in.

### 2. Email Gumroad about their product API

Their product-creation endpoints are documented but unimplemented. Under the current pricing
model Shopify is the included storefront, so **at Gate A exit the only billable automatic
channel is Etsy** — a marketplace whose approval is discretionary, whose ToS contains a
clause that could be read against Fanwise, and whose application-level rate limit caps total
platform throughput.

**Recommendation:** send the email. It is the highest-value business development conversation
available and it costs one message. A second billable automatic channel would materially
de-risk Gate A's revenue story.

### 3. Get a live Creative Market seller account

`docs/channels/creative-market.md` section 13 lists ten questions marked **[verify]** that
can only be settled by logging in: title limits, description rules, the tag and subcategory
trees, whether they parse the zip to build the buyer-facing manifest. B3 is blocked on a
login, and the login is free.

**Recommendation:** do it well before B3, and record the answers in that file as they land.

---

## Before A5, Shopify

### 4. Shopify app type: public or custom

Not answered anywhere in the docs, and it changes the shape of A5.

A **public app** means an App Store listing and Shopify's review process, with a single OAuth
flow any merchant can use. A **custom app** means a manual install per merchant, no review,
and a much shorter path to a working publish.

**Recommendation:** custom app for Gate A. The alpha is a handful of creators, review is a
queue Fanwise does not control, and the OAuth code is nearly identical either way. Revisit
before any public launch, because a custom app does not scale to self-serve signup.

### 5. The credentials encryption key rotation plan

`docs/security.md` says the rotation plan is written **before** the first real credential is
stored, not after. A5 is where that clock runs out.

The schema is ready: `channel_connection_secrets` carries `key_version` precisely so rotation
is a migration rather than a guess. What is missing is the written procedure — how a new key
is introduced, how rows are re-sealed, and what happens to a connection whose key version is
retired.

**Recommendation:** write it as `0003` before the first token is stored.

### 6. `listing_manual_steps`

ADR 0001 introduces this table and `docs/data-model.md` does not describe it. It carries the
outstanding `attach_digital_file` step that makes "fully published" a derived condition
rather than a status value.

**Recommendation:** land it at A5 with Shopify rather than at A3, and add it to the data
model in the same PR. It is Shopify's problem first, and A3 should not have built a table it
could not test.

---

## Before A7, orchestration

### 7. Partial-failure vocabulary

Two channels, one succeeds, one fails. Is the product "published", "partially published", or
neither? Combined with ADR 0001's derived "fully published" condition, there are now three
states that are not a status enum.

**Recommendation:** decide the words before the UI exists. `CLAUDE.md` already insists the
vocabulary is consistent across code, UI and docs, and this is the first place it genuinely
strains.

### 8. Retry policy

Which normalized error codes are retryable, how many attempts, what backoff.

**Recommendation:** one table, owned by `lib/publishing`, not a judgement made per adapter.
An adapter that decides its own retry policy is an adapter that will eventually retry
something non-idempotent.

### 9. Is the in-process job queue enough through Gate A

Trigger.dev is deliberately deferred to B1. But an in-process queue dies with the serverless
function, and A7 is the first step with a job long enough for that to matter.

**Recommendation:** keep the deferral, and test A7 against a real deployment early rather
than locally. If it breaks, pulling Trigger.dev forward is a change behind
`lib/jobs/index.ts` and nothing else, which is the entire point of that abstraction.

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

### 20. Who sends Fanwise's email

Discovered on 5 September 2026, pushing `config.toml` to a hosted Supabase project:

> Email template modification is not available for free tier projects using the default email
> provider. Please upgrade your plan or configure a custom SMTP provider.

Two consequences, and the second is the one that matters.

Signup on a hosted project defaults to requiring email confirmation, and the built-in sender
is rate limited to a handful of messages an hour. The first few signups on a fresh project
fail with "Too many attempts", which is our own normalization of a rate limit nobody has hit
locally, because local runs with `enable_confirmations = false`.

The real problem is the recovery template. `supabase/templates/recovery.html` exists because
the stock template returns a PKCE code that only works in the browser that asked for the
reset — someone who requests a reset on a laptop and opens the mail on their phone gets an
invalid link, and recovery is exactly the flow where that happens. That template cannot be
installed on the default provider. So a deployment on the built-in sender silently reverts to
the stock template and reacquires the bug the custom one was written to fix. Nothing errors.
Password recovery simply half-works, on the flow least likely to be exercised before a real
person needs it.

This is grouped at Gate A exit rather than later because that gate puts an outside creator on
a deployed instance. That is the first moment the built-in sender stops being adequate.

**Recommendation:** configure custom SMTP before anyone outside the team touches a deployed
project, and treat the provider as part of the environment rather than a detail of the auth
config. Resend or Postmark, chosen for deliverability on transactional mail rather than
price; the volume through Gate A is trivial either way. Until then, a dev project runs with
`enable_confirmations` off and no custom template, and `pnpm test:e2e` continues to prove the
recovery flow against local Supabase, where the template does load.

---

## Gate B

### 12. Model choice and cost per generation

Anthropic is decided. Which model, and what a generation costs, is not, and it feeds the free
tier's "limited AI listing generations" promise.

### 13. Are generations metered or unlimited

The entitlement service needs a number. The pricing page promises "AI-generated marketplace
listings" with no cap on paid and "limited" on free.

**Recommendation:** decide both together with 12, since the cost per generation determines
what a defensible limit looks like.

### 14. B4's second assisted channel

The roadmap says Adobe Stock is preferred over Framer. `docs/channel-feasibility.md` ranks
Adobe Stock "V2, highest leverage" against MyFonts "V2, if fonts are the wedge".

**Recommendation:** do not decide this now. It is a question about who the creator actually
is, and Gate A's alpha creators are the ones who answer it.

### 15. How to show analytics holes honestly

Verified sales data exists for Shopify, Etsy, Gumroad and Envato only. Everything else is CSV
import or nothing, so the cross-channel revenue view — the strategically important feature —
will be partial for most creators.

`docs/channel-feasibility.md` says to "say so honestly in the product rather than showing
zeros". That is a design decision nobody has made, and a zero that means "no data" is
indistinguishable from a zero that means "no sales".

---

## Gate C, and the pricing page

### 16. Assisted versus automatic pricing

**The largest open commercial decision.** Charging $6 for a channel Fanwise cannot publish to
is harder to defend than charging $6 for one it can, and a customer will notice.

Two options: price assisted channels lower, around $3, or hold one price and make the
assisted preparation obviously worth it — which the Adobe Stock and MyFonts specs suggest it
can be.

**This must be settled before the pricing page is public.** See the contradictions section
below: the published mockup has already answered it by accident.

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

---

## Contradictions to resolve

`CLAUDE.md` grants the marketing mockups authority over pricing and channel modes. That makes
them the de-facto answer to decisions they were never meant to settle.

1. **Framer is listed "Live"** on the pricing page and **cut** in
   `docs/channel-feasibility.md`. One of the two is wrong.
2. **Creative Market appears as a $6 external marketplace**, which silently pre-answers
   decision 16 in favour of flat pricing.
3. **The free plan exists nowhere in `docs/billing.md`**, which pre-answers decision 18.

**Recommendation:** decide 16 and 18 deliberately, then correct whichever artefact lost, and
narrow `CLAUDE.md`'s grant so the mockups are authoritative for **visual system and channel
modes** rather than for commercial policy.

---

## Housekeeping

### 19. `next dev` writes into `CLAUDE.md`

Running the dev server appends a `<!-- BEGIN:nextjs-agent-rules -->` block to `CLAUDE.md`,
telling agents to read `node_modules/next/dist/docs/` before writing code. It is regenerated
by `next dev` every time it is removed.

It has been reverted rather than committed, because an instruction file should not change as
a side effect of starting a server.

**Recommendation:** decide once whether to commit the block or suppress it. An uncommitted
change that reappears on every dev run is noise in every future diff.
