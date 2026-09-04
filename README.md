# Fanwise

One canonical product record, translated into channel-specific listings through adapters.

**Create once. Sell everywhere.**

This repository is at **step A2: the canonical product, assets and derivatives, complete**.
Channels, adapters and publishing do not exist yet. See `docs/roadmap.md` for what comes
next.

---

## Local setup

Prerequisites: Node 24, pnpm 9, Docker (for Supabase local), and the Supabase CLI.

```bash
pnpm install
cp .env.example .env.local

supabase start            # prints the local anon and service role keys
# paste those two keys into .env.local

pnpm db:reset             # applies migrations
pnpm dev                  # http://localhost:3000
```

Verify the toolchain before writing any code:

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build
```

All five must pass on a clean checkout. If they do not, fix that before anything else.

The tenancy and end-to-end suites additionally need the local stack running:

```bash
supabase start
pnpm test:db              # RLS: workspace A cannot reach workspace B
pnpm test:e2e             # journeys 1 and 9
```

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Local development server |
| `pnpm typecheck` | TypeScript, no emit. Must pass before every commit |
| `pnpm lint` | ESLint |
| `pnpm format` / `pnpm format:check` | Prettier |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:db` | RLS and tenancy tests. Needs `supabase start` |
| `pnpm test:e2e` | Playwright |
| `pnpm build` | Production build |
| `pnpm db:start` / `pnpm db:reset` | Local Supabase |
| `pnpm db:types` | Regenerate `lib/supabase/database.types.ts` |

## What exists at A2

```
app/(auth)/          sign in and sign up, email and password
app/onboarding/      first workspace creation
app/w/[slug]/        the workspace surface. Every app route is slug-scoped
  products/          catalog, create, and the canonical record editor
  assets/.../download signed download, named from the filename column
proxy.ts             session refresh, plus a redirect that is not authorization
lib/env.ts           Zod environment validation, fails fast at boot
lib/auth/            sign in, sign up, error normalization
lib/workspaces/      queries, the create_workspace action, schemas
lib/products/        the canonical record, assets, storage, sniffing, derivatives
lib/slug.ts          shared slug generation
lib/jobs/            JobQueue interface plus an in-process runner
lib/supabase/        browser, server and service-role clients, typed
supabase/            local config and four migrations
tests/unit/          env, jobs, slugs, schemas, sniffing, the derivative engine
tests/db/            tenancy, and the A2 derivative pipeline exit test
tests/e2e/           smoke, journey 1, journey 9
docs/                architecture, roadmap, design system, channel specs
design/marketing/    the published landing and pricing mockups, checked in as spec
.github/workflows/   verify, tenancy, e2e
```

Four things are load-bearing and documented in `docs/security.md` and
`docs/data-model.md`:

- Membership checks go through `security definer` functions so policies cannot recurse.
- `workspaces` has no INSERT policy; creation runs through `create_workspace()`.
- A signed upload URL bypasses storage RLS by design. The server action that mints it is the
  authorization boundary, and it chooses the storage path itself.
- `product_assets` is immutable once ready, which is what makes `(derived_from, spec_hash)`
  a sound derivative cache key with no checksum in it.

The design tokens in `app/globals.css` come from `design/marketing/`. Open either HTML file
directly in a browser, no build step. See `design/README.md` for what is real in them and
what is placeholder.

## What does not exist yet, on purpose

No channels, no adapters, no listings, no publishing, no AI, no billing. No member
invitations either: every workspace has exactly one owner, and roles beyond `owner` exist in
the enum but are not assignable.

**No readiness engine.** `product_status` includes `incomplete` and `ready`, but nothing
computes them: products stay `draft` until a human archives them. Product readiness and
channel readiness are separate ideas (`docs/architecture.md`) and both arrive at A4.

Each of these arrives in its own step. `CLAUDE.md` explains why building ahead is treated as
a defect.

## Known limitations at A2

Deliberate, and worth knowing before A3 builds on them:

- **Abandoned uploads.** A signed upload URL is issued alongside a `pending` asset row. If
  the browser never completes the upload, the row stays `pending` forever and no object is
  ever written. It shows in the UI as Uploading and can be deleted by hand.
- **Orphaned storage objects.** If an upload completes but finalization never runs, or a
  delete removes the object and then fails before removing the row, storage and the table
  disagree.
- **Deletion is ordered object first, row second, always.** An object with no row merely
  wastes space and is invisible. A row with no object is a broken asset the UI keeps
  offering, which is the worse failure.
- **There is no reaper.** Nothing sweeps up either case. That is a background job, and it is
  not part of A2.

## Before writing code

Two external applications gate later steps and both have unpredictable approval times. File
them now, and record the submission dates in `docs/roadmap.md`.

1. **Etsy** developer app, then request commercial access. Applicants report waiting weeks.
2. **Shopify** Partner account and a Dev Dashboard app.

## Working with Claude Code

Read `CLAUDE.md` first. One step per branch, one PR per step, and the step is named at the
top of `CLAUDE.md`. Ask for a plan before implementation:

> You are implementing step A2 only. Read CLAUDE.md and docs/architecture.md first. Produce
> a short implementation plan and wait for approval. Do not implement A3 or later.
