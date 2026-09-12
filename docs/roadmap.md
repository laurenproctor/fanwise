# Roadmap

**Current step: A7 is merged, its exit unrun.** One
click plans a run from the channel registry, starts a job per channel that can take the
product, names every channel it skipped and why, records the run in `workspace_events`, and
re-attempts a retryable failure three times over twenty-one minutes before it stops. The
exit — one action, two live URLs, one failure recovered without duplicates — needs a live
Shopify and a live Etsy, and is a run a person does by hand. ADR 0005 was accepted to build
it, with the stamp-and-search create guard deferred.

**A6 is done.** Its exit ran on 11 September 2026 against the live shop `Fanwise`: connect,
publish, and an active listing in one job, with four of the five §13 questions in
`docs/channels/etsy.md` settled; see "The A6 exit run" below. B1, B2 and B8 are also on
`main`, each code complete with its exit unrun; see their sections under Gate B. A5 is done; all three exit clauses ran against a live Shopify
store. What remains of Gate A: A7 has its two live channels, Shopify and Etsy, and is blocked
on nothing; A8 waits on a Creative Market seller login; and the gate's own exit — an outside
creator, unassisted — waits on a real portfolio to hand them.

**Two things shipped outside the step order**, both at the founder's direction and neither
part of a gate: first-run onboarding on 11 September 2026 as PR #61, and the public creator
pages on 12 September 2026 as PR #72. See "The public creator pages" below for what the
second one means for Gate A's exit test, which is a question still open.
**Gate A is not passed.** Gate A's exit test is still owed before Gate B's is attempted. See
"Reordering" below.

Before B1 opened, two decisions in `docs/decisions/0002` were owed answers: 12 (model and
cost per generation) and 13 (metered or unlimited). Both were decided on 7 September 2026,
and the model key is set on the development environment.

---

Three gates. Nothing after a gate begins until the gate passes. Update the line above when a
step completes, and do not work on more than one step at a time.

## External dependencies, file these first

| Dependency | Needed by | Submitted | Approved |
|---|---|---|---|
| Etsy developer app | A6 | date unrecorded | by 8 Sep 2026 |
| Etsy commercial access | A6 | date unrecorded | by 8 Sep 2026 |
| Shopify Partner account | A5 | yes, date unrecorded | by 5 Sep 2026 |
| WooCommerce test store | B8 exit, and A7 if it runs before Etsy's | nothing to file | exists, 9 Sep 2026: `houseofproctor.com`, permalinks on. Fanwise needs a public HTTPS origin to meet it |
| Behance profile with Stripe connected | B9, and its §13 questions before B9 opens | nothing to file | not yet. A profile and a Stripe account; decision 26 |
| Gumroad OAuth application and seller account | B10 build and exit | nothing to file: self-serve in account settings | not yet. Decision 27, which also carries an email to Gumroad |

The WooCommerce row is not an application. It is in this table because it is the one thing
B8's exit waits on, and because it is the cheapest unblock the roadmap has: no developer
account, no review, no partner program. Decision 25 in `docs/decisions/0002` says what to
check once it exists. The Behance row is the same kind of thing for B9: a free profile and a
Stripe account, and twelve questions in `docs/channels/behance.md` §13 that only a logged-in
seller can answer. Decision 26 lists them. Gumroad's row is the third of the kind: an
application registered in account settings, with no review step in Gumroad's code, and a
seller account with a payout method for B10's exit.

Etsy commercial access has no published SLA and applicants report waiting weeks. It is the
single most likely thing to delay the roadmap, and it costs nothing to file today.

**Both are done, as of 8 September 2026.** Etsy's approval arrived that day and, like
Shopify's, its submission date went unrecorded; the row says so rather than inventing one.
A0 was marked done on the strength of its four checks passing, but filing these was part of
A0's scope and was never done.

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

One real product, syndicated to three channels, by a person who is not you.

| Step | Content | Exit test | Status |
|---|---|---|---|
| A0 | Repo, CI, Supabase, env validation, job abstraction. File the app registrations | `main` deploys, migrations apply clean, all four checks green | code done, **app registrations outstanding** |
| A1 | Auth, workspaces, membership, RLS | Workspace A cannot read any Workspace B row, proven by test, for every table | done |
| A2 | Canonical product, product types, assets, storage, checksums, image derivative service | A complete product exists with correct derivatives for two image specs, no channel connected | done |
| A3 | Channel registry, connections, listings, adapter contract, capability matrix, requirements engine, two mock adapters, one `api`-shaped and one `assisted`-shaped | One product yields two independent mock listings, the assisted mock implements no `publish`, and the UI offers none. No marketplace string in the product domain | done |
| A4 | Manual listing editor, no AI. Readiness UI | A user hand-writes a listing per channel and sees deterministic readiness | done |
| A5 | Shopify: OAuth, adapter, publish, idempotency, error normalization, digital delivery decision | Real product publishes, second click creates nothing, the file is actually deliverable to a buyer | **done**, 7 September 2026. Ran in full against the live store, twice — the second time on a product deleted underneath it. `docs/channels/shopify.md` §16 |
| A6 | Etsy: OAuth, adapter, draft, images, digital file, activate, idempotency | Real product publishes and is purchasable | **done**, 11 September 2026. Listing `4573259073` in shop `Fanwise` went draft, images, file, active in one job; four of the five §13 questions settled, the fifth waits on the first token refresh. See "The A6 exit run" |
| A7 | Publish Everywhere orchestration, jobs, progress, retry, activity log | One action, two live URLs, one failure recovered without duplicates | |
| A8 | Creative Market syndication: category and license schema, package build, image derivatives, guided submission handoff, mark submitted, URL capture. See `docs/channels/creative-market.md` | A creator carries one real product through the handoff to a live Creative Market listing without composing anything outside Fanwise, the URL is captured, and every row reads `status_source = self_reported`. No surface anywhere offers Publish for this channel | |

**Gate A passes when** an outside creator, unassisted, takes one of their real products from
empty workspace to three listings, and leaves them up: Shopify and Etsy live and verified by
Fanwise, Creative Market self-reported and verified by opening the captured URL by hand.

That last clause is a difference in kind, not a weaker version of the same check. Fanwise
cannot know a Creative Market listing is live, because Creative Market exposes nothing to
ask. The gate is a human test, so a human opens the URL. What Fanwise must never do is write
a row that a later part of the system would read as verified.

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

**A fourth product went missing between runs, on 6 September 2026**, and the way it went
missing was worth fixing rather than noting. `Facette`
(`gid://shopify/Product/9407450906860`) was deleted in the Shopify admin. Fanwise went on
holding the id and the admin URL, which returned Not Found, and had no route back: the
publish key was claimed, so Publish reported "already published" forever. That is now
`docs/channels/shopify.md` §15 — the adapter reads the product before every write and
raises `external_object_missing` when Shopify says there is none, the runner withdraws the
listing's claim to be published, and a generation on the listing makes the next Publish a
new operation rather than a blocked repeat.

The same change filled the two product fields Fanwise was leaving empty in Shopify: the
Category field, which is the Standard Product Taxonomy and not the free-text product type
the adapter had been confusing it with, and the meta title. See §14.

What remains for A5, in order:

1. **Decide how a product reaches a sales channel.** **Decided 7 September 2026: option A,
   Fanwise publishes it.** See `docs/decisions/0004-shopify-sales-channel-publication.md` and
   `docs/channels/shopify.md` §16. `activate` now sets ACTIVE and then calls
   `publishablePublish`, asserting the resulting publication count rather than trusting an
   empty `userErrors`. The two publication scopes force a re-authorization of every existing
   connection, which the channels card now offers as a **Reconnect** that keeps the listings.
   **Run against the live store the same day**, after the store was reconnected with the new
   scopes: `docs/channels/shopify.md` §16. The original framing follows. Either Fanwise publishes it, which means
   adding a publications scope and re-authorising every connection, or it does not, which
   means the creator does it in the Shopify admin and it becomes a manual step with the same
   standing as attaching the file. Until this is decided, "live" cannot honestly be shown.
2. **Correct what `liveness` claims** in whichever direction step 1 settles. A product that
   is on no sales channel must not be reported as available to buy. **Done, 7 September
   2026.** `PublishResult.purchasable` carries the fact, `channel_listings.metadata` stores
   it, and `liveness` returns `published_not_live` when it is explicitly false. Absent stays
   unknown and keeps the old answer, so no other channel is newly reported as unbuyable.
3. **Then place a test order and download the file as a buyer**, which is the clause that has
   never been attempted and cannot be attempted before step 1.

The image half of the old "worth doing in the same sitting" note is done: republishing
confirmed the supporting images arrive.

**Creative Market joins Gate A at A8. This reverses an earlier decision, on 7 September
2026.** The reversed text is kept below rather than deleted, because the argument against is
still the strongest thing anyone will say about A8 and whoever builds it should read it.

The earlier position was: *no third channel joins Gate A. The thing Creative Market would
prove early is the capability matrix, not the revenue, and A3's assisted mock adapter proves
that for free — an adapter with no `publish` method, a UI that consequently offers no publish
button, and `status_source` that can only ever be `self_reported`. Building a real assisted
channel to learn the same lesson adds a marketplace to the gate that closes the loop, which
is the one thing the gate is shaped to avoid.*

What changed is the reading of the risk, not the reading of the mock. Both billable channels
in Gate A were things Fanwise could not obtain by working: Etsy commercial access has no
published SLA, and A5's remaining exit clause turned out to be blocked on a sales-channel
decision rather than on code. Creative Market is the one channel in the plan that no
approval gates at all — no API key, no OAuth app, no commercial review — and it is billable
at $6 under the pricing model. Putting it in Gate A means the gate can close on one
dependency Fanwise controls end to end, and the argument the earlier text dismissed, that
the pricing model is not real until a billable channel exists, is the one that now carries.

Two costs, stated plainly rather than argued away:

- **A8 sits before the AI steps, so it cannot run Creative Market's own test.** Section 2 of
  `docs/channels/creative-market.md` frames the hypothesis as whether a creator accepts a
  *Fanwise-composed* listing substantially unchanged — "if they rewrite everything, Fanwise
  is a file converter." At A8 the copy is hand-written in the A4 editor, so the creator is
  accepting their own words and the test proves nothing about composition. A8's exit test is
  therefore about the mechanics only: the package, the handoff, the capture, the honesty of
  `status_source`. The three-creator composed-listing test stays in Gate B, after B1 and B2,
  and section 12 of the channel spec is where it lives.
- **Gate A gets wider, which is what the earlier text was protecting against.** That
  objection was right and is not answered, only accepted.

A8 is blocked on a live Creative Market seller login, which is free and which nobody has
done. Section 13 of the channel spec lists ten questions marked **[verify]** that can only be
settled from inside a real shop. Get the account before A8 opens, not during it.

**A7 still says two live URLs, and that is not an oversight.** Publish Everywhere orchestrates
the channels that can be published to, and Creative Market is not one of them — it declares
`automaticPublish: false` and implements no `publish` method, so the orchestrator has nothing
to call. A8 arrives after A7 and does not widen A7's exit test. What A8 does put in front of
Publish Everywhere is a connected channel the action must visibly skip rather than silently
omit, which is the capability-matrix case A3's assisted mock was built to rehearse.

**Behance, planned as B9 on 11 September 2026, is a second connected channel Publish
Everywhere must visibly skip**, for the same reason as Creative Market: it declares no
`publish`. Two assisted channels on one product is the case where a skip list with a reason
per row stops being a courtesy and becomes the feature; ADR 0005's vocabulary already
covers it.

**Gumroad, planned as B10 on 11 September 2026, would be a fourth channel Publish Everywhere
can call**, and the first whose rate limit is not per connection. Gumroad throttles product
creation by IP address, so every Fanwise workspace draws on one allowance of about ten
creates a minute. A7 does not have to solve that; if its queueing cannot hold one channel's
creates to a platform-wide pace, B10 adds it. `docs/channels/gumroad.md` §10.

**WooCommerce is the third channel Publish Everywhere can call**, since B8 landed on `main`
on 8 September 2026, and it changes A7's blocker rather than its exit. The exit still reads
two live URLs. What has changed is that the second live channel no longer has to be Etsy: a
WooCommerce store needs no approval, so A7 could have been proven on Shopify and WooCommerce
while A6's exit waited on its shop. Etsy landed on 11 September 2026, so A7 now has its two
live channels without B8's exit, and WooCommerce joins as a third when that runs. One thing A7 must
decide with WooCommerce connected: `activate` refusing a product with no file attached is the
creator's step still owed, not a provider failure, and the progress surface has to say which.

## The A6 exit run, 11 September 2026

Verified against the live shop `Fanwise`, shop id `67895664`, from a local dev server on port
3001 with a local Trigger.dev worker, both against the hosted development Supabase project:

- OAuth with PKCE completed on the first attempt. The connection holds the four scopes, the
  shop's currency and URL, and a ninety-day `expires_at`.
- `Kerf Display` published as listing `4573259073`, at
  `https://www.etsy.com/listing/4573259073/kerf-display`, in one job of 9.3 seconds: the draft
  created, five images uploaded cover first, one file uploaded, and `PATCH state: active`
  answered `active`. The job row holds all three provider responses and every uploaded id.
  The listing row reads `published`, `status_source = verified`, `purchasable: true`.
- Etsy charged its listing fee on activation, as §5 of the spec says it does.
- Four of the five §13 questions are settled and written into the spec. The fifth, whether
  the refresh token rotates, needs a refresh to have run, and none had.

**No test purchase was placed.** The file reaching a buyer is the same clause A5 still owes
and is unattempted here too.

One thing the run uncovered. The build and save actions evaluated readiness against a
subject with no connection metadata, so every build and update snapshot's
`currency_matches_shop` warning read "Connect the shop" with the shop connected. The publish
action never had the gap, which is why the publish went through, and the build snapshot for
this listing records the warning as unsatisfied. Fixed with this record.

## The public creator pages, 12 September 2026

Shipped outside the step order as PR #72, merged at `039716d`, deployed, and the hosted
migration `20260912010000_public_creator_pages` applied the same day. Not part of any gate.

A creator claims a handle and gets `/@handle`, with `/@handle/<product-slug>` beneath it:
one public address gathering everything they sell, and a route out to whichever channel a
visitor prefers. Fanwise takes no payment there and holds no cart. Five tables, RLS from
birth, and `anon`'s first read access in the product — narrowed by column-level grants, so
`select *` on `products`, `product_assets` or `channel_listings` is a permission error
rather than a wide read.

Nothing is public until somebody publishes it, and a published product under an unpublished
profile is not public. That rule lives in the database, not in a component.

Three things are worth carrying forward, because each was invisible until something tripped
over it:

- **A `NextResponse.rewrite()` in the proxy pins the response status at 200.** The rewritten
  page's `notFound()` never reaches the browser, so a *draft* profile answered `200 OK` with
  the not-found body. `/@handle` is therefore a `beforeFiles` rewrite in `next.config.ts`,
  which resolves through the router and keeps the page's own 404.
- **A route-level `loading.tsx` breaks the same 404 from the other side**, because its
  Suspense boundary commits the response before the page has decided anything. Loading
  states on public pages are nested inside the page.
- **supabase-js reads are cached by Next underneath a route's own revalidation.** The
  sitemap served a pre-publish answer across two full rebuilds, with no error anywhere;
  Vercel persists that cache across deployments, so redeploying would not have cleared it.
  `createPublicClient()` sets `cache: "no-store"`, and any new public read path must too.

**It was merged before the hosted migration ran, deliberately.** With the five tables absent
the feature is invisible rather than broken: the settings and product-editor sections render
their empty states, `/@anything` answers 404 rather than 500, and the sitemap falls back to
the marketing routes. That was verified by dropping the tables locally and driving the app,
then confirmed on production between the deploy and the migration.

**Open question for Gate A.** The gate's exit is "an outside creator, unassisted, takes one
of their real products from signup to a live listing." A public profile is arguably now part
of what that creator sees, and it is not in the gate's definition. Decide before the gate
run, not during it.

**Not built, deliberately:** collection pages (`/@handle/collections/<slug>` is reserved in
the slug namespace and routes into the public tree, but no page answers it) and any UI over
the outbound-click log, which records rows and shows them nowhere. Both would be building
ahead.

## Reordering, 7 September 2026

"Nothing after a gate begins until the gate passes" is the rule at the top of this file, and
this is the first exception, so the reasoning is written down where the rule is.

Gate A's remaining steps are all blocked on external parties or on time: Etsy's approvals
(A6), a Creative Market seller login (A8), and a real portfolio for the outside creator the
gate's exit test needs. A7 is orchestration over channels that can be published to, and with
one such channel live it would be orchestrating a list of one. None of that is code, and
waiting on it with nothing to build is the expensive choice.

B1 depends on A2 (canonical product), A3/A4 (listings and the editor) and A5 (a real channel
with a real profile to generate against) — all done — and on nothing in A6–A8. Adopting
Trigger.dev at B1 also means A7, when it resumes, is built on the real job system rather than
on the in-process queue it would otherwise have had to migrate off.

What is accepted, not argued away: Gate A's exit test has not run and is not made easier by
this. B2's listing review and B2a's composed-listing test both need creators, which is the
same portfolio problem A's exit has. Reordering buys time for B1; it does not buy a Gate.

## Gate B: the abstraction holds and the money comes back

| Step | Content |
|---|---|
| B1 | AI provider abstraction, Anthropic, FactSheet, merchandising profiles, factuality validator, generation logs. Adopt Trigger.dev here. **Code complete 7 September 2026**, see below |
| B2 | Listing review UI: field edit, field regenerate, full regenerate, restore, approve. **Code complete 8 September 2026**, see below |
| B2a | Creative Market composed-listing test: the three creators and the measures in `docs/channels/creative-market.md` section 12, run against AI-composed copy on the A8 handoff |
| B4 | Second assisted channel. Adobe Stock or MyFonts, undecided on purpose, see `docs/channel-feasibility.md` and decision 14 |
| B5 | `sales_events`, transaction ingestion for Shopify, Etsy and WooCommerce, dedupe constraints |
| B6 | Analytics overview: revenue, units, by channel, by product |
| B7 | CSV import foundation |
| B8 | WooCommerce: store authorization, adapter, draft, images, activate with the file verified, idempotency. See `docs/channels/woocommerce.md`. Added 8 September 2026 at the founder's request; **code complete the same day**, exit unrun, see below |
| B9 | Behance: creative-field and category mapping, the project-and-asset package, two new image derivative specs, guided handoff in new-project and existing-project modes, mark submitted, project URL capture. See `docs/channels/behance.md`. **Planned 11 September 2026 at the founder's request, not opened**; waits on A8, see below |
| B10 | Gumroad: OAuth with PKCE, adapter, presigned multipart file upload, draft then enable, covers and thumbnail, the compensating delete, a platform-wide create pace, idempotency. See `docs/channels/gumroad.md`. **Planned 11 September 2026 at the founder's request, not opened**; waits on nothing in code, see below |
| B11 | The companion window: the assisted handoff shown beside the marketplace's own editor, in a pop-out that touches nothing on the marketplace's page. See `docs/companion-window.md` and `docs/decisions/0010`. **Planned 12 September 2026 at the founder's request, not opened**; conditional on evidence from A8 and B2a, see below |

### B1, what was built and what is still owed

Built on 7 September 2026, on the branch `b1-ai-merchandising`:

- `lib/ai`: the provider abstraction, the FactSheet, the prompt, the output schema, the
  factuality validator, the generation runner, and the review guard. The vendor lives in
  `lib/ai/providers/anthropic` and a unit test reads the tree to keep its name there, the
  same way the channel keys are kept inside the adapter layer.
- `ai_generations`, migration `20260907180000_ai_generations`, with `factsheet_hash` on every
  row and a partial unique index that allows one generation in flight per listing.
- A merchandising profile on every adapter, as data, with its own prompt version.
- Trigger.dev behind `lib/jobs`, selected by `TRIGGER_SECRET_KEY` and otherwise absent.
  `trigger/jobs.ts` declares one task per job name; a test checks the two lists agree.
- **Compose with AI** on the listing page. Composed copy lands on the listing and Publish
  refuses it until a person has saved the editor since. That is B1's stand-in for approval;
  B2's review screen replaces it.

**B1's exit is two claims, and both ran live on 7 September 2026, on the same day the
code landed:**

1. One real product composes for the connected Shopify store against the configured model,
   the validator passes it, and the cost recorded on the row is within a factor of two of
   decision 12's estimate. **Ran.** Three generations on the hosted dev project: 568 to 900
   uncached input tokens, an 1,800-token cached prefix written each time, and $0.008 to
   $0.014 per generation against the $0.010 to $0.014 estimate. The first composed product,
   `Kerf Display`, was saved, published and taken live on the dev store the same afternoon.
   Every row so far reads zero cache *reads*, because none was within five minutes of the
   one before; two generations inside the window is the measurement still to take.
2. One job runs through Trigger.dev rather than the in-process queue. **Ran.** A
   `generate_listing` run on the Dev environment of a real project, picked up by a local
   worker, succeeded in nine seconds and settled the row exactly as the in-process queue
   had. A `finalize_asset` run followed on an upload, and a `build_derivative` run
   triggered by hand rendered an 800 by 600 JPEG through `sharp` on the worker in under
   two seconds, so the build external holds. What is still an assumption is a deployed
   worker at all, since the Dev environment runs on the developer's machine; that is
   `pnpm jobs:deploy` against a Prod key, and it has not been run.

What B1 deliberately does not do: meter generations (decision 13's free cap belongs to the
entitlement service at C2), regenerate a single field, or restore an earlier generation.
Those are B2, and the `ai_generations.structured_output` column is what B2 restores from.

### B2, what was built and what is still owed

Built on the listing page, which was already the place a listing is read: Regenerate beside
every field, and Earlier drafts with Restore under the compose panel. A field generation is
the same row, prefix and validator as a whole one, narrowed to one key; a restore is the
signed-in user putting an accepted row's copy back, with its own snapshot type. Approval is
the Publish click: when composed copy is waiting the button reads "Review and publish" and
the click stamps `approved_at` before the send. A separate Approve button was built and
dropped the same day as ceremony.

**B2's exit test** is the review loop on a real product: compose, regenerate one field, edit
another by hand, restore the earlier draft, and publish, with the card saying composed copy
is waiting until the publish that approves it. The whole loop is proven against a scripted provider in
`tests/db/ai-review.test.ts`; it has not been run in the browser against the model. Journey 2
in `docs/testing.md` is that run.

### B8, what was built and what is still owed

Added on 8 September 2026 at the founder's request and built the same day on the branch
`woocommerce-channel`, in a worktree because another session held the working tree. It is an
exception to "nothing after a gate begins until the gate passes" on the same reasoning as
B1's reorder: the channel depends on A3's contract and A5's publishing machinery, both done,
and on nothing after. The assessment that preceded it is in `docs/channel-feasibility.md`;
the spec is `docs/channels/woocommerce.md`.

What WooCommerce is to the plan, in one sentence: the second owned storefront, the third
channel Fanwise can publish to, and the first whose product read carries the file, so the
manual step can be checked rather than believed.

Built:

- `lib/channels/adapters/woocommerce`: capabilities, the authorization flow, the product
  write, the description transform, the error map and the merchandising profile. No provider
  name leaves the folder.
- **The grant route**, `app/api/channels/[channelKey]/oauth/grant`, generic in the channel
  key. The store posts the consumer key and secret server to server rather than returning a
  code, so this route completes the connection and the callback only reports. WooCommerce is
  the first adapter to declare `oauth.grant`; `docs/channel-adapters.md` has the contract and
  `docs/security.md` the order of checks.
- Migration `20260908090000_woocommerce_channel`: one catalog row, `billable = false`, taking
  decision 23's recommended reading with a comment saying the decision is open. Applied to
  the hosted dev project. No new table.
- The draft gate. `publish` creates `status: draft`; `activate` reads the product back and
  refuses, naming the admin screen, until `downloads` holds a file. Only then does it set
  `status: publish`, and `purchasable` is true only when the read-back says so.
- `tests/unit/woocommerce-oauth.test.ts` and `tests/unit/woocommerce-adapter.test.ts`.

What it deliberately does not do: upload the file (`digitalFileUpload: false` by decision,
§6 of the spec, because the one API path that can puts the deliverable at a public address),
read orders (`transactions: false` until B5), or bill (nothing bills before C1, and the row
reads included either way).

**B8's exit test has not run.** It needs a WooCommerce store on HTTPS with pretty
permalinks, which is any WordPress host and no approval, and a Fanwise at a public HTTPS
address, because the store posts the keys server to server and a local dev server cannot
receive them (spec §9, learned 9 September 2026). The store exists as of that day; the run
is on the hosted deployment: connect from the store's own authorization screen, publish a
draft, attach the file in the admin, mark the step done, and confirm that `activate` sees
the download and the product is buyable. The five questions in
§13 of the spec, including the order of the store's POST and its redirect, can only be
settled there. Journey 11 in `docs/testing.md` is that run.

What B8 changes elsewhere in this file:

- **A7** gains a third channel to orchestrate and a second way to unblock. Its exit is two
  live URLs from one action, and a live WooCommerce store is easier to obtain than a live
  Etsy shop. Either pair satisfies it.
- **B5** ingests three channels, not two. `GET /orders` on the store carries what
  `sales_events` needs; the adapter declares `transactions: false` until B5 builds it.
- **C1** and **C2** inherit decision 23, whether the second owned storefront is included. The
  row is seeded included, and `docs/billing.md` rule 4 now says so and names the decision.
- **Gate A does not widen.** WooCommerce is not in the gate's exit test and does not need to
  be: the gate proves the loop closes, and it closes on Shopify, Etsy and Creative Market.

### B9, what is planned and what it waits on

Planned on 11 September 2026 at the founder's request and not built. The assessment is in
`docs/channel-feasibility.md` under Tier 3; the spec is `docs/channels/behance.md`.

What Behance is to the plan, in one sentence: the second assisted channel, the first whose
unit is a portfolio project rather than a product, the cheapest marketplace after Creative
Market to reach, and one where Fanwise will never hold a credential or call an API.

Scope, when it opens:

- `lib/channels/adapters/behance`: capabilities (every one false but `drafts`, all for the
  permanent reason), requirements, the two mapping tables (product type to Creative Fields,
  product type to asset category), the plain-text description transform, and a
  merchandising profile written for a portfolio audience rather than a shop's.
- Two derivative specs in the image service: a 1.278:1 cover and a 2800-wide project image.
  Nothing else in the catalog shares either.
- The handoff screen in two modes, new project and existing project, ordered to Behance's
  editor; the fee arithmetic shown beside the price; mark submitted; project URL capture.
- A catalog migration: one `channels` row, `integration_type = assisted`, `billable = true`,
  since it is a marketplace and decision 16 governs what that costs.
- Unit tests for the requirements, the mappings and the capability honesty; journey 12.

**B9 waits on A8**, and the dependency is real rather than ceremonial. A8 builds the
package build, the handoff screen, mark submitted and URL capture, and Behance reuses every
piece. Opening B9 first would mean building the assisted machinery on a channel that is not
in Gate A's exit and then fitting Creative Market to it, which is backwards. B9 also waits
on decision 26, a profile with Stripe connected, because twelve questions in the spec's §13
can only be answered from inside one, and two of them (the five category names, the
Creative Fields list) decide the mapping tables.

**B9's exit test** is journey 12: a creator carries one real product through the handoff to
a live project with the asset For Sale, composes nothing outside Fanwise, the project URL is
captured, and every row reads `self_reported`. No surface offers Publish.

What B9 changes elsewhere in this file:

- **A7** gains a second channel to skip visibly, not a third to call. See the paragraph
  under Gate A.
- **B4** is unchanged. Behance is not a candidate for it; decision 14 says why.
- **B5 and B6** gain a hole that is named rather than shown as zero: Behance's sales exist
  only in the seller's own Stripe account. Decision 15.
- **C1 and C2** inherit decision 16 with a sharper edge: the marketplace itself takes 30% of
  every sale unless the seller pays Adobe monthly, and a $6 charge for preparation will be
  read next to that.
- **Gate A does not widen.** Behance is in Gate B and is not in the gate's exit test.

### B10, what is planned and what it waits on

Planned on 11 September 2026 at the founder's request and not built. The assessment is in
`docs/channel-feasibility.md` under Tier 1; the spec is `docs/channels/gumroad.md`.

What Gumroad is to the plan, in one sentence: the second billable automatic channel, the
relief for the Etsy concentration that decision 2 was written about, and the first provider
whose rate limit every Fanwise workspace shares.

Scope, when it opens:

- `lib/channels/adapters/gumroad`: capabilities, OAuth with PKCE, the presigned multipart
  upload, the product write in its draft-then-enable sequence with the compensating delete,
  an error map that reads the body rather than the status, the category table, and a
  merchandising profile.
- One derivative spec, a 1200 × 1200 square thumbnail. Covers reuse Etsy's.
- A platform-wide pace for Gumroad creates, one at a time and at most six a minute, unless
  A7 already provides a way to express it.
- Disconnect revokes the token, because Gumroad's do not expire.
- A catalog migration: one `channels` row, `integration_type = api`, `billable = true`.
- `tests/unit/gumroad-oauth.test.ts` and `tests/unit/gumroad-adapter.test.ts`; journey 13.

**B10 waits on nothing in code.** It depends on A3's contract, A5's publishing machinery, and
A6's OAuth with PKCE and file upload, all done. It is not opened because A7 is the current
step and is itself unblocked, and `CLAUDE.md` says one step at a time. If the founder wants
it sooner, B8 is the precedent for opening a channel ahead of its gate. What it does wait on
is decision 27: an OAuth application to build against, and a seller account with a payout
method for the exit.

**B10's exit test** is journey 13: connect through OAuth, publish a real product with its
covers and its file, confirm it is purchasable, and settle the spec's §13 questions, the
first of which decides whether the adapter also sends a rich-content embed. A second click
creates nothing, and a failure after the draft leaves nothing behind.

What B10 changes elsewhere in this file:

- **A7** gains a fourth channel it could call, and a constraint no earlier channel had. See
  the paragraph under Gate A.
- **B5** gains a fourth ingestion source, `GET /v2/sales`, which needs the `view_sales` scope
  and a reconnect of every Gumroad connection, the trade Etsy's spec also makes.
- **C1 and C2** gain a second billable automatic channel. Decision 23 records why it bills.
- **Decision 2 is resolved.** The email it recommended survives as decision 27, asking
  something else.
- **Gate A does not widen.** Gumroad is in Gate B.

**B3 is vacant on purpose.** Creative Market moved to A8 and the remaining steps keep their
numbers, because step ids are names here, not positions — `docs/data-model.md`,
`docs/channels/shopify.md`, `docs/decisions/0001` and `CLAUDE.md` all refer to B1, B4, B5 and
B6 by id, and renumbering to close a gap would silently invalidate every one of those
references. Do not reuse B3 for something else.

B2a is the half of the old B3 that could not move: the creator test that only means anything
once AI composes the listing. It is lettered rather than numbered for the same reason the gap
stays, and it is a test rather than a build step, which is why it carries no code scope.

### B11, what is planned and what it opens on

Planned on 12 September 2026 at the founder's request, after they chose a sidebar over an
extension that fills in marketplace forms. The decision is `docs/decisions/0010`, still
proposed; the build plan is `docs/companion-window.md`.

What it is, in one sentence: the assisted handoff shown in a small always-on-top window
beside the marketplace's editor, so the creator stops losing their place between two
windows.

Scope, when it opens:

- A **Pop out** button on the handoff, rendered only where `documentPictureInPicture` exists.
- The same handoff component, portalled into the pop-out's document, with the stylesheets
  and the theme attribute copied across at open.
- Clipboard and download behaviour proven from the second window, including the formatted
  description Creative Market's editor needs.
- Component tests, one E2E spec, and a line in `docs/testing.md` saying this is journey 7 in
  the companion rather than a new numbered journey.

**No migration, no new table, no new server action, no new capability.** B11 is a layout. If
it needs a schema change, something has been misread.

**B11 is the first step in this file that opens on a finding rather than on a dependency.**
It needs A8's handoff to exist, A8's exit run and the B2a creator test to have watched
creators use it with the step order already right, and those creators to still lose their
place between windows. `docs/channels/creative-market.md` §12 prescribes fixing the order
first, and the order is the cheaper fix. If the finding never arrives, close
`docs/companion-window.md` rather than leaving it open for somebody to build because it is
there.

The one thing it asks of a step that has not run yet: **A8 builds the handoff as one
component that does not assume the width of a full page.** That costs a layout rule, not
scope, and it is already written into `docs/channels/creative-market.md` §10. Build it as a
page instead and B11 starts by refactoring a screen creators have already been tested
against.

**B11's exit test** is one creator carrying one real product through an assisted channel with
the companion open, without returning to the Fanwise tab until they paste the URL, measured
against the time and the lost-place finding from A8's own run. If neither improves, revert
it: two ways to read the same handoff is worse than one.

What B11 does not do, and a later session should not read into it: it never reads, writes or
scripts a marketplace's page, and it holds no marketplace session. An extension side panel,
form B in 0010, is not part of it and opens only if the pop-out is built and found wanting,
with its own ADR and its own section in `docs/security.md` for the second authenticated
client it would create.

## Gate C: a stranger can pay

| Step | Content |
|---|---|
| C1 | Stripe: base subscription, per-channel quantity, connect and disconnect billing events, proration, trial, portal. **Code complete 8 September 2026**, see below |
| C2 | Entitlement service gating on channel count and type |
| C3 | Onboarding, empty states, activation instrumentation |
| C4 | Hardening: auth, RLS, tokens, secrets, storage, rate limits, webhooks, accessibility, responsive, full E2E |

### Reordering, 8 September 2026, the second

C1 opened while Gate A's exit and B8's exit both wait on live shops, at the founder's request
and knowing it is ahead of the rule at the top of this file. The reasoning is the same as the
first reordering's: billing depends on `channel_connections` and `channels.billable`, both
done since A3, and on nothing after; the things ahead of it are blocked on other people. What
is accepted, not argued away: a billable channel that has never billed anyone is still the
honest description of the product until C1's exit runs.

### C1, what was built and what is still owed

Built on the branch `c1-stripe-billing`:

- `lib/billing`: the gateway contract, the rules, the state, the sync job, the webhook
  processor, the queries and the two actions. The vendor lives in `lib/billing/providers/stripe`
  and a unit test keeps its name there.
- Migration `20260908200000_billing`: `workspace_billing`, `billing_events`,
  `billing_webhook_events`, and the trigger that makes a connection row and its billing event
  one transaction. See `docs/data-model.md`, C1.
- The `sync_billing` job, enqueued after every connection write and every subscription
  webhook. Absolute quantities, one persisted key per attempt.
- The settings page: trial, two checkouts, the subscription as the provider holds it, the
  portal, and the ledger. The disconnect confirmation says it is a billing event when it is.

Two assumptions C1 made rather than waited on, both reversible without a migration:

1. **The trial is fourteen days, on Fanwise's side.** Decision 18 (trial or free plan) stays
   open; either answer changes `TRIAL_DAYS` and the entitlement service at C2.
2. **One channel price.** Decision 16 (assisted versus automatic) stays open; a second price
   is a second subscription item and a second config column.

**C1's exit test has not run.** It needs a provider account in test mode: a checkout that
creates the subscription with the connected channels on it, a connect that lands as a
prorated line, a disconnect that produces no credit, a reconnect inside the period that
charges nothing, a period roll that resets the peak, and a portal cancellation that reaches
the row. Journey 10 in `docs/testing.md`.

## The marketing site

Not part of any gate. `design/marketing/` holds the published mockups; when the public site
ships it should be its own deployment, not a route in this app. Do not mix marketing pages
into `app/` while the gates are in progress.

**That last sentence no longer describes the repository, and the gap is worth naming rather
than quietly leaving.** `app/(marketing)/` already serves seven routes — about, how-it-works,
marketplaces, pricing, privacy, start, terms — and since 12 September 2026 `app/profile/`
serves the public creator pages as well.

The creator pages are a different thing from marketing pages and could not be a separate
deployment: they render tenant data, through RLS, from the same database and the same
product model, and splitting them out would mean a second service holding the anon key and
duplicating the adapter registry. The marketing routes have no such excuse.

So the rule stands for marketing and has already been broken for it. Either move those seven
routes out or retire the sentence; leaving it as advice nobody follows is the worst of the
three.

## Deliberately out of scope for V1

Product versions table, viewer and editor roles, Framer, metric snapshots, multi-currency,
browser automation, physical commerce, and everything in the strategy document marked V2 or
V3.

Browser automation means anything that works on a marketplace's page: filling fields,
attaching files, clicking, or reading the page back, whether a script or a browser
extension does it. A companion window that shows Fanwise's own handoff beside the
marketplace and touches nothing on its page is not browser automation. It is ADR 0010,
proposed on 11 September 2026, and it waits on the evidence from A8's exit run and the B2a
creator test.
