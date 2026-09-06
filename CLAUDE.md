# CLAUDE.md

## What Fanwise is

Fanwise is a canonical digital-product operating system for creators who sell the same
product across multiple storefronts and marketplaces.

Marketplace integrations are adapters around the Fanwise domain model. Never redesign the
core product model around an external marketplace. Shopify and Etsy are initial
destinations, not architectural authorities.

Publishing is the initial wedge. Do not implement marketplace intelligence, automated
optimization, browser automation, physical commerce, or unrelated SaaS features unless
explicitly requested.

## Current step

**Step: A5 (Shopify adapter, OAuth, credentials, publishing) is code complete. Its exit
test needs a live Shopify connection and has not been run. A6 does not begin until it has.**
See `docs/roadmap.md`. Implement the current step only. Do not build ahead.

## Architecture invariants

These do not bend. If a task appears to require breaking one, stop and say so.

1. The canonical product is the source of truth. It never becomes Shopify-shaped or
   Etsy-shaped. Channel-specific fields live on `channel_listings`, not `products`.
2. All marketplace behavior sits behind a `ChannelAdapter`. No provider name appears in
   the product domain, in components outside `components/channels/`, or in shared utils.
3. Every external write is idempotent. The idempotency key is persisted before the call,
   in the same transaction as the job row.
4. Every publication produces an immutable snapshot. Snapshots are never updated or
   deleted.
5. AI may transform positioning, tone, phrasing and structure. AI may never introduce a
   factual claim absent from the FactSheet. The factuality validator runs on every
   generation, and a failed validation blocks the listing.
6. Row Level Security is on for every tenant table. Workspace isolation is proven by
   tests, not by inspection.
7. Marketplace credentials are encrypted at rest, read server-side only, never logged,
   never placed in an AI prompt, never returned to the browser.
8. Capabilities are declared per adapter. The UI never offers an action a provider cannot
   perform. Assisted channels do not implement `publish`.

## Rules

1. Never weaken RLS, an idempotency check, or the factuality validator to unblock a
   feature. These three are the product.
2. Never disable or skip a failing test to make CI green. Fix it or report it.
3. Never suppress TypeScript errors without a written justification in the PR.
4. Avoid `any`. Prefer discriminated unions and Zod-inferred types.
5. All schema changes go through migrations. Never touch a deployed schema by hand.
6. All external API responses are validated with Zod before use.
7. Long external calls run in background jobs, never in an interactive request.
8. Do not surface raw provider errors. Normalize to a user-readable message, persist the
   original.
9. Implement the simplest correct version. Do not build V2 because the architecture allows
   it.
10. Keep `main` deployable. One step per branch, one PR per step, one session per step.
    Two agents in one working directory will fight over the index and the checked-out
    branch, and the loser's edit disappears without an error. If parallel work is wanted,
    each agent gets its own git worktree. Before resuming a paused session, check whether
    another is still live: files modified more recently than your own last edit are the
    tell.

## Stack

- Next.js App Router, TypeScript, React
- Tailwind, shadcn/ui where it saves time, custom components for workflow surfaces
- Supabase: Postgres, Auth, Storage
- Background jobs: thin `enqueue()` abstraction now, Trigger.dev adopted at step B1
- AI: provider abstraction, Anthropic first, no provider name in business logic
- Stripe for billing, Sentry for errors, Zod for validation
- Vitest, React Testing Library, Playwright

Do not add infrastructure without a demonstrated need in the current step.

## Vocabulary

Use these words in code, UI and docs, consistently.

| Term | Meaning |
|---|---|
| Product | The Fanwise canonical record, the source of truth |
| Channel | A commerce destination (a marketplace or an owned store) |
| Connection | An authenticated relationship to a channel |
| Listing | The channel-specific representation of a product |
| Adapter | Code translating between Fanwise and one channel |
| Publication | The act of sending a listing to a channel |
| Snapshot | Immutable historical state of a listing |
| Sale event | A normalized transaction |
| Readiness | Deterministic validation of publishability |
| FactSheet | The typed, derived set of facts AI is allowed to state |

In the UI say **Publish**, not Submit. Say **Channels**, not Marketplaces. Say **Product**,
not Item. The central action is **Publish Everywhere**.

## Pricing model

$9 per month base, plus $6 per connected external marketplace. One owned storefront
(Shopify) is included at no channel charge. Annual billing is ten months for twelve.

Billing consequences, which are not optional:

- Connecting or disconnecting a channel is a billing event, coupled to
  `channel_connections`.
- Disconnection decrements quantity at the end of the period. No mid-cycle refund.
- A connection bills for a minimum of one full period.
- Entitlements gate on connected channel count and type, never on a plan name string.

Never scatter `if (plan === "pro")` through components. All plan logic lives in the
entitlement service.

## Commands

```bash
pnpm dev              # local dev
pnpm typecheck        # must pass before commit
pnpm lint
pnpm test             # unit
pnpm test:db          # RLS and tenancy
pnpm test:e2e         # Playwright
pnpm build            # production build
supabase migration new <name>
supabase db reset     # local only, never against a deployed project
```

## Testing expectations

Unit: product schemas, readiness, channel requirements, listing transformations, AI
structured output, the factuality validator, entitlements, error normalization,
idempotency keys, revenue aggregation.

Database: RLS, tenancy, membership, cascades, external ID uniqueness, transaction
deduplication, snapshot immutability.

Integration: mock Shopify, Etsy, Anthropic and Stripe. Cover OAuth token handling, product
creation, upload, publish, retry, transaction ingestion, AI failure.

E2E: the ten journeys in `docs/testing.md`. Journey 9 (workspace A cannot reach workspace
B) must never be skipped.

## Definition of done

A feature is done when the data model is correct, authorization exists, failure and
loading states exist, the empty state exists, types are correct, tests exist, docs are
updated, and the production build passes.

External integrations additionally require idempotency, error normalization, retries where
appropriate, credential security, and persisted external IDs and URLs.

## Reporting protocol

At the end of every step, report:

- **Scope completed**, and confirmation that no later-step functionality was added
- **Files changed**, major files and directories
- **Migrations**, exact names
- **Tests** added, commands run, results
- **Security impact**: RLS, auth, secrets, OAuth, storage
- **Known limitations** left deliberately incomplete
- **Next step**, one recommendation only

Do not continue into the next step automatically.

## Reference docs

- `docs/decisions/`: architecture decision records, and `0002` is the open decisions
  register: everything still owed an answer, grouped by when the answer is needed
- `docs/architecture.md`: canonical product and adapter contract
- `docs/roadmap.md`: the three gates and current step
- `docs/data-model.md`: tables and relationships
- `docs/channel-adapters.md`: adapter contract and capability matrix
- `docs/ai-merchandising.md`: FactSheet, prompt profiles, factuality rules
- `docs/billing.md`: Stripe object model for channel-based pricing
- `docs/security.md`: RLS, encryption, secrets
- `docs/design-system.md`: palettes, type, components. Style through tokens, never literals
- `docs/channels/creative-market.md`: the worked channel spec, and the first test channel
- `docs/channel-feasibility.md`: what each channel can actually support
- `docs/strategy.md`: long-range vision. Context only. Never a work queue.

## Design

`design/marketing/` holds the published landing and pricing mockups as static HTML. They are
the source of truth for the visual system and are never imported by `app/`.

The workspace window inside `design/marketing/landing.html` is the closest thing to a spec
for the publish screen: master listing on the left, derived channel listings on the right
with per-channel statuses and an inline rejection fix. Read it before building A4 and A7.

Every figure in the mockups is placeholder except the channel modes and the pricing, which
are accurate. Do not carry invented usage statistics into anything real.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
