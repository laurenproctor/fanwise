# Roadmap

**Current step: A5, code complete. Its exit test is unverified: see the note below.**

Three gates. Nothing after a gate begins until the gate passes. Update the line above when a
step completes, and do not work on more than one step at a time.

## External dependencies, file these first

| Dependency | Needed by | Submitted | Approved |
|---|---|---|---|
| Etsy developer app | A6 | in progress | |
| Etsy commercial access | A6 | in progress | |
| Shopify Partner account | A5 | in progress | |

Etsy commercial access has no published SLA and applicants report waiting weeks. It is the
single most likely thing to delay the roadmap, and it costs nothing to file today.

**In progress as of 4 September 2026, none confirmed submitted.** A0 was marked done on
the strength of its four checks passing, but filing these was part of A0's scope and was
never done.

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
| A5 | Shopify: OAuth, adapter, publish, idempotency, error normalization, digital delivery decision | Real product publishes, second click creates nothing, the file is actually deliverable to a buyer | code done, **exit test unverified** |
| A6 | Etsy: OAuth, adapter, draft, images, digital file, activate, idempotency | Real product publishes and is purchasable | |
| A7 | Publish Everywhere orchestration, jobs, progress, retry, activity log | One action, two live URLs, one failure recovered without duplicates | |

**Gate A passes when** an outside creator, unassisted, takes one of their real products from
empty workspace to two live listings, and leaves them up.

**A5 is code complete and its exit test has not been run.** The exit test is "a real
product publishes, a second click creates nothing, and the file is actually deliverable to
a buyer", and every clause of that needs a live Shopify connection. The Partner account is
still outstanding, so the adapter, OAuth, credential sealing, idempotency and error
normalization are all exercised against mocks and none of them has yet met Shopify.

This is deliberately **not** recorded as done. A0 was marked complete on the strength of its
checks passing while the app registrations it also owned were never filed, and that error
went unnoticed for four steps. A step whose exit test cannot run is a step that says so.

What remains for A5: register the Partner app, set the Shopify client id and secret, connect
a development store, publish a real product, click Publish twice, and confirm a buyer can
download the file after the manual attach step.

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
