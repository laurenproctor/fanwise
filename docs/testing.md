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

**E2E** — the ten journeys below.

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
   `tests/e2e/journey-09-tenancy.spec.ts` and at the database in `tests/db/tenancy.test.ts`)*
10. Trial to subscription.

Journey 9 is never skipped, never quarantined, never marked flaky. If it fails, the product
is broken in the way that matters most.

## Rules

A failing test is fixed or reported, never disabled. A test that is hard to write usually
means the design is wrong, so treat that friction as information rather than an obstacle.
