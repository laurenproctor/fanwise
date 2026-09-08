# ADR 0005: What a half-published product is called, and who retries what

**Status:** proposed, 8 September 2026. Drafted unattended so that A7 does not open with
these two questions unanswered; every recommendation below is the founder's to accept,
amend or overrule.
**Date:** September 2026
**Blocks:** A7, Publish Everywhere. Its exit test is "one action, two live URLs, one failure
recovered without duplicates", and both halves of that sentence need these words.
**Supersedes:** open-decisions register entries 7 and 8, which stay as index pointers

---

## Context

Two entries have sat in the register under "Before A7" since 4 September 2026:

- **7. Partial-failure vocabulary.** Two channels, one succeeds, one fails. Is the product
  "published", "partially published", or neither?
- **8. Retry policy.** Which normalized codes are retryable, how many attempts, what
  backoff. The register asked for one table owned by `lib/publishing`, on the argument that
  an adapter deciding its own policy will eventually retry something non-idempotent.

Both were written before A5 ran against a live store. Since then the codebase has answered
parts of each without anyone recording it, and in one case has done the thing entry 8 was
written to prevent. This document starts from what exists, because the decision that
survives A7 is the one that names the current behaviour and changes only what needs
changing.

### What exists for entry 7

The **per-listing** vocabulary is done and has been tested against a live channel. A
listing on a channel is in exactly one of five states, computed by `liveness()` in
`lib/publishing/manual-steps.ts` and rendered by one pill:

| State | Means |
|---|---|
| `unpublished` | Written here, not sent anywhere |
| `publishing` | Sent, waiting for the channel to confirm |
| `published_not_live` | The channel has it, nobody can buy it yet |
| `live` | On the channel and available to buy |
| `failed` | The last attempt did not finish |

These words earned their shape the hard way. ADR 0001 built `published_not_live` for a
deliverable nobody had attached; A5's exit test found a second way to be unbuyable, a product
Shopify called active that was on no sales channel, and the word did not need to change.
"Fully published" is a **derived condition** — published, and no required manual step
outstanding, and not explicitly unpurchasable — and never a stored status. That principle is
the one thing this ADR must not undo.

What does not exist is any word for the **product**. Today a product page shows one pill per
listing and nothing above them. Publish Everywhere is the first surface that acts on several
listings at once and then has to say how it went, and the register's fear is that the
sentence it reaches for will be "partially published".

The mockup already refused that word. The workspace window in `design/marketing/landing.html`
shows per-channel statuses (Live, In review, Needs a fix, Foundry review) and a footer that
reads **"6 drafts built in 41s · 3 live · 2 pending · 1 needs attention"**. A count, not an
adjective. CLAUDE.md names that mockup the closest thing to a spec for the publish screen.

### What exists for entry 8

More than the register knew, and in the wrong place.

**Retry already happens, inside every adapter, three times over.** Each of the three HTTP
clients — `lib/channels/adapters/{shopify,etsy,woocommerce}/client.ts` — carries its own
`MAX_ATTEMPTS = 3`, its own `backoffMs()` of 250 ms doubling to a 5 s cap, and its own loop
that retries a transport failure or any `ChannelError` whose `retryable` flag is true.
Shopify's honours the throttle's `restoreRate`; Etsy's honours `Retry-After`. The three
agree today because each was written by copying the last, and nothing keeps them agreeing.
This is the mild form of what entry 8 warned about: not three policies, but one policy in
three places, which becomes three policies the first time one is edited.

**Nothing above the adapter retries at all.** The runner (`lib/publishing/runner.ts`) reads
`normalized.retryable` nowhere; it writes the code and message to the job row and, for a
failed `publish`, sets the listing to `failed`. Both queues deliver exactly once:
`trigger/jobs.ts` declares `retry: { maxAttempts: 1 }` on `publish_listing`, and the
in-process queue has no retry at all. The only thing that re-attempts a failed job is a
person pressing **Try again** on the listing card, which reuses the job row and its
idempotency key (`lib/publishing/start.ts`, the `retried` outcome) and increments
`attempt_count`.

So the current policy, stated plainly, is: *a retryable failure is retried three times
within seconds, inside one job attempt; if that fails, the job fails, the creator is told,
and nothing happens until they act.* That is defensible for A5, where one person publishes
one product and is watching. It is not what A7 promises. "One failure recovered without
duplicates" means Fanwise recovers it, and a creator who pressed Publish Everywhere and left
the page should not come back to a listing that gave up on a 503 at 14:02 and has waited for
them since.

**One retry that exists today can duplicate.** All three clients retry a transport failure —
a socket error, a timeout, a lost response — on every request, including the one that
creates the product. A create whose response was lost may have landed: Shopify's `productSet`
with no identifier creates a product every time it is called, Etsy's `createDraftListing` is
a plain POST, and WooCommerce's create is too. The retried request then creates a second
product, and Fanwise records the second id, having never seen the first. No adapter searches
for an orphan before creating; the Shopify adapter deliberately sends no handle (a collision
blocked a product forever on 7 September 2026), so there is nothing to search by. The window
is narrow — a timeout after the provider committed but before the response arrived — and it
has not been observed. It is named here because it is exactly the case entry 8 predicted,
and because "without duplicates" is in A7's exit test.

### What constrains the answer

- **Etsy's rate limit is per application, not per shop**: 10,000 calls per rolling day and
  10 per second across every connected shop (`docs/channels/etsy.md` §10). A retry storm on
  `rate_limited` is the one failure mode that can take every tenant down at once. Backoff on
  that code has to be long and bounded, and hammering is strictly worse than waiting.
- **Invariant 3.** Every external write is idempotent, and the key is claimed before the
  call. A retry policy that creates a second job row for the same operation is a policy that
  breaks the product. Retries reuse rows; that is already how the runner's claim works.
- **Rule 7.** Long external calls run in background jobs. A backoff measured in minutes
  cannot be a `sleep` inside a request; it has to be a delayed hand-off to the queue. The
  `JobQueue` interface already declares `delayMs`; `TriggerQueue` passes it through and the
  in-process queue ignores it, and no caller sets it yet.
- **The creator's retry is never refused.** A person pressing Try again is a new decision,
  not attempt four of an old one.

---

## Decision 7: there is no product-level publish status

**A product is never "published". A listing is.** The question "is this product
published?" is answered with "to which channel?", and the product page and Publish
Everywhere both answer it with the existing per-listing pills plus a count.

Three consequences, each of which is a rule:

1. **No enum, no column, no derived word for the product.** Not `published`, not
   `partially_published`, not `unpublished`. Invariant 1 says the product is never
   channel-shaped, and a status that summarises channels is channel-shaped by construction.
   ADR 0001 made "fully published" a derived condition on a listing rather than a stored
   value; this extends the same refusal one level up. If a query needs the answer it counts
   listings by liveness at read time.
2. **"Partially published" is banned** from code, UI and docs. It describes nothing that
   happened: no listing was partially anything. Each was sent or was not. The word invites a
   creator to believe some fraction of their product is for sale, when the truth is that it
   is for sale on Etsy and not on Shopify, which the pills already say.
3. **A Publish Everywhere run reports per channel, and its headline is a count.** The
   mockup's footer is the spec: *3 live · 2 pending · 1 needs attention*. Never an
   adjective, never a percentage, never "mostly".

### The words a run uses

Publish Everywhere is one action that starts one job per channel it can publish to. Each of
those jobs already has an outcome vocabulary (`pending`, `running`, `succeeded`, `failed`)
and each listing already has its five words. What is new is that the **run** has to say, for
every connected channel, what it did about it — including the channels it did nothing about,
which the roadmap insists are visibly skipped rather than silently omitted.

Per channel, a run reports exactly one of three:

| Word | When | The channel's pill afterwards |
|---|---|---|
| **Sent** | The job succeeded. The channel holds the product | `live` or `published_not_live` |
| **Failed** | The job failed and Fanwise has stopped trying | `failed` |
| **Skipped** | No job was started, with a reason | unchanged |

Skipped carries a reason, because "we did nothing" is only honest with the why attached:

- **assisted**: the channel declares `automaticPublish: false` and implements no `publish`.
  Creative Market at A8. The card says so and points at the handoff instead.
- **not ready**: readiness has errors. The card shows them; the run does not try.
- **already published**: the listing holds an external id and has no unsent changes.
  Nothing to send.
- **not connected**: the channel exists in the registry and this workspace has no
  connection to it. Listed so that the run's channel list is the registry's, not a shorter
  one that hides what Fanwise could do.

The run's headline is the counts of those three words. When every started job succeeded the
run is **done**; when at least one failed it is **done, with N to fix**, and the N are the
cards carrying errors. There is no third headline. A run is not retried as a unit — a failed
channel is retried on its own card, exactly as today, because the other channels' outcomes
stand and re-running them would be a no-op the idempotency key refuses anyway.

### Where a run is recorded

The data model reserves `workspace_events` for A7: append-only, never updated, never
deleted. A run is a good first tenant for it — one event when the run starts naming the
channels and their skip reasons, one per job as it settles — and a nullable `run_id` on
`publication_jobs` groups the jobs that one click created. Both are A7's to build; this ADR
only says the run is a record of what happened and never a state machine that has to be
driven to completion.

### The vocabulary table

If accepted, `CLAUDE.md` gains two rows:

| Term | Meaning |
|---|---|
| Run | One Publish Everywhere action and the per-channel outcomes it produced |
| Skipped | A connected channel a run did not attempt, always with a reason |

And one sentence under the UI rules: *A product is never described as published, partially
published or unpublished. Listings are.*

---

## Decision 8: one table, two tiers, and no retry of a create

**The policy is a table, in one place, read by everything that retries.** Adapters own the
mapping from their provider's noise into normalized codes; they do not own what happens
next. The three copies of `MAX_ATTEMPTS` and `backoffMs()` collapse into one import.

Retry has two tiers, and they answer different questions:

| Tier | Where | Question | Horizon |
|---|---|---|---|
| **In-call** | inside the adapter's HTTP client, within one job attempt | Was this request momentarily unlucky? | seconds |
| **Re-attempt** | the runner, by a delayed hand-off to the queue | Is the channel having a bad quarter-hour? | minutes |

Both are driven by the normalized code alone. A retryable code is retryable in both tiers;
a non-retryable one is retried in neither. The one exception is the object create, below.

### The table

| Code | In-call retry | Automatic re-attempt | After that |
|---|---|---|---|
| `rate_limited` | up to 3, honouring `Retry-After` / restore rate | yes, on the schedule below | creator may retry |
| `provider_unavailable` | up to 3 | yes | creator may retry |
| `network` | up to 3, **except on a create** | yes, **except after a lost create response** | creator may retry |
| `validation_rejected` | no | no | creator edits, then retries |
| `credentials_invalid` | no | no | creator reconnects; the connection is marked |
| `permission_denied` | no | no | creator reconnects with the scopes named |
| `not_found` | no | no | creator checks the store; the message says what to check |
| `external_object_missing` | no | no; the runner has already withdrawn the listing's claim and the next Publish is a new operation | creator publishes again |
| `unknown` | no | no | creator may retry; the raw response is on the job row |

**In-call**: 3 attempts, 250 ms doubling to a 5 s cap, hint-aware. This is what all three
clients already do, kept as is and moved to one place.

**Automatic re-attempt schedule**: three, delayed **1 minute, 5 minutes, 15 minutes** after
the failure that scheduled each. Then the job fails for good and the listing reads `failed`.
Three because the point is to cover a deploy, a throttle window or a brief outage, and
anything longer than twenty-one minutes is a channel with a problem the creator should hear
about rather than a retry Fanwise should keep making. Delays this long on `rate_limited`
are the response to Etsy's per-application ceiling: the worst case across every tenant is a
handful of calls per listing per quarter-hour, not a tight loop.

**Total ceiling**: in-call and re-attempt multiply, so a `provider_unavailable` that never
clears costs at most 3 × 4 = 12 requests over about 21 minutes, plus whatever the creator
adds by hand. That is the number to check against Etsy's daily budget when there are enough
shops for it to matter.

**A creator's Try again is always allowed** and is not counted against the automatic
schedule. It re-enqueues the existing row with no delay, exactly as `start.ts` does now, and
if it fails on a retryable code the automatic schedule starts again from the first delay.
Nothing refuses a person on the strength of `attempt_count`; the count is a diagnostic.

### The create exception

The one place the two tiers disagree with the table is the request that creates the external
object, because it is the one request whose retry is not idempotent.

- **In-call**: a transport failure on the create is **not retried**. It is normalized as
  `network` and the job fails. The message says the channel may or may not have received
  the product and Fanwise could not confirm it.
- **Re-attempt**: a job that failed with `network` on the create is **not re-attempted
  automatically**, for the same reason. It waits for the creator.
- **What makes it recoverable**: the adapter stamps the listing id on the object it creates,
  in whatever field the channel exposes for a merchant reference — Shopify a metafield,
  Etsy and WooCommerce the `sku` — and before any create, the adapter looks for that stamp.
  Finding it means the earlier create landed: the adapter adopts the id and proceeds as an
  update, and the runner records it the same way it records any external id it learns. That
  is the third idempotency guard from `docs/architecture.md` applied on the provider's side
  rather than ours, and it is what turns the creator's Try again from a coin toss into a
  recovery. **Verify per channel** that the stamp field is searchable — Shopify's
  `products(query: "sku:...")` or a metafield filter, Etsy's listings-by-shop with a `sku`
  match, WooCommerce's `?sku=` — before relying on it; the three specs' §13 lists are where
  the answers go.

Every other write the adapters make is already an update to an object with an id, which the
adapters already read before writing (`docs/channels/shopify.md` §15), and those retry
freely.

### How the runner carries a re-attempt

The listing's word while a re-attempt is scheduled is **`publishing`**, not `failed`. The
meaning text for `failed` says "the last attempt did not finish"; from now on it means
something stronger, **Fanwise has stopped trying**, and the meaning text should say so.
While the schedule is still running the pill stays `publishing` and its meaning gains a
second sentence: *"The channel was busy. Trying again shortly."* Adding a sixth liveness
word was considered and rejected: a creator does not need to distinguish "waiting for the
channel" from "waiting to ask the channel again", and every new word costs a pill, a meaning,
a tone and a test.

Mechanically: the runner, on a retryable failure with the schedule not exhausted, leaves the
listing `publishing`, writes the code and message to the job row as now, sets the job back to
`pending`, and enqueues with the tier's delay. The job row is the same row; the claim is the
same compare-and-swap; the idempotency key is untouched. Nothing new is inserted. When the
schedule is exhausted the runner does what it does today: `failed` on the job, `failed` on
the listing for a `publish`, listing untouched for an `update` or `activate`.

The in-process queue ignores `delayMs` and does not need to honour it: it exists for CI and
the database suite, which prove the state transitions rather than the wall clock. The
schedule is data in `lib/publishing`; only the durable queue observes the delay.

### Where the code goes

- **`lib/channels/errors.ts`** keeps the codes and gains the in-call constants:
  `IN_CALL_MAX_ATTEMPTS`, `inCallBackoffMs(attempt, hintMs)`, and `isRetryable`. This is the
  error vocabulary's own file, every adapter already imports from it, and the in-call tier is
  a property of a code rather than of a channel. The three client copies are deleted.
- **`lib/publishing/retry.ts`** owns the re-attempt schedule and the create exception, as a
  table the runner reads. The register asked for `lib/publishing` to own the policy, and
  the part that decides whether a *job* runs again is here.
- **Adapters** learn one thing: which of their requests is the create, so the client can
  refuse to retry it. A boolean on the request, not a policy.

The layering rule is unchanged: `lib/channels` does not import `lib/publishing`. The in-call
tier lives below the line because the clients need it; the re-attempt tier lives above it
because only the runner does.

---

## Why these and not the alternatives

**A product status enum** (published / partially published / unpublished) is the obvious
answer and the wrong one. It would be stale the moment a channel deleted a product, which
already happened once (7 September 2026); it would need a rule for what `published_not_live`
counts as; and it would put a channel summary on the product row, which invariant 1 forbids.
Counting at read time costs one query and is always right.

**"Partially published" as a display string only**, never stored, is less wrong and still
wrong. The pills already carry the facts; the adjective adds a feeling and removes a
channel name. A creator who reads "partially published" has to click to find out which
half, and the click lands them on the pills anyway.

**Unlimited automatic retries with capped backoff** is what most job systems default to and
what Etsy's per-application limit rules out. Twenty-one minutes and twelve requests is
enough to outlast every outage worth outlasting.

**Retrying a create after a lost response, then de-duplicating afterwards**, was considered
and rejected: it needs a delete, which is a second non-idempotent write to clean up the
first, and ADR 0001's stance is that Fanwise does not delete a creator's products by a
background decision. Not creating twice is cheaper than deleting once.

**Letting each adapter declare its own schedule** is the option the register argued against
and the one the codebase drifted into. The argument stands: only the adapter knows what a
status code means, but what to do about a normalized code is a product decision, and it
should be made once.

---

## Consequences

- A7 gets its words before its UI: per-listing pills as now, per-channel *sent / failed /
  skipped* with reasons, a count headline, and never a product-level status.
- `lib/publishing` gains a retry table and the runner gains a delayed re-attempt path; the
  three client retry loops shrink to one shared import. The behaviour on a first failure is
  unchanged; what changes is that Fanwise tries again three more times before giving up.
- Every adapter must stamp the listing id on the object it creates and look for it before
  creating. This is the piece that makes "recovered without duplicates" true and it needs
  live verification on each channel.
- The `failed` meaning text changes from "the last attempt did not finish" to a sentence
  that says Fanwise has stopped trying and why.
- `CLAUDE.md` vocabulary gains *Run* and *Skipped*, and the UI rule that products are never
  called published.

## Accept, amend or overrule

The three choices most worth a second opinion:

1. **Three automatic re-attempts over 21 minutes.** Longer schedules are safer for outages
   and worse for Etsy's daily budget. Two or five would both be defensible.
2. **No product-level word at all.** The alternative that keeps the invariants is a
   read-time count with no name; if a name is wanted for the activity log, *done* and
   *done with N to fix* are the ones proposed.
3. **The stamp-and-search create guard** is real work on three adapters and needs three
   live verifications. It could be deferred past A7's first cut, with the create exception
   alone (never retry a create) shipped first; that removes the duplicate and leaves the
   creator's Try again able to create a second product only after a lost response, which is
   the case the stamp exists to close.
