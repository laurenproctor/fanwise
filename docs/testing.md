# Testing

## Layers

**Unit** — product schemas, readiness, channel requirements, listing transformations, AI
structured output, the factuality validator, entitlements, error normalization, idempotency
keys, revenue aggregation.

**Database** — RLS, tenancy, membership, cascades, external ID uniqueness, transaction
deduplication, snapshot immutability. `pnpm test:db`, against a live local Supabase
(`supabase start`). See `docs/security.md` for the denial shape each verb produces; asserting
the wrong one is how this suite passes while proving nothing.

**Integration** — mocked Shopify, Etsy, WooCommerce, Anthropic and Stripe. OAuth token
handling, the posted grant, product creation, upload, publish, retry, transaction ingestion,
AI failure.

**E2E** — the fifteen journeys below, plus two step exit tests against the mock channels
rather than against the fifteen:

- `journey-03-channels.spec.ts` (A3): one product, two independent listings, and no publish
  affordance anywhere on the assisted channel.
- `journey-04-listing-editor.spec.ts` (A4): a person hand-writes a listing per channel and
  watches deterministic readiness resolve, with no AI involved.
- `journey-05-publish.spec.ts` (A5): a product publishes, and clicking Publish again creates
  nothing. Run against the mock API channel, because the e2e suite has no live Shopify
  connection; A5's exit ran by hand against the live store, see `docs/roadmap.md`.
- `journey-05-publish-everywhere.spec.ts` (A7): one click starts every channel that can take
  the product, names each channel it skipped and why, and a second run sends nothing again.
  The activity log is asserted after a reload, because a run is a record rather than a
  screen. The exit's "two live URLs" needs two live channels and is a run a person does by
  hand; the recovery half is proved in `tests/unit/publish-retry.test.ts` and
  `tests/db/publication-idempotency.test.ts`, where a failure can be made to happen on
  demand. Both publish specs share their setup through `tests/e2e/publish-support.ts`.

**B1's validator is proved twice.** `tests/unit/factuality.test.ts` is the vocabulary: every
way a model could state a number, a format, a compatibility or a claim the facts do not
support, and every way a true statement must still pass. `tests/db/ai-generation.test.ts`
runs the whole path against real Postgres with the model replaced by a scripted provider: a
fabricated claim is rejected and the listing is untouched; a supported one lands with a
snapshot and a FactSheet hash. The vendor's request shape is checked in
`tests/unit/ai-provider.test.ts` with a fetch that answers from a script, so the schema, the
effort and the cache marker are asserted without a network. No test calls the model.

**A5's idempotency is proved at the database, not in the browser**, in
`tests/db/publication-idempotency.test.ts`. That suite drives the real job row, the real
unique constraint and the real runner, and checks the three guards from
`docs/architecture.md` one at a time: an existing external id, an existing successful job,
and the key itself. The browser can only show that the button is gone; the database can show
that the operation cannot happen twice even when it is attempted directly.

**A note on uploading a file in a test.** The browser PUTs the bytes straight to storage and
then calls finalize, and the component reloads itself when both return. A test that starts
polling with `page.reload()` before that lands aborts the in-flight PUT: the asset row exists,
because the intent was created, and the bytes never arrive. It sits `pending` with no error
anywhere and looks exactly like a broken finalize job. Wait for the row to appear, then poll.

**A note on locators that count channels.** Every unconnected channel offers a Connect
button, so an unscoped `getByRole("button", { name: "Connect" })` starts failing the moment a
channel is added — which it did when Shopify arrived at A5. Scope to the card.

**A note on `waitForURL`.** A product now lives at `/<workspace>/<product>`, which is the
same shape as `/<workspace>/new`, `/channels` and `/settings`. Waiting on a pattern loose
enough to match a product matches the form just submitted, resolves instantly, and races the
redirect. It passes most of the time, which is worse than failing. Use `productUrl()` from
`tests/e2e/support.ts`, which builds the exclusions from `RESERVED_PRODUCT_SLUGS` so a new
route cannot leave the pattern quietly wrong. The same applies one level up: `/onboarding` is
a single path segment and so is a workspace.

A matching URL is not a rendered page. An App Router transition changes the URL before the
content arrives, so `waitForURL` can return while the loading boundary is still on screen,
and a locator that counts elements then finds none. Follow it with a wait on real content —
the product heading, usually.

## The fifteen journeys

1. Signup, workspace, product. *(complete at A2)*
2. Product to AI Shopify listing, approved. *(composition ran live at B1; the review loop
   with field regenerate and restore is code complete at B2 and proven in
   `tests/db/ai-review.test.ts`; approval is the publish click; unrun in the browser)*
3. Connect Shopify, publish. *(code complete at A5, unverified: needs a live shop)*
4. Connect Etsy, publish. *(ran by hand on 11 September 2026 against the live shop, see
   `docs/roadmap.md`; the OAuth flow and the adapter are covered in
   `tests/unit/etsy-oauth.test.ts` and `tests/unit/etsy-adapter.test.ts`)*
5. Publish to Shopify and Etsy in one action. *(code complete at A7 and proved against the
   mock channels in `tests/e2e/journey-05-publish-everywhere.spec.ts`. The exit needs any two
   live channels, and Shopify and Etsy are both live as of 11 September 2026; WooCommerce,
   once connected, is a third the action includes. Unrun against live channels)*
6. Publication failure, correction, retry, no duplicate.
7. Generate a Creative Market submission package.
8. Analytics shows an ingested sale.
9. **Workspace A attempts Workspace B access, denied.** *(covered at A1, in the browser at
   `tests/e2e/journey-09-tenancy.spec.ts` and at the database in `tests/db/tenancy.test.ts`;
   extended to the A3 tables in `tests/db/channel-tenancy.test.ts`)*
10. Trial to subscription. *(code complete at C1; the settings page shows the trial and the
    two checkouts, and `tests/db/billing.test.ts` proves the ledger, the tenancy and the sync
    job against real Postgres with the provider scripted. Unrun in the browser: it needs a
    provider account in test mode)*
11. Connect WooCommerce, publish a draft, attach the file, activate. *(code complete at B8,
    unverified: needs a live store. The authorization handshake and the adapter are covered
    in `tests/unit/woocommerce-oauth.test.ts` and `tests/unit/woocommerce-adapter.test.ts`)*
12. Generate a Behance project and asset package, hand off, capture the project URL.
    *(planned at B9, not built; waits on A8's handoff machinery and on a profile with Stripe
    connected, decision 26)*
13. Connect Gumroad, publish a product with its covers and its file, confirm it is
    purchasable. *(planned at B10, not built; needs a registered Gumroad OAuth application and
    a seller account, decision 27)*
14. **A creator publishes a public profile and a stranger reads it.** *(built and running in
    `tests/e2e/journey-14-public-pages.spec.ts`, with the permission half at
    `tests/db/public-pages-tenancy.test.ts` and the routing table at
    `tests/unit/public-routing.test.ts`)*
15. Import a live listing, then publish the imported product to a second channel.
    *(planned at B12, not built; opens after Gate A passes, and the listing it imports must
    be one Fanwise did not create, see `docs/listing-import.md`)*

Journey 9 is never skipped, never quarantined, never marked flaky. If it fails, the product
is broken in the way that matters most.

**Journey 11 was added on 8 September 2026**, after the list was written, because
WooCommerce arrived at B8. It is not a copy of journey 3 with a different store. The ten were
written before a channel existed whose provider could confirm the manual step, and that
confirmation is what the journey exists to see: `activate` refusing until the file is on the
product, and a product that goes live only afterwards. The count in `CLAUDE.md` moved with
it.

**Journey 12 was added on 11 September 2026**, when Behance was planned as B9. It is journey
7 with a different shape: a portfolio project composed around the product rather than a
product form filled in, in two modes, new project and existing project. It is the first
assisted journey that reuses A8's machinery rather than building it, which is why it cannot
run before journey 7 does. Nothing in it may write a row that reads as verified.

**Journey 13 was added on 11 September 2026**, when Gumroad was planned as B10. It is
journey 4 with a different upload: the file goes to Gumroad's storage in parts, by presigned
URL, and is then attached to the product, rather than posted to the provider in one request.
The journey exists to see that the attach happened, by reading the product back, before
Fanwise reports it live.

**Journey 14 was added on 12 September 2026**, with the public creator pages. It is the
first journey whose assertions are made with no session at all, and that is the whole point
of it: every other journey signs somebody in first, so a page that renders only for the
person who made it would pass all of them. The anonymous half runs in its own browser
context rather than clearing cookies, because a Server Component reads cookies at render.

It is also the only journey that asserts a status code as a privacy property rather than as
a convenience. A draft profile must answer 404, and the two ways that broke during
development — a proxy rewrite pinning the response at 200, and a route-level `loading.tsx`
committing the response before the page decided — were both invisible to a signed-in
developer and to every other test in this suite.

**Journey 15 was added on 12 September 2026**, when importing a live listing was planned as
B12. It is the only journey that does not begin in Fanwise. Every other path starts with an
upload or a form and ends at a marketplace; this one starts at a marketplace listing the
creator already sells and ends with that product published somewhere else. That is a
fifteenth path rather than a variation, and it is the test this list applies to every
candidate: a second view of a screen that already has a journey does not earn a number, and
a different way into the product does.

The clause that makes it worth running is in `docs/listing-import.md` §15: the listing must
be one Fanwise did not create. A listing Fanwise published, imported back, only proves the
round trip closes. What the mapping has to survive is a stranger's category, a stranger's
tags and a stranger's line breaks. The journey also runs the import twice, because the second
import is a navigation to the product that already exists and not an error.

**Password recovery is not one of the fifteen**, because it is not a step on the path from empty
workspace to live listing. It is covered anyway, in two halves that meet at the token:
`tests/db/password-recovery.test.ts` makes the same calls the confirm route makes, against the
real auth server, and proves the link is single use; `tests/e2e/password-recovery.spec.ts`
covers what a person sees, including that the answer is identical for a registered and an
unregistered address. Neither needs a mail catcher: the db test asks the admin API for the same
token the email would have carried. What that leaves unproven is the email itself, and it is
the only part of the flow no automated test touches.

## Rules

A failing test is fixed or reported, never disabled. A test that is hard to write usually
means the design is wrong, so treat that friction as information rather than an obstacle.
