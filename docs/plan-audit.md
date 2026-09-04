# Fanwise: plan audit and Claude Code execution plan

Audit of the 110-section master plan, plus the revised build sequence to hand to Claude Code.
Written September 2026.

---

## 1. Verdict

The strategy is sound and the architecture is right. The doctrine that matters most, canonical product as source of truth with marketplaces behind adapters, is correct and is the thing most competitors get wrong. Sections 9, 25, 26, 28, 37 and 93 are the spine of the product and should not be negotiated away under schedule pressure.

The plan's real problem is not what it says, it is what it is. 110 sections of strategy, data model, roadmap and engineering rules in one document is a thinking artifact, not an execution artifact. Claude Code will read it, agree with all of it, and then quietly build toward the wrong horizon, because the document gives V3 intelligence the same visual weight as Phase 0 CI setup. Split it before writing any code.

Beyond that, there are nine specific problems worth fixing before Phase 0.

---

## 2. What the plan gets right

Worth stating so these do not get refactored away later.

- Canonical product as the authority, adapters at the edge. This is the whole company. Section 13's rule (the canonical product cannot become Shopify-shaped) is the single most valuable line in the document.
- The explicit split between API channels and assisted channels, with a capability matrix so the UI never offers what a provider cannot do. Most tools in this space lie about this and then break.
- Idempotency treated as non-negotiable at section 37. Publishing is the one place where a bug costs the user real money and real embarrassment.
- The AI factuality rules at section 28. Fabricated glyph counts on a live Etsy listing is a product-ending bug, not a quality issue.
- Immutable publication snapshots. This is what later makes change attribution possible, and it costs almost nothing to add now versus reconstructing history later.
- Refusing browser automation in V1. Correct, both for reliability and for terms of service.
- The V1 exclusion list at section 68. Keep it visible; it is the most useful page in the plan.

---

## 3. Nine problems to fix before Phase 0

### 3.1 The V1 channel pair does not match the pricing model or the wedge

The plan makes Shopify and Etsy the two V1 integrations. The pricing model charges $9 base plus $6 per connected external marketplace, with one owned storefront included. Shopify is the owned storefront, so it is free. That means at first-run scope, the only billable channel is Etsy, and a fully activated V1 customer pays $15 a month.

This is not fatal, but it changes what V1 has to prove. Two options:

- **Keep Shopify + Etsy** and accept that V1 is a validation build, not a revenue build. Fine if the goal is learning.
- **Ship Shopify + Etsy + one assisted marketplace with a real package output** (Creative Market) so a realistic first customer connects two billable things and pays $21.

Recommend the second. It also proves the abstraction across both integration types, which is milestone 99 anyway, and it moves that milestone earlier for very little extra work since the assisted path has no OAuth or publishing surface.

### 3.2 Shopify cannot deliver digital files through the API you are planning to use

This is the most serious technical gap in the plan. The Admin API creates products, but Shopify does not natively deliver digital downloads. Delivery requires an app, and Shopify's own free Digital Products app does not expose an API for attaching files programmatically. So "publish a digital product to Shopify" is, today, product creation via API plus a manual file attachment step in the Shopify admin.

Three ways out, in order of preference:

1. **Fanwise hosts delivery.** The product on Shopify points at a Fanwise-generated download link with tokenized, expiring access. This is more work but it makes Fanwise the delivery system of record, which strengthens the canonical-catalog thesis and gives you download analytics no marketplace will hand over.
2. **Integrate a third-party delivery app that has an API** (Fileflare, Easy Digital Products, and similar). Faster, but adds a dependency the customer must also install and pay for.
3. **Mark Shopify file attachment as an assisted step** in an otherwise automatic channel. Honest, cheap, and slightly disappointing.

Whichever you choose, decide before Phase 5, because option 1 changes the asset and storage design. Do not discover this during the Shopify sprint.

**Verify current behavior before building.** Shopify ships changes here regularly.

### 3.3 Etsy API access is on the critical path and is not in Phase 0

Etsy Open API v3 requires app registration and issues a key; write operations to a seller's shop need OAuth with `listings_w`. Approval and rate limits are the schedule risk, not the code. If the key request sits in a queue for three weeks and it was not filed until Phase 6, three weeks of the roadmap evaporate.

**Fix:** file the Etsy app registration and the Shopify partner account in Phase 0, day one, before any feature work. Track them as blocking external dependencies with dates. Same for anything else with a human approver.

### 3.4 The image derivative pipeline is missing, and it is the actual product

The entire promise, one product becoming six correctly shaped listings, rests on generating per-channel image derivatives: crops, aspect ratios, minimum dimensions, file size ceilings, format conversion. The plan mentions assets, storage, and checksums but never specifies the transformation layer.

**Fix:** add it to the channel adapter contract as a first-class concern. Each adapter declares its image specs; a shared derivative service (sharp, run in a background job) produces and caches them keyed by source checksum plus spec hash. Store derivatives as their own asset rows with a `derived_from` pointer. This belongs in Phase 2 or 3, not Phase 5.

Getting this right is also a quality moat. Naive center-cropping a font specimen to 4:3 produces a bad listing image, and bad listing images are the thing creators will actually judge you on.

### 3.5 The billing model in section 58 contradicts the current pricing

Section 58 specifies Starter $29 / Pro $79 / Studio $199. The current model is $9 base plus $6 per connected marketplace, one owned storefront included, with an annual option at ten months for twelve.

This is not a copy change, it is an architecture change. Tiered pricing is a plan enum and a feature gate. Channel-based pricing is a Stripe subscription with a base price plus a quantity-adjusted line item that changes every time a user connects or disconnects a channel. That means:

- Connecting a channel is a billing event, transactionally coupled to `channel_connections`.
- Disconnecting must handle proration policy explicitly (the FAQ promises the charge goes away at the next billing period, so: no mid-cycle refund, quantity decrements at period end).
- The entitlement service gates on *connected channel count and type*, not on a plan name.
- Someone can connect, disconnect and reconnect to game the boundary; decide the policy now.

**Fix:** rewrite section 58, and specify the Stripe object model in `docs/billing.md` before Phase 11. Note that this model makes billing harder than tiers, not easier, even though it is simpler for the customer.

### 3.6 AI factuality needs a mechanism, not a rule

Section 28 says the right thing but leaves enforcement to prompt discipline, which will fail eventually. It needs an engineering contract.

**Fix:** introduce a typed `FactSheet`, derived deterministically from canonical product data and product-type metadata. Then:

- The generation prompt receives the FactSheet as the only source of factual claims, clearly delimited from merchandising instruction.
- Output is validated with Zod for shape.
- A second, deterministic pass extracts every number, format name, compatibility claim and file count from the generated text and checks each against the FactSheet. Anything unsupported fails the generation and is surfaced to the user as "the model claimed something not in your product data," rather than being silently published.
- Log the FactSheet hash on `ai_generations` so a bad listing can be traced to the inputs that produced it.

This check is maybe 200 lines and it is the difference between a trustworthy product and a liability.

### 3.7 Assisted channels have no verification loop

The user marks a Creative Market submission as submitted and pastes a URL. Nothing verifies it. Listing status for assisted channels is therefore self-reported, and analytics for those channels is CSV-only. That is acceptable, but the plan should say so plainly in the data model rather than letting `status: published` mean two different things depending on channel.

**Fix:** add `status_source` to `channel_listings` with values `verified` and `self_reported`. Show it in the UI. Never mix self-reported listings into metrics that imply verification.

### 3.8 Trigger.dev is a premature dependency

Nothing before Phase 5 needs background jobs. Adding a fourth vendor in Phase 0 means environment config, local dev complexity, and CI setup for infrastructure that sits idle for six phases.

**Fix:** design the job interface in Phase 0 (a thin `enqueue(job, payload)` abstraction), implement it with a simple database-backed queue or direct invocation, and adopt Trigger.dev in Phase 5 when publishing actually needs retries and backoff. The abstraction means the swap is contained.

Counter-argument worth weighing: adopting it late means the first real job is also the first use of an unfamiliar tool, during the highest-stakes phase. If that worries you, adopt it in Phase 4 with the AI generation jobs, which is a lower-stakes first use.

### 3.9 Fourteen phases before external alpha is too many

Milestone 98, one product to Shopify and Etsy, is the correct forcing function, and it currently sits behind seven phases including a full AI merchandising system. If anything slips, alpha moves a quarter.

**Fix:** restructure around three hard gates rather than fourteen soft phases. Detail in section 4. The key move is to allow a manual listing path to exist before the AI path, so publishing can be proven end to end while merchandising is still being built. Publishing correctness and AI quality are independent risks and should be de-risked in parallel, not in series.

---

## 4. Revised build sequence

Three gates. Nothing after a gate begins until the gate passes.

### Gate A: the loop closes

*Target: one real product, published to two channels, by a real person who is not you.*

| Step | Content | Exit test |
|---|---|---|
| A0 | Repo, CI, Supabase, env validation, job abstraction, Sentry. **File Etsy and Shopify app registrations.** | `main` deploys; migrations apply clean; both app registrations submitted with dates recorded |
| A1 | Auth, workspaces, membership, RLS | Workspace A cannot read any Workspace B row, proven by test, for every table |
| A2 | Canonical product, product types, assets, storage, checksums, **image derivative service** | A complete product exists with correct derivatives for two image specs, no channel connected |
| A3 | Channel registry, connections, listings, adapter contract, capability matrix, requirements engine, two mock adapters | One product yields two independent mock listings; no marketplace string appears in the product domain |
| A4 | Manual listing editor (no AI), readiness UI | A user can hand-write a listing per channel and see deterministic readiness |
| A5 | Shopify: OAuth, adapter, publish, idempotency, error normalization, **digital delivery decision implemented** | Real product publishes; second click creates nothing; file is actually deliverable to a buyer |
| A6 | Etsy: OAuth, adapter, draft, images, digital file, activate, idempotency | Real product publishes and is purchasable |
| A7 | Publish Everywhere orchestration, job queue, progress, retry, activity log | One action, two live URLs, one failure path recovered without duplicates |

**Gate A passes when:** an outside creator, unassisted, takes one of their real products from empty workspace to two live listings, and the listings are good enough that they leave them up.

That last clause is the real test. If they publish and then immediately rewrite everything in the marketplace UI, the product does not work yet.

### Gate B: the abstraction holds and the money comes back

| Step | Content | Exit test |
|---|---|---|
| B1 | AI provider abstraction, Anthropic, FactSheet, per-channel merchandising profiles, structured output, factuality validator, generation logs | Four channels get meaningfully distinct copy; the validator catches a deliberately planted false claim |
| B2 | Listing review UI: field edit, field regenerate, full regenerate, restore, approve | No first generation can reach a marketplace without explicit approval |
| B3 | Creative Market assisted: package build, copy actions, mark submitted, URL capture, `status_source` | Submitting by hand requires no composition outside Fanwise |
| B4 | Framer assisted | Same |
| B5 | `sales_events`, transaction ingestion for Shopify and Etsy, dedupe constraints | A real sale appears in Fanwise within the sync window, exactly once |
| B6 | Analytics overview: revenue, units, by channel, by product, date filters | Cross-channel revenue for one product is correct against marketplace dashboards |
| B7 | CSV import foundation | A Creative Market export becomes attributed sales events |

**Gate B passes when:** milestone 99 and 100 both hold. One product becomes four channel-ready outputs, and revenue from at least two channels flows back into a single product view.

### Gate C: a stranger can pay

| Step | Content | Exit test |
|---|---|---|
| C1 | Stripe: base subscription, per-channel quantity line, connect/disconnect billing events, proration policy, trial, portal | Connecting a third marketplace changes the invoice correctly, and disconnecting decrements at period end |
| C2 | Entitlement service, centralized, gating on channel count and type | No plan checks in components; free-tier limits enforced server-side |
| C3 | Onboarding, empty states, activation instrumentation | Median signup to first publish under 30 minutes for alpha users |
| C4 | Hardening: auth, RLS, tokens, secrets, storage, rate limits, webhooks, accessibility, responsive, full E2E | Full suite green; security checklist signed off |

**Gate C passes when:** someone you have never met subscribes, connects channels, publishes, and you learn about it from a Stripe email.

---

## 5. Cut from V1

In addition to the section 68 list, cut these, which the plan currently keeps:

- **Product versions table.** Keep publication snapshots (immutable, cheap, load-bearing). Defer `product_versions` until a user asks for a v2 release workflow. Section 17 already hedges on this; make it a decision.
- **The `viewer` and `editor` roles.** Ship owner only. The data model supports more; the UI should not until Studio exists.
- **Framer assisted channel.** Framer's marketplace is a curated manual review with low submission volume per creator. Creative Market alone proves the assisted pattern. Add Framer when a user asks.
- **Metric snapshots table.** Sales events give you revenue truth. Views and favorites are Gate B-plus. Building the snapshot table early invites building the ingestion for it early.
- **Multi-currency.** Store currency, support one per workspace, defer conversion entirely.

---

## 6. Decisions needed from you before Phase 0

1. **Shopify digital delivery:** Fanwise-hosted, third-party app, or assisted step? This blocks asset architecture.
2. **Third V1 channel:** does Creative Market assisted ship inside Gate A to make the pricing model real, or wait for Gate B?
3. **Reconnect gaming:** what stops connect/disconnect cycling around billing boundaries? Simplest answer: a channel connection bills for a minimum of one full period.
4. **Storage ceiling:** "unlimited catalog subject to fair use" needs a number in the code even if it is not on the pricing page. Suggest 25 GB per workspace at $9, revisited with data.
5. **Who owns the buyer relationship on Shopify?** If Fanwise hosts delivery, Fanwise sees buyer emails. That has privacy and positioning consequences worth deciding deliberately.

---

## 7. Running this with Claude Code

### Document split

Replace the single master plan with four files. The master plan becomes `docs/strategy.md`, read by humans, never loaded into a coding session.

- `CLAUDE.md`: rules, architecture invariants, commands, current phase. Under 200 lines. Provided separately.
- `docs/architecture.md`: canonical product and adapter contract, with the interfaces from sections 23 to 26.
- `docs/roadmap.md`: the three gates above, with a single line at the top saying which step is current.
- `docs/strategy.md`: the full master plan, marked clearly as vision and not as a work queue.

### Session protocol

One step per session, one branch per step, one PR per step. At session start, tell Claude Code which step it is on and forbid the rest:

> You are implementing step A2 only. Do not implement A3 or later, and do not add AI, billing or analytics code. Read CLAUDE.md and docs/architecture.md first. Produce a short implementation plan, wait for approval, then implement. Report using the phase completion protocol.

The plan's section 107 and 108 reporting protocols are good. Keep them verbatim.

### The rule that matters most

Section 93 item 2: never disable a failing test to make CI green. Add an explicit corollary for this project, since it is the failure mode most likely to appear under schedule pressure: **never relax an RLS policy, an idempotency check, or a factuality validator to unblock a feature.** Those three are the product. Everything else is negotiable.

### Suggested first message to Claude Code

Give it section 107 as written, with one addition: instruct it to open the Etsy and Shopify developer applications as its first action and record the submission dates in `docs/roadmap.md`, before touching any code.

---

## 8. Risks the plan understates

- **Marketplace supply shock.** Section 102 notes generative AI increasing asset supply. The sharper version: if marketplace listings become cheap to produce, marketplaces respond by tightening curation and raising submission friction, which is good for Fanwise (more per-listing work to absorb) and bad for its customers (fewer of them make a living). Watch whether your ICP is growing or shrinking.
- **The assisted-channel ceiling.** Assisted channels give Fanwise no publishing telemetry and no analytics. If most channels a creator cares about stay assisted, Fanwise is a very good package builder, which is a smaller company than the plan describes. The API-channel roadmap is therefore the strategic roadmap. Track which channels have real APIs and treat winning those partnerships as a business development task, not an engineering task.
- **Concentration on Etsy.** If Etsy is the only billable channel at launch, an Etsy API policy change is an extinction event, not a mitigation exercise. This argues for Gate A including a third channel.

---

## 9. One-paragraph summary for the top of the repo

Fanwise is a canonical digital-product operating system. Creators maintain one authoritative product record, and Fanwise translates it into channel-specific listings through adapters. Marketplaces are destinations, never architectural authorities. Publishing is the initial wedge, catalog ownership is the business, and cross-channel intelligence is the eventual company. Build in that order, and do not let the third one leak into the first.
