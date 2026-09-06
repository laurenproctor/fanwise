# Roadmap

**Current step: A5. Publishing, updating and image repair are verified against a live Shopify
store, and idempotency is proven by test. One exit clause remains unrun, and running the rest
uncovered a blocker for it: an ACTIVE Shopify product is not on a sales channel and nobody can
buy it. See the note below.**

Three gates. Nothing after a gate begins until the gate passes. Update the line above when a
step completes, and do not work on more than one step at a time.

## External dependencies, file these first

| Dependency | Needed by | Submitted | Approved |
|---|---|---|---|
| Etsy developer app | A6 | in progress | |
| Etsy commercial access | A6 | in progress | |
| Shopify Partner account | A5 | yes, date unrecorded | by 5 Sep 2026 |

Etsy commercial access has no published SLA and applicants report waiting weeks. It is the
single most likely thing to delay the roadmap, and it costs nothing to file today.

**Shopify is done. Etsy is not, as of 5 September 2026.** A0 was marked done on the
strength of its four checks passing, but filing these was part of A0's scope and was never
done.

The Shopify row is filled in from evidence rather than from memory: client id and secret are
set, OAuth has completed against a real development store, and a product has published to it.
Nobody recorded the submission date at the time, which is the small version of the same
failure this table exists to catch — the work was done and the roadmap went on saying it
was not. Record the date when you file the Etsy applications.

These do not block A3, A4 or any step before A5. A3 and A4 are mock adapters and a manual
editor: no OAuth, no credentials, no external call. The reason this table sits at the top
of the roadmap is latency, not dependency. Start the clock early so the queue runs down
while the code is written.

Record the real submission date in the table when each is filed, and treat an unapproved
Etsy commercial access as a live risk from A6 onward, not as a surprise discovered there.

---

## Gate A: the loop closes

One real product, published to two channels, by a person who is not you.

| Step | Content | Exit test | Status |
|---|---|---|---|
| A0 | Repo, CI, Supabase, env validation, job abstraction. File the app registrations | `main` deploys, migrations apply clean, all four checks green | code done, **app registrations outstanding** |
| A1 | Auth, workspaces, membership, RLS | Workspace A cannot read any Workspace B row, proven by test, for every table | done |
| A2 | Canonical product, product types, assets, storage, checksums, image derivative service | A complete product exists with correct derivatives for two image specs, no channel connected | done |
| A3 | Channel registry, connections, listings, adapter contract, capability matrix, requirements engine, two mock adapters, one `api`-shaped and one `assisted`-shaped | One product yields two independent mock listings, the assisted mock implements no `publish`, and the UI offers none. No marketplace string in the product domain | done |
| A4 | Manual listing editor, no AI. Readiness UI | A user hand-writes a listing per channel and sees deterministic readiness | done |
| A5 | Shopify: OAuth, adapter, publish, idempotency, error normalization, digital delivery decision | Real product publishes, second click creates nothing, the file is actually deliverable to a buyer | code done, two exit clauses **verified**, buyer download **blocked**: the product is not purchasable |
| A6 | Etsy: OAuth, adapter, draft, images, digital file, activate, idempotency | Real product publishes and is purchasable | |
| A7 | Publish Everywhere orchestration, jobs, progress, retry, activity log | One action, two live URLs, one failure recovered without duplicates | |

**Gate A passes when** an outside creator, unassisted, takes one of their real products from
empty workspace to two live listings, and leaves them up.

**A5's exit test is two thirds run.** The three clauses are: a real product publishes, a
second click creates nothing, and the file is actually deliverable to a buyer. Two are
answered. The third has not been attempted.

Verified against the development store `fanwise-2rxa5frl.myshopify.com`, from a hosted
Supabase project on 5 September 2026:

- OAuth completes and credentials seal and unseal.
- Two products published. `holden-hand` at `gid://shopify/Product/9406518788332` and
  `facette-display-typeface` at `gid://shopify/Product/9406555062508`, admin URLs persisted,
  `publish` and `activate` succeeding on attempt one in both cases.
- **The cover image arrived on the Shopify product.** This is what answers §13 item 3 of
  `docs/channels/shopify.md`: Shopify's asynchronous fetch of a Supabase signed URL does
  complete inside the URL's lifetime. The earlier run that produced an imageless product
  failed for an environmental reason — the signed URL pointed at a Supabase running on
  localhost, which Shopify cannot resolve — and not because of the timing the question was
  written to test.

**A second click creates nothing** is answered by test rather than by gesture, and that is the
stronger answer. `tests/db/publication-idempotency.test.ts` proves it against real Postgres
with RLS enabled: the second call loses on the unique constraint, reads the existing row,
enqueues nothing and contacts no provider, and writes no second snapshot — including when the
listing was edited in between, which is the case a naive key would miss.

The exit test's own wording is misleading here and should be read as the guarantee rather than
the gesture. There is no way to click Publish twice on one listing: the button renders only
while a listing is unpublished, because offering one whose only outcome is "already published"
would be offering a lie. The double submission the key actually defends against is two stale
tabs, a retried job, or a network retry — none of which is a second click.

**A buyer can actually download the file** is not answered and has not been attempted. The
`attach_digital_file` step being complete is the creator asserting they attached the file in
the Shopify admin. No order has been placed and no file has been pulled. This clause needs a
test order on the development store, and it is the one that catches a step ticked but not
done.

Two things this evidence is not. It is a hosted **development** project, not a production
deployment. And it predated the fix that sends every image rather than only the cover.

## The 6 September run

Same development store. Four changes landed and were then exercised in one click, which is
worth stating as one event because each depended on the ones before it.

`Facette Display Typeface` (`gid://shopify/Product/9406555062508`) went from **one image to
four**, cover still first, and stayed **ACTIVE**:

- The image fix sends every image the listing holds when the channel is short, rather than
  only when the channel holds none. The product had received its cover on the create and
  could never have received the rest.
- `update()` no longer reads a missing `metadata.externalState` as "this is a draft". That
  listing's metadata was `{}`, so under the previous rule this same click would have sent
  `DRAFT` and taken a live product off sale.
- A migration repaired two listings a rebuild had reset to `draft`/`self_reported`, which is
  what let the panel offer the action at all.
- The update path was wired. It existed end to end and had no caller, so `automaticUpdate`
  was declared and unreachable. This was the first `update` job in the project's history.

This closes the "not re-confirmed against Shopify" caveat above: the image behaviour is now
confirmed on a live product, not only in unit tests.

**Three of §13's open questions in `docs/channels/shopify.md` are now answered by a read of
the live products**, and one of them is answered the wrong way.

| Item | Question | Answer |
|---|---|---|
| 1 | Is the default-variant convention accepted, and is a second mutation needed for price? | Accepted. One variant, `Title` / `Default Title`, price set in the same `productSet`. No second mutation. |
| 2 | Is `requiresShipping: false` honored at creation rather than only on update? | Honored at creation. A product created and never updated reads `requiresShipping: false`, `tracked: false`. |
| 4 | Does `onlineStoreUrl` populate on activation? | **No.** It is null on ACTIVE products, not only on drafts. |

## The blocker this run uncovered

**An ACTIVE Shopify product is not necessarily purchasable, and ours are not.**

All three products read `publishedAt: null` and `onlineStoreUrl: null`, including the two
that are ACTIVE. In Shopify, `status: ACTIVE` and *published to a sales channel* are
different facts. Ours are active and on no sales channel, so no storefront page exists and
no buyer can reach them.

The adapter cannot currently fix this. `productSet` sets status, not channel publication;
that needs `publishablePublish`, and the OAuth scopes in `lib/channels/adapters/shopify/config.ts`
are `write_products` and `read_products` only. Adding a scope means re-authorising every
existing connection, so this is a decision, not a patch.

Two consequences, and the second is worse than the first:

1. **The third exit clause is not merely unrun, it is blocked.** A buyer cannot download the
   file because a buyer cannot reach the product.
2. **Fanwise currently tells the creator something untrue.** `liveness` reports `live` as
   "On the channel, and available to buy" once the manual file step is done. For these
   products the first half is true and the second is false. That is precisely the confusion
   `published_not_live` was invented to prevent — ADR 0001 built the distinction for the
   unattached-file case and this is a second way to be unbuyable that the vocabulary does
   not yet cover.

Nothing here is a defect in the code that was written. It is an assumption — that ACTIVE
means for sale — which nobody had tested, and which the exit test existed to catch.

This step is still deliberately **not** recorded as done. A0 was marked complete on the
strength of its checks passing while the app registrations it also owned were never filed, and
that error went unnoticed for four steps. The correction this file has already absorbed was
the same failure inverted — work genuinely done, and the roadmap still saying the Partner
account was outstanding. Both directions cost the same, so the rule does not change: a clause
nobody has run is a clause that says so.

What remains for A5, in order:

1. **Decide how a product reaches a sales channel.** Either Fanwise publishes it, which means
   adding a publications scope and re-authorising every connection, or it does not, which
   means the creator does it in the Shopify admin and it becomes a manual step with the same
   standing as attaching the file. Until this is decided, "live" cannot honestly be shown.
2. **Correct what `liveness` claims** in whichever direction step 1 settles. A product that
   is on no sales channel must not be reported as available to buy.
3. **Then place a test order and download the file as a buyer**, which is the clause that has
   never been attempted and cannot be attempted before step 1.

The image half of the old "worth doing in the same sitting" note is done: republishing
confirmed the supporting images arrive.

**No third channel joins Gate A.** Creative Market was considered for it, on the argument
that the pricing model is not real until a billable channel exists, and that at Gate A exit
the only billable channel is Etsy, whose approval is not ours to grant. It stays at B3
anyway. The thing Creative Market would prove early is the capability matrix, not the
revenue, and A3's assisted mock adapter proves that for free: an adapter with no `publish`
method, a UI that consequently offers no publish button, and `status_source` that can only
ever be `self_reported`. Building a real assisted channel to learn the same lesson adds a
marketplace to the gate that closes the loop, which is the one thing the gate is shaped to
avoid. The Etsy dependency is a real risk and is answered where it lives, in the external
dependency table above, not by widening Gate A.

## Gate B: the abstraction holds and the money comes back

| Step | Content |
|---|---|
| B1 | AI provider abstraction, Anthropic, FactSheet, merchandising profiles, factuality validator, generation logs. Adopt Trigger.dev here |
| B2 | Listing review UI: field edit, field regenerate, full regenerate, restore, approve |
| B3 | Creative Market assisted: package build, handoff, mark submitted, URL capture. See `docs/channels/creative-market.md` |
| B4 | Second assisted channel. Adobe Stock preferred over Framer, see `docs/channel-feasibility.md` |
| B5 | `sales_events`, transaction ingestion for Shopify and Etsy, dedupe constraints |
| B6 | Analytics overview: revenue, units, by channel, by product |
| B7 | CSV import foundation |

## Gate C: a stranger can pay

| Step | Content |
|---|---|
| C1 | Stripe: base subscription, per-channel quantity, connect and disconnect billing events, proration, trial, portal |
| C2 | Entitlement service gating on channel count and type |
| C3 | Onboarding, empty states, activation instrumentation |
| C4 | Hardening: auth, RLS, tokens, secrets, storage, rate limits, webhooks, accessibility, responsive, full E2E |

## The marketing site

Not part of any gate. `design/marketing/` holds the published mockups; when the public site
ships it should be its own deployment, not a route in this app. Do not mix marketing pages
into `app/` while the gates are in progress.

## Deliberately out of scope for V1

Product versions table, viewer and editor roles, Framer, metric snapshots, multi-currency,
browser automation, physical commerce, and everything in the strategy document marked V2 or
V3.
