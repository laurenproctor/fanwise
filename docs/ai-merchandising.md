# AI merchandising

Built at step B1, on 7 September 2026. The rule and the mechanism below were written before
the step; the section "What B1 built" records how they landed.

## The rule

AI may transform positioning, tone, phrasing, structure, marketplace vernacular, SEO and
keywords.

AI may never introduce a factual claim that is not in the FactSheet. Not slide counts, glyph
counts, included applications, compatibility, file counts, licenses, language support, font
formats, page counts, CMS features, warranties or support terms.

A fabricated glyph count on a live listing is not a quality issue, it is a refund, a bad
review, and in the wrong category a legal problem.

## The mechanism

A rule is not enough. Three layers:

**1. FactSheet.** A typed structure derived deterministically from the canonical product and
its product-type metadata. It is the only factual source the prompt receives, delimited
clearly from merchandising instruction.

```
=== VERIFIED PRODUCT FACTS ===
(the FactSheet, and nothing else)

=== MERCHANDISING INSTRUCTIONS ===
(channel profile, tone, structure, limits)
```

**2. Zod validation.** Structured output, shape enforced.

**3. The factuality validator.** A deterministic pass that extracts every number, format
name, compatibility claim and count from the generated text and checks each against the
FactSheet. Anything unsupported fails the generation and surfaces to the user as "the model
claimed something not in your product data."

Roughly 200 lines, and the difference between a trustworthy product and a liability. It is
one of the three things that never bend.

Log the FactSheet hash on every `ai_generations` row so a bad listing traces to its inputs.

## Channel profiles

Do not write the canonical description four times.

- **Shopify**: direct conversion, brand storytelling, SEO, owned-customer relationship.
- **Etsy**: buyer search intent, descriptive terms, useful tags, human benefit language.
- **Creative Market**: designers, asset completeness, technical compatibility, use cases,
  aesthetic positioning. Markdown restricted to their subset, see
  `docs/channels/creative-market.md`.
- **Adobe Stock**: keyword-driven, no prose description, up to 49 keywords.
- **MyFonts**: type-specific vocabulary, under 500 words.

## Review

No first generation reaches a marketplace without explicit approval. The review UI supports
editing a field, regenerating a field, regenerating the whole listing, restoring an earlier
generation, and approving.

Auto-publishing a first generation would be the fastest way to destroy trust in the product.

**At B1, before the review screen exists, approval is a save.** Applying a generation stamps
`metadata.composedAt` on the listing; saving the editor stamps `approved_at`; Publish and
Publish changes refuse while the first is newer than the second, and the listing card says so
before the click. It is the smallest thing that keeps the sentence above true, and B2
replaces it rather than building on it.

## What B1 built

`lib/ai`, and one table. The pieces map onto the three layers above:

| Layer | Where | What it does |
|---|---|---|
| FactSheet | `lib/ai/factsheet.ts` | Derived from the product, its validated metadata and its ready assets. Deliverable formats are measured from the filenames, not declared. Hashed by canonical JSON |
| Prompt | `lib/ai/prompt.ts` | Two system blocks, rules then the channel profile, and the FactSheet alone in the user turn. The profile block carries the cache boundary, so the prefix is the same bytes for every product on a channel |
| Zod validation | `lib/ai/output.ts` | Six text fields. Price, currency and category are not the model's to decide and are not in the schema |
| Factuality validator | `lib/ai/factuality.ts` | Numerals, number words, vague quantities, format tokens, software and platform names, and licensing, support and standing claims. Each is allowed only if the FactSheet states it, as a value or in the creator's own words. Biased to refuse |
| Provider | `lib/ai/providers/` | One vendor, chosen by which key is present. Its name appears in that folder and nowhere else; a unit test reads the tree |
| Runner | `lib/ai/runner.ts` | Claims the row, records the hashes before the call, and either applies the copy with a `generate` snapshot or records `rejected` with the violations and leaves the listing untouched |
| Log | `ai_generations` | Provider, model, prompt version, input hash, FactSheet hash, tokens including cached, estimated cost, and the structured output on every succeeded or rejected row |

**The channel profile is on the adapter**, as `merchandising`, for the reason capabilities and
requirements are: it describes the channel and it is code. Its `promptVersion` moves with its
text and is written to the row beside the rules version.

**Rejected is not failed.** A model that answers with a claim the FactSheet does not support
has done what models do, and the validator refusing it is the product working. The row says
`rejected`, holds the copy and the violations, and the creator reads "the model claimed
something not in your product data: 12, ttf" and either adds the fact to the product or
composes again.

**Cost.** Decision 12 priced a generation at about a cent with the profile cached. The rules
and profile blocks together are the cached prefix; whether they clear the model's minimum
cacheable length is a measurement, and `cache_read_input_tokens` on the row is where it is
read. If it stays at zero the profile is too short to cache and the estimate is off by about
a third, not by an order of magnitude.

**Metering** is decision 13 and belongs to the entitlement service at C2. B1 counts and
costs every generation and gates nothing.
