# Channel adapters

The adapter is the only place a provider name may appear. Everything else in the codebase
talks to the contract.

## Capability matrix

Declared per adapter. The UI reads capabilities and never offers an action the provider
cannot perform.

```ts
interface ChannelCapabilities {
  automaticPublish: boolean
  automaticUpdate: boolean
  metrics: boolean
  transactions: boolean
  digitalFileUpload: boolean
  imageUpload: boolean
  drafts: boolean
}
```

Current reality, from `docs/channel-feasibility.md`:

| Channel | Type | Publish | Update | Transactions | File upload | Image upload |
|---|---|---|---|---|---|---|
| Shopify | api | yes | yes | yes | see note | yes |
| Etsy | api | yes | yes | yes | yes, 5 files at 20 MB | yes |
| Creative Market | assisted | no | no | no | no | no |
| Adobe Stock | assisted | no | no | no | no | no |
| MyFonts | assisted | no | no | no | no | no |
| Gumroad | assisted | no | no | yes | no | no |
| Envato | assisted | no | no | yes | no | no |

**Shopify note:** the Admin API creates products but has no API for attaching a
buyer-downloadable file, and Shopify's own Digital Downloads app exposes none. Resolve
before step A5. Options: Fanwise hosts delivery, a third-party app with an API, or an
assisted file step.

## Requirements

```ts
interface ChannelRequirement {
  key: string
  label: string
  description?: string
  required: boolean
  validate(product: CanonicalProduct, listing?: ChannelListing): RequirementResult
}

interface RequirementResult {
  satisfied: boolean
  severity: "error" | "warning" | "info"
  message?: string
}
```

Deterministic. Readiness is errors resolved over errors total, and no model touches it.

## Adding a channel

1. Write `docs/channels/<key>.md` first, with the field-level spec. `creative-market.md` is
   the worked example.
2. Declare capabilities honestly. Absent methods are how honesty is enforced.
3. Express the submission spec as data, not code, so a new assisted channel is a config file
   rather than a feature.
4. Requirements before transformations. Knowing what would be rejected is more valuable than
   generating something that will be.
5. Never add a provider string outside the adapter folder.

## Assisted channels

No `publish`. Status moves draft, ready, then published by human action with
`status_source = "self_reported"`. Nothing that implies verification may treat those rows as
equal to verified ones.
