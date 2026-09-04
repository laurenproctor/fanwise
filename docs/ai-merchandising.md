# AI merchandising

Arrives at step B1. Written now because the constraint shapes earlier data decisions.

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
