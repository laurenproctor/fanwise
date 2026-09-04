# Architecture

## The one rule

```
CANONICAL PRODUCT  ->  CHANNEL ADAPTER  ->  LISTING
```

Never the reverse. The Fanwise product record is authoritative. A marketplace is a
destination that receives a translation of it, and no marketplace gets to shape the record.

The failure mode this prevents is concrete: the first time someone adds `etsy_tags` or
`shopify_handle` to `products`, the model starts drifting toward whichever marketplace
shouted loudest, and every channel added afterwards makes the schema worse.

```
                        FANWISE PRODUCT
                              |
        +---------------------+---------------------+
        |                     |                     |
   PRODUCT DATA            ASSETS              LICENSING
        |                     |                     |
        +---------------------+---------------------+
                              |
                        MERCHANDISING
                              |
                       CHANNEL ADAPTERS
                              |
     +------------+-----------+-----------+------------+
     |            |           |           |            |
  Shopify       Etsy    Creative Mkt   Adobe Stock   future
     |            |           |           |
    API          API      assisted     assisted
```

## Layers

| Layer | Owns | Must not know about |
|---|---|---|
| `lib/products` | The canonical record, product types, assets, derivatives | Any channel |
| `lib/channels` | Adapter contract, registry, capabilities, requirements | Any specific provider, outside its own adapter folder |
| `lib/channels/adapters/<key>` | One provider's translation, auth and calls | Other providers |
| `lib/ai` | Provider abstraction, FactSheet, prompts, validators | Which model vendor is configured, in business logic |
| `lib/publishing` | Orchestration, jobs, idempotency, snapshots | Provider specifics |
| `lib/entitlements` | What a workspace may do | Plan name strings scattered elsewhere |

## Adapter contract

Defined in full at step A3. Shape:

```ts
interface ChannelAdapter {
  key: ChannelKey
  integrationType: "api" | "assisted"
  capabilities: ChannelCapabilities
  getRequirements(product: CanonicalProduct): Promise<ChannelRequirement[]>
  validateProduct(product: CanonicalProduct): Promise<ValidationResult>
  buildListing(product: CanonicalProduct, options?: BuildOptions): Promise<ChannelListingDraft>
  publish?(listing: ChannelListing): Promise<PublishResult>
  update?(listing: ChannelListing): Promise<PublishResult>
  unpublish?(listing: ChannelListing): Promise<void>
  sync?(listing: ChannelListing): Promise<SyncResult>
  fetchMetrics?(listing: ChannelListing, range: DateRange): Promise<ChannelMetrics>
  fetchTransactions?(c: ChannelConnection, cursor?: string): Promise<TransactionBatch>
}
```

The optional methods are the point. An assisted channel does not implement `publish`, and
because `capabilities.automaticPublish` is false the UI never offers it. Capability lying is
how tools in this space lose trust.

## Readiness is deterministic

Two separate ideas, never merged:

- **Product readiness**: does the canonical record hold enough to be useful?
- **Channel readiness**: can this product be published to this destination?

Both are computed from rules, never from a model. A readiness score a model invented is a
number nobody can act on.

## Idempotency

Every external write carries a key that is persisted before the call, in the same
transaction as the job row. Before creating anything remotely, check in order: an existing
`external_listing_id`, an existing successful publication job, then the key. Record the
provider object ID the moment it is known, so a retry continues rather than duplicates.

Clicking Publish twice must never create two listings. This gets explicit tests.

## Snapshots

Every publication writes an immutable `listing_snapshots` row. They are never updated or
deleted. They cost almost nothing now and they are the only way to answer "what changed
before revenue moved" later.

## Jobs

`lib/jobs` exposes a `JobQueue` interface with an in-process implementation. Trigger.dev
replaces the implementation at step B1. Nothing outside `lib/jobs/index.ts` knows which
implementation is in use.
