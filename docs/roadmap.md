# Roadmap

**Current step: A2, complete. A3 is next and has not been started.**

Three gates. Nothing after a gate begins until the gate passes. Update the line above when a
step completes, and do not work on more than one step at a time.

## External dependencies, file these first

| Dependency | Needed by | Submitted | Approved |
|---|---|---|---|
| Etsy developer app | A6 | not yet | |
| Etsy commercial access | A6 | not yet | |
| Shopify Partner account | A5 | not yet | |

Etsy commercial access has no published SLA and applicants report waiting weeks. It is the
single most likely thing to delay the roadmap, and it costs nothing to file today.

**Still outstanding as of 4 September 2026.** A0 was marked done on the strength of its
four checks passing, but filing these was part of A0's scope and was never done. Etsy is
needed by A6, which is three steps away, and the queue is not ours to hurry. File them
before writing A3.

---

## Gate A: the loop closes

One real product, published to two channels, by a person who is not you.

| Step | Content | Exit test | Status |
|---|---|---|---|
| A0 | Repo, CI, Supabase, env validation, job abstraction. File the app registrations | `main` deploys, migrations apply clean, all four checks green | code done, **app registrations outstanding** |
| A1 | Auth, workspaces, membership, RLS | Workspace A cannot read any Workspace B row, proven by test, for every table | done |
| A2 | Canonical product, product types, assets, storage, checksums, image derivative service | A complete product exists with correct derivatives for two image specs, no channel connected | done |
| A3 | Channel registry, connections, listings, adapter contract, capability matrix, requirements engine, two mock adapters | One product yields two independent mock listings, no marketplace string in the product domain | |
| A4 | Manual listing editor, no AI. Readiness UI | A user hand-writes a listing per channel and sees deterministic readiness | |
| A5 | Shopify: OAuth, adapter, publish, idempotency, error normalization, digital delivery decision | Real product publishes, second click creates nothing, the file is actually deliverable to a buyer | |
| A6 | Etsy: OAuth, adapter, draft, images, digital file, activate, idempotency | Real product publishes and is purchasable | |
| A7 | Publish Everywhere orchestration, jobs, progress, retry, activity log | One action, two live URLs, one failure recovered without duplicates | |

**Gate A passes when** an outside creator, unassisted, takes one of their real products from
empty workspace to two live listings, and leaves them up.

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
