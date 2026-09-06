# Testing

## Layers

**Unit** — product schemas, readiness, channel requirements, listing transformations, AI
structured output, the factuality validator, entitlements, error normalization, idempotency
keys, revenue aggregation.

**Database** — RLS, tenancy, membership, cascades, external ID uniqueness, transaction
deduplication, snapshot immutability. `pnpm test:db`, against a live local Supabase
(`supabase start`). See `docs/security.md` for the denial shape each verb produces; asserting
the wrong one is how this suite passes while proving nothing.

**Integration** — mocked Shopify, Etsy, Anthropic and Stripe. OAuth token handling, product
creation, upload, publish, retry, transaction ingestion, AI failure.

**E2E** — the ten journeys below, plus two step exit tests against the mock channels rather
than against the ten:

- `journey-03-channels.spec.ts` (A3): one product, two independent listings, and no publish
  affordance anywhere on the assisted channel.
- `journey-04-listing-editor.spec.ts` (A4): a person hand-writes a listing per channel and
  watches deterministic readiness resolve, with no AI involved.

**A note on `waitForURL`.** `/products/[^/]+$` also matches `/products/new`, so waiting on
that pattern resolves instantly against the form just submitted and races the redirect. It
passes most of the time, which is worse than failing. Exclude the trailing segment
explicitly.

## The ten journeys

1. Signup, workspace, product. *(complete at A2)*
2. Product to AI Shopify listing, approved.
3. Connect Shopify, publish.
4. Connect Etsy, publish.
5. Publish to Shopify and Etsy in one action.
6. Publication failure, correction, retry, no duplicate.
7. Generate a Creative Market submission package.
8. Analytics shows an ingested sale.
9. **Workspace A attempts Workspace B access, denied.** *(covered at A1, in the browser at
   `tests/e2e/journey-09-tenancy.spec.ts` and at the database in `tests/db/tenancy.test.ts`;
   extended to the A3 tables in `tests/db/channel-tenancy.test.ts`)*
10. Trial to subscription.

Journey 9 is never skipped, never quarantined, never marked flaky. If it fails, the product
is broken in the way that matters most.

**Password recovery is not one of the ten**, because it is not a step on the path from empty
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
