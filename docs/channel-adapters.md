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
| Shopify | api | yes | yes | yes | **no**, see note | yes |
| Etsy | api | yes | yes | yes | yes, 5 files at 20 MB | yes |
| Creative Market | assisted | no | no | no | no | no |
| Adobe Stock | assisted | no | no | no | no | no |
| MyFonts | assisted | no | no | no | no | no |
| Gumroad | assisted | no | no | yes | no | no |
| Envato | assisted | no | no | yes | no | no |

**Shopify note, resolved at A5.** The Admin API creates products but has no API for
attaching a buyer-downloadable file, and Shopify's own Digital Downloads app exposes none.
Re-verified 4 September 2026: still true. `docs/decisions/0001` takes the assisted file step,
so Shopify ships with `digitalFileUpload: false` and one manual step. The full spec is
`docs/channels/shopify.md`.

## Manual steps

A channel may be able to publish and still be unable to do one necessary thing. Shopify is
the worked example: it creates the product but cannot receive the file the buyer downloads.

```ts
interface ManualStepSpec {
  key: string
  label: string
  description: string
  instructions: readonly string[]
  required: boolean
  gatesActivation: boolean
  needsDeliverable: boolean
}
```

Declared in the adapter, like capabilities and for the same reason. The database row records
only which step, on which listing, and whether a human has done it. A row that also carried
`required` would be a requirement somebody could edit away.

**`gatesActivation` is the honest version of "not finished yet".** An adapter that declares
it creates the provider object in a draft state and implements `activate`, which runs once
every gating step is complete. Nothing can be bought before the step is done, rather than
being buyable and labelled carefully. A unit test refuses a `gatesActivation` step on an
adapter with no `activate`, and refuses a channel that publishes, cannot upload the
deliverable, and asks nobody to.

**Fully published is derived, never stored:** published, with an external id, and no required
step incomplete. Computed on read in `lib/publishing/manual-steps.ts`. A stored copy could
disagree with the rows, and the disagreement would be invisible.

The five words a listing may be described by are `unpublished`, `publishing`,
`published_not_live`, `live` and `failed`. None of them can be read as "for sale" unless it
is.

## Authorization

An adapter that Fanwise can authorize against declares an `oauth` member. Its absence is what
the UI reads to decide whether Connect starts an authorization or simply writes a row, so a
channel with no `oauth` is one Fanwise cannot connect to yet rather than one it pretends to.

```ts
interface ChannelOAuth {
  accountHintLabel: string
  accountHintPlaceholder: string
  parseAccountHint(raw): { ok: true; value: string } | { ok: false; message: string }
  authorizeUrl(request): string
  verifyCallback(query): boolean
  exchange(params): Promise<OAuthGrant>
}
```

`parseAccountHint` is not a formatting convenience. The value becomes a hostname Fanwise
redirects a person to and then posts a client secret to, so it is validated against a fixed
pattern before it reaches a URL.

The callback route is generic in the channel key
(`app/api/channels/[channelKey]/oauth/callback`). A route named after a marketplace would put
a provider name in the application tree, and the next channel would copy the file rather than
reuse it.

## Errors

`lib/channels/errors.ts` holds the shared vocabulary; each adapter owns the mapping into it,
because only the adapter knows what a given status means on that platform. Nothing
provider-shaped reaches a creator: the normalized message is shown, the raw response is
persisted on the `publication_jobs` row, and the two never swap places.

`retryable` is the field that earns its keep. Publishing runs in a background job, and a job
that cannot tell "the shop is briefly down" from "you asked for a scope you were not granted"
either retries forever or gives up on something that would have worked.

## Requirements

Defined at A3 in `lib/channels/types.ts`, evaluated by `lib/channels/requirements.ts`.

**Requirements are data, not code.** An earlier sketch gave every requirement its own
`validate()` function, which cannot satisfy rule 3 below: a spec carrying a function is code
by construction, and adding a channel would mean writing validation rather than writing
configuration. A single evaluator walks declarative specs instead.

```ts
type RequirementSpec =
  | { kind: "text";   field: ListingTextField;   minLength?: number; maxLength?: number }
  | { kind: "number"; field: ListingNumberField; min?: number; max?: number }
  | { kind: "tags";   minCount?: number; maxCount?: number; maxTagLength?: number }
  | { kind: "enum";   field: ListingTextField; allowed: readonly string[] }
  | { kind: "asset";  assetTypes: readonly AssetType[]; minCount: number }
  | { kind: "custom"; evaluate(draft, subject): { satisfied: boolean; message?: string } }
```

Each carries `key`, `label`, an optional `description`, and a `severity` of `error`,
`warning` or `info`. `custom` is the escape hatch for a genuinely odd rule, not the default
shape.

There is no separate `required` boolean. `severity: "error"` is what required means, because
two fields that must agree are two fields that can disagree.

```ts
interface RequirementResult {
  key: string
  label: string
  description?: string
  severity: "error" | "warning" | "info"
  satisfied: boolean
  message?: string
}
```

Deterministic and synchronous: no model, no network, no clock. The same product and draft
always produce the same result, which is the only reason a readiness number is worth showing.

**An `asset` rule counts only `ready` assets.** A pending row is a promise the finalize job
has not kept, and publishing against one ships a listing whose file may turn out to be
missing.

## Readiness

Errors resolved over errors total. Warnings are counted, displayed separately, and never
block. Two consequences, both easy to get wrong later:

- A channel with no error-severity rules is ready. The score is 1, not 0 and not `NaN`.
- `ready` is exactly "no unsatisfied errors". It is never the score crossing a threshold,
  because a threshold invites the idea that 90% ready is publishable, and it is not.

Readiness is computed on read, from the stored listing, never persisted. Requirements change
when an adapter changes, and a stored score would go stale silently: the listing would keep
claiming it was publishable under rules that no longer exist.

Since A4 a creator can hand-edit a listing, so readiness is judged on what is **stored**, not
on what the adapter would rebuild. Judging the rebuild would tell someone their edits were
fine when the thing that would actually be submitted is not.

## Constraints, for the editor

`lib/channels/constraints.ts` derives field limits from the same specs the evaluator walks,
so the editor's character counters and the rules that block publication cannot disagree. A
counter that contradicts the blocking rule is worse than no counter: it teaches a limit that
is not the real one.

Where a channel declares more than one rule for a field, the **strictest** bound wins. A
title passing a 120 character rule and failing an 80 character rule is a rejected title, and
the counter should show the first wall the creator will hit. Asset and custom rules yield no
constraint, because neither describes a limit the editor could render; both still block
through the evaluator.

## Saving versus publishing

The editor saves whatever the creator typed, including copy the channel would reject. This
is deliberate. Readiness is how they find out what is wrong, so refusing the save would put
the answer behind the fix. `lib/channels/schemas.ts` therefore bounds what is *storable*,
not what is *publishable*, and the requirement engine remains the only thing that decides
the second.

## Adding a channel

1. Write `docs/channels/<key>.md` first, with the field-level spec. `creative-market.md` is
   the worked example.
2. Declare capabilities honestly. Absent methods are how honesty is enforced, and unit tests
   check it in both directions: a declared capability must have its method, and an
   implemented method must be declared. An assisted adapter may never declare
   `automaticPublish` or `automaticUpdate`.
   Declare a capability false when the feature exists but the step that uses it has not
   arrived. `metrics` and `transactions` are false on both A3 mocks for exactly this reason,
   and false on Shopify too, which is a real channel that genuinely has both.
   **Two different reasons produce the same `false`, and the difference matters.** Shopify's
   `digitalFileUpload` is false because Shopify cannot; its `metrics` is false because
   Fanwise has not. Only the first is permanent, and only the first is a fact about the
   provider. Say which one it is in a comment.
3. Express the submission spec as data, not code, so a new assisted channel is a config file
   rather than a feature.
4. Requirements before transformations. Knowing what would be rejected is more valuable than
   generating something that will be.
5. Never add a provider string outside the adapter folder. A unit test reads the whole tree
   for it, case-insensitively: a provider name does not stop being one because it was written
   `SHOPIFY_CLIENT_ID` in an env schema or "Shopify" in a comment. This is why an adapter
   parses its own credentials rather than adding fields to `lib/env.ts`.

## Assisted channels

No `publish`. Status moves draft, ready, then published by human action with
`status_source = "self_reported"`. Nothing that implies verification may treat those rows as
equal to verified ones.
