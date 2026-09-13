# Import a product from a link

> **Now the product composer.** The link importer below accepts every public source format a
> creator already has — one link, pasted text, PDFs, HTML files and a voice recording, together —
> through one composer on the same route. §15 describes the session/source model that made that
> possible; everything earlier in this document still holds for the link itself.

The implementation plan for the **Import a product** screen: a creator pastes a public URL,
Fanwise reads what is publicly there, proposes a listing draft, and the creator completes
five steps before any marketplace draft is offered.

**Status: phases 1 to 8 built, 12 September 2026. Branch `feat/product-link-import`, not
merged.** The screen, the schema, the adapters, the job and the draft generation are real and
tested; what is still fixture-backed or absent is listed in §12. Phases 6 to 9 — the licence
and rights surfaces beyond their readiness steps, buyer-file upload from this screen, and the
docs housekeeping — are not built.

**What is real:** a pasted link creates a product and an import row, a background job reads
the page through `lib/net/outbound.ts` with redirects re-validated at every hop, two adapters
extract evidence, pictures are fetched and measured into `product_assets`, a model composes a
draft that a claims check refuses to let over-claim, and the row survives a refresh.

**What is not:** no browser rendering, so a page that renders with JavaScript yields nothing
and says so, and offers pasting the text instead (§14); no ZIP intake, so that recovery is
marked not built; no
malware scanning, so §12 records the operational requirement rather than pretending; buyer
files are still uploaded on the product page rather than this one.

---

## 0. Before anything: this is new scope, and it collides by name with B12

Two statements the founder should read before the rest of this document.

**It is not on the roadmap.** `CLAUDE.md` says the current step is A7 done, A8 next, and
"implement the current step only". This feature is in neither gate. It is planned here, and
opening it is a scheduling decision that belongs to the founder, not to this plan.

**"Import" is already taken.** `docs/listing-import.md` on branch `listing-import-in-the-plan`
(PR #74, open, docs only) plans B12: importing a listing a creator **already sells on a
connected marketplace**. This feature imports **a public link that is not a marketplace
listing**. They are different features with different inputs, different trust models and
different failure modes, and they are one word apart.

| | B12, planned | This feature |
|---|---|---|
| Input | a listing URL on a **connected** channel | any public URL |
| Needs a connection | yes, and the credential reads it | no |
| Auth to the source | the creator's sealed marketplace credential | none, ever |
| What arrives | a listing someone already sells | a page, a preview, a description |
| Canonical risk | a marketplace's shape flows into `products` | AI-inferred text flows into `products` |
| Route claimed | `/[slug]/import` | `/[slug]/new/link` (§2) |

They must not share a route, a table, a snapshot member, a journey number or a noun in the
UI. §2 and §3 keep them apart on purpose. If only one of the two is ever built, that is fine;
if both are, a creator has to be able to tell which one they are using, and today's single
**Import a live listing** control on the first-run screen cannot mean both.

---

## 1. What was found in the repository

Audited on `origin/main` at `e0f5996`. Every line below is what the code does today, not what
it should do.

| Concern | What exists |
|---|---|
| Framework | Next.js 16 App Router, React 19, TypeScript 6, Turbopack. `node_modules/next/dist/docs/` is the authority, not training data |
| Package manager | pnpm 9.12.0 |
| Routing | Workspace slug occupies the **first** path segment: `/[slug]/...`. There is no `/app`, no route group for the workspace, no workspace id in a URL |
| Database | Supabase Postgres, 23 migrations, RLS on every tenant table, generated types in `lib/supabase/database.types.ts` |
| Auth | Supabase Auth via `@supabase/ssr`. `app/[slug]/layout.tsx` re-checks the user and the workspace server-side; `getWorkspaceBySlug` returns null for someone else's workspace, indistinguishable from absent |
| Tenancy | `workspaces` + membership. Composite foreign keys `(id, workspace_id)` carry the tenant boundary into the schema |
| Storage | Supabase Storage, private bucket `product-assets`, paths `<workspace>/<product>/<asset><ext>`. Four distinct signed-URL functions in `lib/products/storage.ts`, deliberately not one with a flag |
| Jobs | `lib/jobs` — `JobName` union, `JobPayloads` map, `JOB_NAMES` value list checked against the Trigger.dev tasks by a unit test. In-memory queue when `TRIGGER_SECRET_KEY` is absent |
| AI | `lib/ai` with a provider abstraction; `getProvider()` returns null when no key is configured. FactSheet → prompt → Zod-parsed output → factuality validator |
| Outbound HTTP | **`lib/net/outbound.ts` already is the hardened fetch this feature needs.** HTTPS only, no credentials in the URL, port 443 only, public DNS names only, DNS pinned before connect, no redirects followed, connect and response deadlines, a 5 MB body cap, and gzip/deflate/br decoding capped on the *decompressed* size |
| Design system | Tailwind v4 with CSS custom properties in `app/globals.css`. Style through tokens, never literals. `components/ui/` holds Button, Field, FormError, InfoTip, RequiredMark, SaveStatus |
| Forms | No form library. React 19 `useActionState` + `useFormStatus` over server actions |
| Validation | Zod 4 everywhere, including every external response |
| Tests | Vitest (`test`), Vitest against real Postgres (`test:db`), Playwright (`test:e2e`) |
| Deployment | Vercel. Hosted Supabase is never touched from a linked checkout |
| Security headers | `lib/security/headers.ts`. Production CSP has `frame-src 'none'`, `object-src 'none'`, nonce-based `script-src` with no `unsafe-inline` or `unsafe-eval`, and `img-src` limited to self, data:, blob: and the Supabase origin |

### The five surfaces this feature touches

1. **Product creation.** `app/[slug]/new/page.tsx` → `NewProductForm` → `createProductAction`.
   Two fields, name and type; it creates the row and redirects to the product page. There is
   no source choice of any kind today.
2. **Assets.** `createUploadIntent` mints a signed upload URL the browser PUTs to, then
   `finalize_asset` measures the stored bytes and overwrites whatever the browser claimed.
   Nothing the client says about a file is trusted. Derivatives build from `derived_from`.
3. **Licensing and ownership.** `products.license_summary` is a free-text column rendered by
   `product-form.tsx`. **There is no license model and no ownership or rights field anywhere
   in the schema.** Two of the mockup's five steps have nothing behind them (§3).
4. **Marketplace drafts.** `lib/channels/listings.ts` builds a `ChannelListingDraft` per
   adapter; readiness is `computeReadiness()` over `RequirementResult[]`, and `ready` means
   "no unsatisfied errors", never a threshold.
5. **App shell.** `app/[slug]/layout.tsx` — **a top header, not a sidebar**, with the
   identity, `WorkspaceNav`, theme toggle and sign-out, over `<main class="mx-auto w-full
   max-w-[1160px] px-6 py-10">`.

### Overlapping work, checked branch by branch

| Branch / PR | Touches | Collides? |
|---|---|---|
| `listing-import-in-the-plan` (#74) | docs only, claims `/[slug]/import`, `snapshot_type` `import`, journey 14, decision 29 | **Name and concept.** §0 and §2 keep the route, table and journey apart |
| `companion-window-in-the-plan` (#73, the current checkout) | docs only, B11 | No |
| `feat/public-creator-pages` (#72) | `app/[slug]/`, proxy rewrites, public reads | **Possible.** Both add routes under the workspace segment. #72 lands first or this rebases |
| `feat/settings-page-redesign` (#68) | `app/[slug]/settings/` | No |
| `feat/a7-publish-everywhere`, `b8/exit-run`, `feat/channel-logos` | merged to main already | No |

Six worktrees are live on this repository. `lib/routes.ts`, `lib/slug.ts`,
`app/[slug]/new/`, `components/onboarding/` and `lib/products/` are **unchanged between
`aa97388` and `origin/main`**, so nothing in flight is editing the files this plan claims —
with the single exception of #72, noted above.

---

## 2. Routes, and the two questions the brief asked

### 2.1 The route is under `/new`, and that is the whole collision defence

```
/[slug]/new                     the source chooser: link, files, manually
/[slug]/new/link                paste a URL
/[slug]/new/link/[importId]     the mockup screen
```

Three reasons, in order of weight.

1. **No slug reservation is needed.** `new` is already in `RESERVED_PRODUCT_SLUGS`. A route
   at `/[slug]/import` would need a new reservation in the same commit — and B12 has already
   claimed that word.
2. **The mockup says so.** Its breadcrumb reads `Products / New product` and its heading is
   `Import a product`. Import from a link is one way to start a product, not a peer of the
   catalog.
3. **It leaves B12's route free.** `/[slug]/import` stays available for importing a live
   marketplace listing, and the two never have to share a noun.

`lib/routes.ts` gains three entries and `lib/slug.ts` gains nothing:

```ts
newProduct: (w: string) => `/${w}/new`,
newProductFromLink: (w: string) => `/${w}/new/link`,
productImport: (w: string, importId: string) => `/${w}/new/link/${importId}`,
```

`workspaceSection()` needs no change: Products is the remainder, so everything under `/new`
already marks Products as current.

### 2.2 The app shell: there is no sidebar, and the header stays

The brief asks whether to bypass the shared sidebar on this route. **The workspace shell is a
horizontal header, not a sidebar.** So the real question is whether to suppress that header,
and the answer is no.

The header is the tenancy boundary's visible half and the only way out of this screen. What
the mockup actually needs is not the header's absence but **more width than
`max-w-[1160px]`**, for its two-column body.

The change is therefore local and additive, and the layout keeps its default:

```tsx
// app/[slug]/layout.tsx — the ONLY change to the shell
<main className="mx-auto w-full max-w-(--workspace-width,1160px) px-6 py-10">
```

with `--workspace-width` set to `1400px` by the import route's own wrapper. Nothing else in
the app sets it, so nothing else moves.

**Rejected: a `(wide)` route group or a parallel layout.** Both duplicate the auth and
workspace checks in `app/[slug]/layout.tsx`, and a duplicated tenancy check is a tenancy
check that will drift. One CSS variable cannot drift.

The mockup's breadcrumb (`Products / New product`) is added inside the page, not the shell.
Its bell icon is not built — there is no notification system, and drawing one would promise
something that does not exist.

---

## 3. Data model

### 3.1 The two-row rule

A pasted URL creates **a `products` row in `draft` and a `product_imports` row, in one
transaction, and never a `channel_listings` row.** A marketplace draft is built only when the
creator presses **Review marketplace drafts**, which §6 keeps disabled until all five steps
are complete.

Creating the product immediately is what makes buyer-file upload work at all:
`product_assets.product_id` is a composite foreign key to `(products.id, workspace_id)`, so
there is no such thing as an asset without a product. The alternative — a fully detached
import that materialises a product at the end — needs a second storage prefix, a second
finalize path and a copy step, to protect a canonical record from the creator's own artifact.
That is B12's risk, not this one.

**What seeds the product row is observed facts only.** The name comes from what the page
said its title was. Nothing a model inferred touches `products` until the creator accepts it
on this screen. That is §7's rule and it is the reason `suggestions` is a separate column
from `observed`.

### 3.2 `product_imports`

```sql
create type public.import_source_kind as enum ('claude_artifact', 'webpage');

create type public.import_status as enum (
  'pending',      -- row written, job enqueued, nothing fetched
  'fetching',     -- the job claimed it
  'analyzed',     -- observed facts are in, suggestions may or may not be
  'unavailable',  -- the source could not be read; `recovery` says why
  'failed',       -- Fanwise broke, not the source
  'confirmed'     -- the creator finished all five steps
);

create table public.product_imports (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  product_id uuid not null,
  source_url text not null,
  source_kind public.import_source_kind not null,
  status public.import_status not null default 'pending',

  -- What the source actually said. Never model output.
  observed jsonb not null default '{}'::jsonb,
  -- What a model proposed from `observed`. Never promoted without a person.
  suggestions jsonb not null default '{}'::jsonb,
  -- Which suggested fields the creator accepted, and when.
  accepted jsonb not null default '{}'::jsonb,

  -- Why an unavailable source is unavailable, in Fanwise's vocabulary.
  recovery text,
  -- A creator-readable message. Never a raw provider error (rule 8).
  normalized_error_message text,

  requested_by uuid references auth.users (id) on delete set null,
  fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint product_imports_product_fk
    foreign key (product_id, workspace_id)
    references public.products (id, workspace_id) on delete cascade,
  constraint product_imports_recovery_known check (
    recovery is null or recovery in (
      'private', 'login_required', 'organization_only', 'expired',
      'not_found', 'not_html', 'too_large', 'unreachable', 'refused'
    )
  ),
  -- One import per product. A re-paste replaces the URL on the same row.
  constraint product_imports_product_unique unique (product_id)
);
```

RLS repeats the A2 pattern exactly: `is_workspace_member` for select and insert and update,
policies delegating rather than re-deriving, `(select auth.uid())` wrapped, no FORCE.

**`observed` and `suggestions` are Zod-validated in the application, never by the database.**
Same choice `products.metadata` made, and the same reason: a discriminated union is a better
description of a payload than a check constraint is.

### 3.3 The two steps that have no model behind them

| Step | Today | What this plan does |
|---|---|---|
| Source | `product_imports` (new) | complete when `status = 'analyzed'` |
| Listing | `products` columns | complete when name, type, price, description are non-empty |
| Buyer files | `product_assets` | complete when ≥1 `deliverable` asset is `ready` |
| **License** | `products.license_summary`, free text | **V1: a required non-empty `license_summary`, chosen from a small preset list or written.** No `licenses` table |
| **Ownership** | nothing | **V1: `products.rights_confirmed_at timestamptz` and `rights_confirmed_by uuid`.** An attestation with a timestamp and a person, not a rights model |

Both are deliberately the smallest honest thing. A license catalog and a rights model are
each their own feature; a required field and a timestamped attestation are what the five-step
readiness needs to be true rather than decorative. Neither is an AI-suggestable field — a
model may never propose that a creator owns something.

### 3.4 Migration strategy

One migration, additive, no backfill, no change to any existing column:

```
supabase migration new product_link_import
```

contains: two enums, `product_imports` with its RLS policies and grants, its `set_updated_at`
trigger, and two columns on `products` (`rights_confirmed_at`, `rights_confirmed_by`). Then
`pnpm db:types`.

**It does not touch `snapshot_type`.** B12 wants an `import` member for a marketplace payload;
this feature records nothing on a listing, so it needs none. Adding one here would take the
word B12 needs.

**Not run against hosted.** Local `supabase db reset` is shared with five other worktrees —
see the parallel-worktree hazard. Migrate forward locally; never reset.

---

## 4. The source-adapter contract

A new namespace, `lib/sources/`, that mirrors `lib/channels/` in shape and shares nothing
with it. **A source is not a channel**: it has no connection, no credential, no capability to
publish, and no billing consequence. Putting a source behind `ChannelAdapter` would put a
provider that can never publish into a registry whose whole purpose is publishing.

```ts
// lib/sources/types.ts
export const SOURCE_KEYS = ["claude_artifact", "webpage"] as const
export type SourceKey = (typeof SOURCE_KEYS)[number]

export interface SourceAdapter {
  readonly key: SourceKey
  /** Ordered. The first adapter that claims a URL owns it; `webpage` is last. */
  claims(url: URL): boolean
  /** Pure. Normalizes a URL a creator pasted; no network. */
  normalize(url: URL): URL
  /** One outbound read through lib/net. Returns raw bytes plus content type. */
  fetch(url: URL, io: SourceIo): Promise<SourceFetchResult>
  /** Pure. Bytes to observed facts, or a reason they cannot be read. */
  observe(result: SourceFetchResult): ObservedFacts | SourceUnavailable
}

export interface ObservedFacts {
  title: string | null
  description: string | null
  siteName: string | null
  canonicalUrl: string | null
  /** Absolute https URLs only, deduplicated, in document order, capped at 8. */
  imageUrls: string[]
  /** What each fact was read from, so the UI can say where it came from. */
  provenance: Record<keyof ObservedFacts, "og" | "twitter" | "meta" | "dom" | "header">
}

export interface SourceUnavailable {
  recovery:
    | "private" | "login_required" | "organization_only" | "expired"
    | "not_found" | "not_html" | "too_large" | "unreachable" | "refused"
  /** Creator-readable. The original is persisted, never surfaced (rule 8). */
  message: string
}
```

Four rules the code review should check:

1. **`observe` is pure and takes no network.** Every parser is testable against a recorded
   fixture with no server. This is where `toProposal`'s discipline in B12 came from and it is
   the same discipline.
2. **`fetch` calls `outboundFetch` and nothing else.** No `fetch`, no `axios`, no
   `undici`. The SSRF boundary is not optional and is not per-adapter.
3. **Source names live only in `lib/sources/adapters/`.** A `tests/unit/source-boundaries.test.ts`
   mirrors `channel-boundaries.test.ts` over `SOURCE_KEYS`, so `claude` in `lib/products` or
   in a shared util fails CI. The existing channel test does not cover this, because
   `claude_artifact` is not a channel key.
4. **`claims` is ordered and total.** `webpage` claims everything, so a paste always resolves
   to an adapter and "no adapter matched" is not a state the UI has to render.

### 4.1 The Claude Artifact adapter

Claims `https://claude.ai/code/artifact/<id>` and `https://claude.site/artifacts/<id>`. It
reads the public page the same way any visitor would, with no cookie, no token and no header
that asserts an identity.

**Recovery is the point of this adapter, not an edge case.** Artifacts are private by
default, so the unhappy path is the common path, and it has to resolve to one of the
`recovery` values above rather than to a stack trace:

| What comes back | `recovery` | What the screen offers |
|---|---|---|
| 401, 403, or a sign-in page | `login_required` | publish or copy a public link; paste code; upload a ZIP; continue manually |
| A page that says the artifact is org-only | `organization_only` | the same four |
| 404 or a tombstone | `not_found` | the same four |
| A link that has expired | `expired` | the same four |
| Not HTML | `not_html` | upload a ZIP; continue manually |
| `OutboundError` `body_too_large` | `too_large` | upload a ZIP; continue manually |
| `OutboundError` timeout/network/unresolvable | `unreachable` | retry; continue manually |
| `OutboundError` scheme/port/hostname/address_blocked | `refused` | the URL is not publicly fetchable; continue manually |

**Detecting a sign-in wall is a heuristic, and the plan says so out loud.** A 200 that is
really a login page is the case that gets this wrong. V1's rule: a 200 whose extracted title
and description are both empty, or whose document contains a password input, is
`login_required` rather than an empty success. Open question 3 in §9 is whether that holds.

### 4.2 The webpage adapter

Claims any https URL the first adapter did not. Parses Open Graph, then Twitter cards, then
`<title>` and `<meta name=description>`, in that order, recording which one answered in
`provenance`.

The HTML parser must be the one thing this feature gets unambiguously right: **it parses, it
does not execute**, and §7 is where that is written down.

---

## 5. Server and background-job flow

Rule 7 — long external calls run in background jobs, never in an interactive request — makes
this two phases whatever the UI looks like.

```
  ┌─ server action: startImportAction(workspaceSlug, url) ────────────────┐
  │ 1. requireWorkspace()            auth + tenancy, not "the page rendered"│
  │ 2. Zod-parse the URL, then validateOutboundUrl() for shape only         │
  │ 3. claims() picks the adapter. No network yet.                          │
  │ 4. ONE transaction:                                                     │
  │      insert products  (draft, name = host or "Untitled", slug derived)  │
  │      insert product_imports (pending, source_url, source_kind)          │
  │ 5. enqueue("analyze_import", { workspaceId, importId },                 │
  │            { idempotencyKey: `import:${importId}` })                    │
  │ 6. redirect to /[slug]/new/link/[importId]                              │
  └────────────────────────────────────────────────────────────────────────┘

  ┌─ job: analyze_import ─────────────────────────────────────────────────┐
  │ a. claim the row: pending -> fetching, conditional update. A second     │
  │    attempt that loses the claim returns, doing nothing.                 │
  │ b. adapter.fetch() through outboundFetch()                              │
  │ c. adapter.observe() -> ObservedFacts | SourceUnavailable               │
  │      unavailable: status = 'unavailable', recovery, normalized message, │
  │                   persist the original error, and stop.                 │
  │ d. write observed, status = 'analyzed', fetched_at                      │
  │ e. for each observed image: insert a pending product_assets row and     │
  │    enqueue fetch_import_image. Cover first, the rest preview_image.     │
  │ f. if getProvider() !== null: enqueue suggest_import_listing            │
  └────────────────────────────────────────────────────────────────────────┘

  ┌─ job: fetch_import_image ─────────────────────────────────────────────┐
  │ outboundFetch the image, sniff the real bytes, uploadObject(),         │
  │ then reuse finalize_asset. Nothing the page claimed about the image    │
  │ is trusted — the same rule the browser upload path already follows.    │
  │ A failed fetch leaves a `failed` asset row with a reason, not a hole.  │
  └───────────────────────────────────────────────────────────────────────┘

  ┌─ job: suggest_import_listing ─────────────────────────────────────────┐
  │ Model input is `observed` and the product type ONLY. Output is         │
  │ Zod-parsed and written to product_imports.suggestions.                 │
  │ It is NOT written to products, and it does NOT create a channel        │
  │ listing, so the factuality validator is not the gate here — §7 is.     │
  └───────────────────────────────────────────────────────────────────────┘
```

`lib/jobs/types.ts` gains three `JobName` members, three `JobPayloads` entries and three
`JOB_NAMES` values; `lib/jobs/handlers.ts` gains three handlers; `trigger/jobs.ts` gains three
tasks. The existing unit test that compares `JOB_NAMES` with the declared tasks fails until
all three are present, which is the intended forcing function.

**Payloads carry ids only**, matching `publish_listing` and `generate_listing`: a job that
runs late reads the row as it stands, not a copy taken when the creator clicked.

**Idempotency.** The key is `import:<importId>`, persisted in the row before the job is
enqueued, in the same transaction (invariant 3). The claim in step (a) is what makes a
duplicate delivery a no-op rather than a second fetch.

The client polls the import row through `lib/use-background-refresh.ts`, which already exists
and is what the publish screen uses.

---

## 6. UI state machine

### 6.1 `/[slug]/new` — the source chooser

Three cards, equal weight, no default:

```
  ┌ Import from link ─┐  ┌ Upload files ─────┐  ┌ Start manually ───┐
  │ Paste a public    │  │ Drag in the files │  │ Type the details  │
  │ link. Fanwise     │  │ buyers receive.   │  │ yourself.         │
  │ reads what is     │  │                   │  │                   │
  │ publicly there.   │  │                   │  │                   │
  └───────────────────┘  └───────────────────┘  └───────────────────┘
```

**Upload files** and **Start manually** both land on today's create-then-edit path; only the
first is new. Today's `NewProductForm` becomes the body of **Start manually** and is not
rewritten.

### 6.2 `/[slug]/new/link/[importId]` — the mockup screen

```
                    ┌──────────┐
   paste ──────────▶│ pending  │
                    └────┬─────┘
                         │ job claims
                    ┌────▼─────┐
                    │ fetching │──── poll ────┐
                    └────┬─────┘              │
            ┌────────────┼────────────┐       │
            ▼            ▼            ▼       │
      ┌──────────┐ ┌──────────────┐ ┌────────┐│
      │ analyzed │ │ unavailable  │ │ failed ││
      └────┬─────┘ └──────┬───────┘ └───┬────┘│
           │              │ recovery    │ retry
           │              │ (4 options) └─────┘
           │              └── continue manually ──▶ product page
           ▼
   ┌───────────────────────────────────────────┐
   │ five steps, each independently completable │
   │ Source ✓  Listing  Buyer files  License  Ownership │
   └───────────────┬───────────────────────────┘
                   │ all five complete
                   ▼
          Review marketplace drafts  ──▶ product page
```

Three rules the components have to hold.

**Readiness is its own computation, not `computeReadiness()`.** The existing function is
per-channel and consumes `RequirementResult[]`; this is a per-import, five-step count, and
overloading one for the other would make a channel's readiness and an import's readiness the
same number by accident. New: `lib/imports/readiness.ts`, exporting `importReadiness()` →
`{ steps, completed, total, percent, ready }`. Same discipline, though: `ready` is "all five
complete", never a threshold. The mockup's 40% is 2 of 5, a count, not a grade.

**Observed and suggested are different kinds of thing and are marked differently.** The
mockup's `Suggested` pill is only ever on a field whose value came from
`product_imports.suggestions`. A field read from the page carries a source marker instead —
*From the page*, with the `provenance` value naming where. A field with neither marker was
typed by the creator. Three states, three markers, and the component takes a discriminated
union rather than a boolean so a fourth cannot be added by accident:

```ts
type FieldOrigin =
  | { kind: "observed"; from: "og" | "twitter" | "meta" | "dom" | "header" }
  | { kind: "suggested" }
  | { kind: "creator" }
```

Editing a field moves it to `creator`. Accepting a suggestion writes the value to `products`
and records the acceptance in `product_imports.accepted`.

**Review marketplace drafts is disabled until all five steps are complete, and the disabled
state says which are missing.** The mockup already does this — *Complete 3 required items to
continue.* The button is a real `disabled` here rather than `aria-disabled`, because unlike
the first-run import control there is a visible, adjacent explanation of what to do instead.

### 6.3 Components

| New | Reused unchanged |
|---|---|
| `components/imports/source-picker.tsx` | `components/ui/button.tsx` |
| `components/imports/link-input.tsx` | `components/ui/field.tsx` |
| `components/imports/import-steps.tsx` (the 5-step rail) | `components/ui/form-error.tsx` |
| `components/imports/origin-badge.tsx` (observed / suggested) | `components/ui/info-tip.tsx` |
| `components/imports/source-preview.tsx` (images + captured facts) | `components/ui/required-mark.tsx` |
| `components/imports/recovery-panel.tsx` | `components/ui/save-status.tsx` |
| `components/imports/listing-draft-form.tsx` | `components/channels/tag-input.tsx` |
| | `lib/use-background-refresh.ts` |

`components/channels/tag-input.tsx` is reused as-is and is the reason the mockup's tag row
needs no new component. Nothing here imports from `components/channels/` beyond that one
file, and nothing imports an adapter.

---

## 7. Security model

Eight rules, each with the thing that enforces it.

1. **No credentials, ever.** Fanwise never asks for, stores, forwards or reuses a creator's
   Claude credentials or cookies. Every source read is anonymous. `outboundFetch` already
   refuses a URL carrying credentials (`OutboundError` `credentials`), and the adapter sends
   no `Cookie` and no `Authorization`. A unit test asserts the header set an adapter may send
   is a fixed allowlist — `User-Agent` and `Accept` — and nothing else.
2. **No SSRF.** Every read goes through `lib/net/outbound.ts`: HTTPS only, port 443 only,
   public names only, DNS pinned before connect, no redirect followed, deadlines, a body cap
   applied to the decompressed size. The image fetcher uses the same boundary, because an
   `og:image` is a URL a stranger chose.
3. **No imported code executes in the authenticated origin. This is the invariant the
   feature lives or dies by.**
   - The HTML is **parsed, never evaluated**: no `innerHTML`, no
     `dangerouslySetInnerHTML`, no `eval`, no `new Function`, no dynamic `import()` of
     anything fetched.
   - **No iframe of the source.** Production CSP is already `frame-src 'none'`, so an iframe
     would not render — but it is stated here so nobody adds a permissive `frame-src` later
     to "fix" a blank box.
   - **The preview is images, not a live page.** The mockup's screenshot strip is
     `product_assets` rows served from Supabase storage, which is why `img-src` already
     admits the Supabase origin and needs no widening for a remote host.
   - Extracted text is rendered as React children, which escapes it.
   - **A pasted ZIP or pasted code is stored, never run.** It becomes a `source_file` or
     `archive` asset and is not unpacked, executed, transpiled or previewed.
   - A unit test greps the import feature's own files for `innerHTML`, `dangerouslySetInnerHTML`,
     `eval(`, `new Function` and `<iframe`, and fails on any of them.
4. **Server-side only.** No source URL is fetched from the browser. The adapters import
   `node:dns`/`node:net` transitively and are server modules; `next.config.ts` already stubs
   those for the browser graph, and a client component importing an adapter would throw at
   the stub rather than silently shipping it.
5. **Tenancy.** `product_imports` is RLS'd on `workspace_id`, its product reference is the
   composite `(product_id, workspace_id)` foreign key, and every server action calls
   `requireWorkspace()` first. Rendering the button is not authorization.
6. **Error normalization (rule 8).** A creator sees a `recovery` message written by Fanwise.
   The original `OutboundError` kind and the provider's status are persisted and never
   rendered. No URL, header or body from the source reaches the UI verbatim.
7. **The AI prompt receives observed facts and a product type, and nothing else.** No
   credential, no cookie, no full HTML, no raw script content, no storage URL.
8. **Suggested text never becomes a canonical fact silently.** This is the invariant-5
   consequence and it is the same trap B12 §11 found. If a model-inferred description landed
   in `canonical_description`, the FactSheet would then contain it, and the factuality
   validator would happily let a later generation restate an invention as fact. So:
   suggestions live in `product_imports.suggestions`; a suggestion reaches `products` only
   when a person accepts it on this screen; and the screen says plainly that accepted text
   becomes something Fanwise may restate elsewhere.

---

## 8. Testing plan

**Unit** (`pnpm test`)
- `claims()` and `normalize()` over the real URL shapes, including a URL each adapter must
  refuse and the ordering that makes `webpage` last.
- `observe()` against recorded fixtures: a full Open Graph page, a page with Twitter cards
  only, a `<title>`-only page, a sign-in wall, a 404 tombstone, an org-only page, an expired
  link, a non-HTML response, and a page with relative and `http:` image URLs that must be
  dropped or absolutized.
- Every `OutboundError` kind maps to exactly one `recovery` value, exhaustively, over the
  union — so a new error kind fails to compile rather than falling through to `unreachable`.
- `importReadiness()`: five steps, each independently, 0 through 5, `ready` only at 5.
- `FieldOrigin` rendering: observed, suggested and creator each produce a distinct marker.
- The header allowlist (§7.1) and the no-execution grep (§7.3).
- `tests/unit/source-boundaries.test.ts`, mirroring the channel one over `SOURCE_KEYS`.
- `JOB_NAMES` versus the declared Trigger.dev tasks — the existing test, now covering three
  more.

**Database** (`pnpm test:db`, needs all six env vars from `supabase status -o env`)
- RLS: workspace B cannot select, insert or update workspace A's `product_imports`.
- The composite foreign key refuses an import attached to another workspace's product.
- `product_imports_product_unique` holds: a second import for one product loses.
- `rights_confirmed_at` and `rights_confirmed_by` are writable by a member and by nobody else.
- The job claim is atomic: two concurrent `pending -> fetching` updates, one winner.

**Integration** (mocked transport, no network)
- The scripted transport from `tests/unit/outbound-support.ts` drives each adapter through
  success, 401, 403, 404, a redirect, an oversized body, a slow response and a compressed
  body.
- The image fetcher stores bytes, `finalize_asset` measures them, and a fetch failure leaves
  a `failed` asset row with a reason.
- A model that returns unparseable output leaves `suggestions` empty and the screen usable.

**E2E** (`pnpm test:e2e`, and see the port hazard in §9)
- `tests/e2e/product-link-import.spec.ts`: chooser → paste → analyzed → the five steps →
  Review enabled. Against a local fixture server, never a live claude.ai.
- The recovery path: an unavailable source offers four options and **continue manually**
  reaches the product page with the draft intact.
- **No new numbered journey.** This is a variation on journey 1 — empty workspace to a
  product — with a different first step, and journey 15 is B12's. `docs/testing.md` should
  say that explicitly, the way it already says B11 adds none.

---

## 9. Risks and open questions

**Risks**

1. **The name collision with B12 is the largest risk in this plan**, and it is a product
   risk, not a technical one. Two features called import, one first-run control, one
   vocabulary. §0 is the mitigation and the founder has to agree to it.
2. **Abandoned draft products.** Creating the product on paste means a creator who pastes and
   leaves has a `draft` product in the catalog. Mitigation: the catalog already carries a
   status, and the import screen gets a **Discard** action. A sweep of stale drafts is not
   built and should not be.
3. **Detecting a sign-in wall is a heuristic** (§4.1). Wrong in the false-negative direction
   it produces a product named after a login page. The recovery panel is always reachable from
   the analyzed state for exactly this reason.
4. **Storage.** Eight fetched images per import is bounded per import and unbounded across
   imports. This is decision 17, the storage ceiling, still open, and this feature makes it
   arrive sooner.
5. **Parallel worktrees.** Six are live; they share port 3399 and the local Supabase. Use
   `E2E_PORT` and never `supabase db reset`. Broad unrelated failures are usually another
   worktree's.
6. **#72 may move `app/[slug]/`.** Land it first or rebase.

**Open questions, to answer at build**

1. Is a public Claude Artifact URL actually fetchable server-side with no cookie, and what
   does it return — server-rendered HTML with Open Graph tags, or a shell that needs JS? **If
   it is a JS shell, `observe()` gets a title and nothing else, and the whole listing draft
   comes from suggestions rather than observation.** This is the single question that decides
   whether the feature is worth what it costs, and it is answerable in one request.
2. Do `claude.ai` and `claude.site` both need claiming, and is either URL shape stable?
3. Does the login-wall heuristic in §4.1 hold against a real private artifact?
4. Should `license_summary` become a preset list in V1, and if so, which presets? A wrong
   preset list is worse than free text.
5. Is **Confirm ownership** a checkbox or a typed attestation? A checkbox that means nothing
   legally is ceremony; the timestamp is the part that has value either way.
6. Does the creator ever edit the suggestions, or accept them unchanged every time? If always
   accepted, the review screen is ceremony. Count it on the first ten imports.
7. Should **Upload files** on the chooser start an upload immediately, or create the product
   and land on the existing asset manager? V1 assumes the latter, which is zero new code.

---

## 10. Implementation checklist

Each phase is independently reviewable and leaves `main` deployable. Nothing in phase 1
depends on an answer to open question 1; **phase 2 should not start until it is answered.**

**Phase 0 — answer the one question that matters.** One outbound request to a public artifact
URL, in a scratch script, recording what comes back. Half an hour. If it is a JS shell, come
back to this document before writing code.

**Phase 1 — the route and the chooser.** `lib/routes.ts` entries; `/[slug]/new` becomes the
three-card chooser with today's form behind **Start manually**; the `--workspace-width`
variable in the layout. No database change. Ships alone and is useful alone.

**Phase 2 — the schema.** One migration (§3.4), `pnpm db:types`, the RLS tests. No UI.

**Phase 3 — the adapters.** `lib/sources/`, both adapters, `observe()` against fixtures, the
`OutboundError` → `recovery` mapping, the boundary test and the no-execution test. All unit,
no UI, no network.

**Phase 4 — the jobs.** Three job names, three handlers, three Trigger.dev tasks, the claim,
the idempotency key, image fetch into `product_assets` through `finalize_asset`.

**Phase 5 — the screen.** `startImportAction`, the import page, the five-step rail, the
origin badges, the recovery panel, polling. This is the mockup.

**Phase 6 — license and ownership.** The `license_summary` requirement and the
`rights_confirmed_at` attestation, plus their two readiness steps.

**Phase 7 — suggestions.** `suggest_import_listing`, the `Suggested` markers, the acceptance
flow, and the sentence on the screen that says what accepting means.

**Phase 8 — the first-run control.** Decide what **Import a live listing** means now (§0) and
pass an `href` or leave it null. **This is a product decision, not a code change**, and it is
last on purpose.

**Phase 9 — docs.** `docs/roadmap.md`, `docs/data-model.md`, `docs/testing.md` (saying why
there is no new journey), and `docs/decisions/0002` for the license and ownership questions —
numbered **30 and above**, since 29 is B12's and #73 and #74 are both open.

---

## 11. What is not built

- **No authenticated source.** No Claude login, no cookie import, no OAuth to any source. A
  private artifact is made public by its owner or it is not imported.
- **No code execution, no sandbox, no preview iframe.** §7.3.
- **No ZIP extraction.** An uploaded archive is stored and offered to buyers, not unpacked.
- **No bulk import.** One URL, one product.
- **No re-import or sync.** An import is a photograph. Re-pasting replaces the source on an
  unconfirmed draft and does nothing after confirmation.
- **No marketplace reading.** That is B12 and it needs a connection.
- **No screenshot service.** Images come from the page's own metadata or from the creator.
- **No notification bell.** The mockup draws one; nothing is behind it.


---

## 12. What is real, and what is not

Written at the end of the ingestion phase, because the gap between "the screen works" and
"the pipeline works" is exactly where a reader is most likely to assume the wrong one.

### Real

| Thing | Where |
|---|---|
| Retrieval, with every hop re-validated | `lib/net/outbound.ts`, `lib/imports/retrieval/fetch-page.ts` |
| Provider detection, deterministic and total | `lib/imports/sources/registry.ts` |
| Two adapters | `sources/hosted-artifact.ts`, `sources/generic-web.ts` |
| HTML reading, parse-never-render | `lib/imports/retrieval/html.ts` |
| Preview images fetched, sniffed, measured, stored | `lib/imports/retrieval/fetch-asset.ts` |
| Durable status across navigation and refresh | `product_imports`, `/[slug]/new/link/[importId]` |
| Idempotency on workspace + normalized URL, and on content hash | the partial unique index, `hashEvidence` |
| Draft generation with structured output | `lib/imports/compose.ts`, `draft-output.ts` |
| The claims check | `lib/imports/claims.ts` |
| Normalized failures with recoveries | `lib/imports/errors.ts` |

### Not real, and named as such on the screen

- **No browser rendering.** A page whose content is written by JavaScript reads as empty and
  is refused with `unsupported_source`. This was the open question in §9 and the answer is
  now in the code rather than in a guess: Fanwise reads markup, and a shell has none.
- **Pasting code and uploading a ZIP** are offered as recoveries and marked *Not built yet*,
  the way `components/onboarding/import-listing-action.tsx` marks its own promise.
- **No malware scanning.** Nothing in this repository scans an uploaded file, and this step
  adds none. **The operational requirement, recorded rather than implied:** before ZIP or
  project intake ships, either an external scanner runs over `product-assets` before an
  object is ever handed to a buyer, or every uploaded archive lands in a quarantine state
  that Publish Everywhere refuses. A `quarantined` member on `asset_state` is the cheapest
  version and it is not in this migration, because nothing yet produces a file this step
  did not fetch and measure itself.
- **Buyer files** are still uploaded on the product page. The checklist row acknowledges a
  choice and does not yet mint an upload.
- **HTTP is refused, not just discouraged.** The brief asked for http and https; the shared
  outbound boundary is https-only and every channel adapter depends on that, so relaxing it
  would weaken a boundary this feature does not own. An `http://` paste is refused with a
  message telling the creator to paste the secure form.
- **The provider keys are `hosted_artifact` and `webpage`**, not `claude_artifact` and
  `generic_web`. The enum is generated into `lib/supabase/database.types.ts`, which the
  vendor-name sweep in `tests/unit/channel-boundaries.test.ts` reads, and a vendor name there
  would fail it. The mapping from key to service lives in `sources/registry.ts`, which is the
  one directory allowed to know.


---

## 13. The licence model, proposed and built

`docs/product-link-import.md` §3.3 said a licence catalogue was its own feature and left
`license_summary` as the whole of it. Completing the readiness steps needed an answer to
"which licence, exactly, and when", so the smallest compatible model was proposed and built
rather than a generator.

**What was added:** three columns on `products` — `license_id`, `license_version`,
`license_accepted_at` — and a catalogue in `lib/imports/licenses.ts` that the keys point at.
`license_summary` keeps its meaning and all of its readers: the FactSheet derives from it,
every channel adapter reads it, the public product page renders it. Nothing downstream
changed.

**Why a version.** Wording moves. A product that accepted `commercial@1` still says so after
the catalogue is edited, and `licenseText()` returns the stored summary rather than the new
words whenever the versions disagree. The version is read from the catalogue server-side and
never taken from the browser: it is a claim about what Fanwise showed, and a client that
supplied one could record that a creator accepted terms they never saw.

**What is still absent, and is a different feature:** no `licenses` table, so no per-workspace
catalogue; no licence documents or PDF; no per-channel licence mapping; no versioning
machinery beyond a string the catalogue owns. A creator writing their own terms is
`custom@own` with their words in `license_summary`.

**Nothing infers a licence from a page.** `claims.ts` already refuses to let a model write
licence terms; the selection UI preselects nothing and the source's copy never reaches it.

### Ownership

`rights_confirmed_at` and `rights_confirmed_by` gained `rights_attestation_version`, held
together by one all-or-nothing constraint. The second disclosure is
`third_party_components` and `third_party_declared_at`, and the pair distinguishes "the
creator says there are none" from "nobody asked" — a null components column after a
declaration means none.

`RIGHTS_DISCLAIMER` renders beside the control every time: Fanwise records the statement and
the time it was made, does not check it, and is not giving legal advice.

### What the buyer-files step will and will not accept

The upload path is the one the product page already uses, now shared as
`lib/products/upload-client.ts` so the two cannot drift: the server mints a signed URL, the
browser PUTs to storage, and `finalize_asset` measures what landed. Formats and the 4 GB cap
are unchanged — nothing was added.

**A link never satisfies this step.** Readiness counts `ready` deliverable rows, so a public
demo, a source snapshot and a preview image are all invisible to it. Preview images the
importer fetched are `cover_image` and `preview_image` and are counted by nothing here.

**Replacing is additive.** A new file is uploaded beside the old one, and the server refuses
to remove the last measured deliverable. A replacement that fails therefore leaves the
original where it was, without anything having to put it back.

### The handoff

`Review marketplace drafts` saves, then recomputes readiness **from what is persisted** and
returns the product page's address — the surface where channel drafts have always been built,
reviewed and published. There is no second marketplace flow. A browser holding an unsaved
licence can show 100%; only the database can say whether the five steps are done, and
`reviewMarketplaceDraftsAction` is the last place that asks.

---

## 14. Importing from pasted text, a PDF or an HTML file

Added 12 September 2026, off-roadmap like the rest of this feature, at the founder's request.
PR #78 showed that a link cannot import a Claude artifact (the page is a JavaScript shell), and
the founder chose to let a creator hand the material over instead. Three ways, on the same
screen as the link, chosen by `?from=`:

| Tab | What the creator does | Kind | Stored as |
|---|---|---|---|
| Link | pastes a public URL | `hosted_artifact` or `webpage` | nothing; fetched |
| Paste text | pastes words, notes or code, up to 200,000 characters | `pasted_text` | `.txt` |
| PDF | uploads a `.pdf`, up to 20 MB | `pdf_document` | `.pdf` |
| HTML | uploads an `.html` file up to 2 MB, or pastes markup | `html_document` | `.html` |

A pasted text that is a whole HTML document (a doctype or an `<html>` element at the top) is
read as HTML, because a creator copying an artifact's code has handed over markup.

### What is the same

Everything after the reading. The row is a `product_imports` row, the job is `import_source`,
the evidence is `ProductSourceEvidence`, the draft goes through `composeDraft` and the claims
check, suggestions never reach `products` without a save, and readiness, licence, ownership and
the handoff are unchanged. A handed-over source is a kind of import, not a second feature.

### What is different

- **No URL, no fetch.** Migration `20260912210000_import_content_sources` adds three provider
  values and `source_path`, `source_filename`, `source_byte_size`, and makes the two URL
  columns nullable. `product_imports_one_source` holds each row to exactly one source: a link
  kind has a URL and no object, a handed-over kind has an object and no URL.
- **Where the bytes live.** `<workspace_id>/import-sources/<upload_id>.<ext>` in the private
  `product-assets` bucket, so the existing storage policies cover it. The server builds every
  path (`lib/imports/source-storage.ts`). A paste is written by the server action; a file is
  PUT by the browser to a signed URL through `lib/products/upload-client.ts`, still the only
  place the browser fetches, and measured from storage before an import starts. Objects are
  stored as `application/octet-stream`, so no signed link can ever render one as a page.
- **The tenant check, twice.** The job reads `source_path` with the service role, which ignores
  storage policies. `product_imports_source_path_in_workspace` refuses a path outside the row's
  own workspace prefix or of any other shape, and the runner checks `isSourcePathFor` again
  before reading. Without both, a member could point their own import at another workspace's
  object and have the job read it for them. `tests/db/product-import.test.ts` proves the
  database half.
- **The readers** (`lib/imports/sources/content.ts`). Text is read line by line
  (`retrieval/plain-text.ts`): first line as a title unless it looks like code, first
  paragraph as a summary, headings and bullets as visible lines. HTML gets the same
  parse-never-render reading as a fetched page, minus an address, so relative image URLs are
  dropped. A PDF is read with PDF.js through `unpdf` (`retrieval/pdf.ts`): the title property
  if it is a real title, the text layer of the first 40 pages, and nothing else — no rendering,
  images, forms, annotations or attachments.
- **`bodyText`.** Handed-over sources carry up to 20,000 characters of running text in
  evidence, rendered into the prompt and added to the claims corpus. Link imports do not, so
  their hashes and prompts are unchanged; a unit test pins a link import's hash to the value it
  had before this change.
- **No dedupe.** A paste has no stable identity; pasting again makes a second draft.
- **Two new error codes.** `unreadable_file` (not text, not a PDF, damaged or locked) and
  `no_text` (a scanned PDF). Both recover to pasting the text. `unsupported_source` now offers
  pasting the text too, for links and files alike. A handed-over import is never offered
  "replace link" or "publish a public link".
- **The prompt** names the kind of source and moved to version `2026-09-12.2`.

### Not built

- No OCR. A scanned PDF says it has no text and offers pasting.
- No images from a PDF, and none from an HTML file's relative or `data:` URLs.
- The uploaded file is a source, never a buyer file. Whether an artifact is what buyers receive
  is the open question in the artifact-import plan; a creator still adds buyer files in the
  checklist.
- No clean-up job for an upload that was never started. Discarding an import removes its
  object; an abandoned upload leaves a private object behind.
- No replacing a handed-over source. Discard and start again.

---

## 15. The composer: one import, many sources

Added 12 September 2026, off-roadmap, at the founder's request, on branch
`feat/universal-product-import`. It replaces §14's tabs with one composer at the same route,
`/[slug]/new/link`, and turns an import from one source into a session of several. The
connected-channel importer (B12, `docs/listing-import.md`) is a different feature and is
untouched: nothing here uses `/[slug]/import`, a channel connection or an adapter.

### What a creator sees

`Create a product listing`: one text box, source pills, **Add PDF or HTML**, **Record**, and
**Create draft**. A standalone `https://` link, pasted or entered, becomes a pill; anything else
typed stays text and becomes a "Pasted text" source when the draft is created — a paragraph that
mentions a URL is still a paragraph. Files are uploaded and checked the moment they are added;
a recording is uploaded and transcribed before it says `Transcribed`. "Create draft" waits for
unfinished pills and refuses to submit around one that needs attention.

### Limits

All in `lib/imports/limits.ts`.

| Source | Limit |
|---|---|
| Sources per import | 10, counting the link and the pasted text |
| Public links | 1 per import (replaceable) |
| Pasted text | 200,000 characters |
| PDF | 20 MB; text of the first 40 pages |
| HTML | 2 MB |
| Running text per source in evidence | 20,000 characters |
| Recording | 10 MB and ten minutes, stopped automatically at ten; captured at 48 kbps (~3.6 MB for ten minutes) |

### Session and sources

`product_imports` is the session; `product_import_sources` holds one row per source (see
`docs/data-model.md`). Migration `20260912230000_product_import_sources` backfilled every
existing import with the source it already had, so every existing detail link and every
single-link import reads as before.

Creation is one call to `create_import_session`, a security-invoker function that inserts the
product, the session, the link and text sources, and attaches the files and recordings staged
beforehand — or none of it. A submission id minted when the composer opens makes a double click
one session. A link already being imported opens that import; if other sources came with it,
the composer refuses with a link to the existing import instead of silently dropping them.

### Background jobs

- `transcribe_import_source { sourceId }` — before the session exists; claims `transcribing`.
- `import_source { importId }` — advance: queue a read per pending source, or compose.
- `import_source { importId, sourceId }` — read one source (claim `pending → reading`), then try
  to compose.

Composition runs once every live source is terminal. It composes from the sources that read,
names the ones that did not, and fails the session only when none read — with the one source's
own reason when there was one source. The session's `content_hash` is the hash of the readable
sources' hashes in order: equal hashes and an existing draft mean no model call. Every step
claims by compare-and-swap, so redelivery and a racing retry do their work once.

### Provenance and conflicts

Each source keeps its own evidence, so the prompt renders every source under its own numbered
heading, and the review screen lists each source with its type and status. Before composing,
`lib/imports/conflicts.ts` reads four factual kinds from every source — price, dimensions,
file formats, licence terms — and any kind two sources state differently is a conflict: listed
in the prompt as a disagreement, withheld from the draft by the claims check whichever source
it matches, and shown on the review screen as "Your sources disagree" for the creator to settle.
The claims allow-list is the union of what every readable source said. Nothing reaches
`products` without a save.

### Storage and retention

Staged and attached source objects live under `<workspace_id>/import-sources/`, private, stored
as opaque bytes, never offered to buyers. Removing a pill removes its object; discarding an
import removes every source object. See `docs/security.md`, "Import sources and recordings".

### Transcription

`lib/ai/transcription` is a provider abstraction. The one adapter is **Cloudflare Workers AI,
Whisper large-v3-turbo** (`lib/ai/transcription/providers/cloudflare`), chosen by the founder on
12 September 2026 for its recurring free allowance: 10,000 Neurons a day, about 214 audio
minutes, then $0.0005 per minute. It is selected when `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_AI_API_TOKEN` are both set — on the Trigger.dev worker, where the job runs, and on
Vercel, where the composer checks that transcription is configured. The request carries the
base64 audio and nothing else; the response is validated with Zod; 401/403 map to
`not_configured`, 400/413/422 to unreadable audio, 429/5xx and network failures to
`provider_unavailable`. Cloudflare's Workers AI data-usage terms say customer content is not used
for training and is not stored unless a storage product is used.

Without both variables a recording is refused as `transcription_unavailable`, and the composer
says so. The
e2e suite enables a fixed transcript with `FANWISE_E2E_FAKE_TRANSCRIPTION=1`, which is refused
against any non-local database. The microphone is allowed for this origin only
(`Permissions-Policy: microphone=(self)`).

### Known limitations

- The Cloudflare adapter is tested against a scripted response only; the first real recording
  on a configured deployment is its live check. Cloudflare's per-request audio size limit is
  not documented, which is why recordings are captured at 48 kbps and capped at 10 MB.
- No OCR, no images from PDFs, and no clean-up job for staged sources abandoned in a closed tab.
- Conflicts are detected for four fact kinds with narrow patterns; others fall to the claims
  check and the creator's review.
- A handed-over source cannot be replaced from the review screen; a failed one can be retried.
- Composition picks the first readable source, in the creator's order, as the preview and the
  observed title.

