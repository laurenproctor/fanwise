# ADR 0014: The model may look at a product image, for that image's alt text only

**Status:** proposed, 17 September 2026, built at the founder's request ("make it so that the
API auto chooses image alt text"). Accepting it is the founder's call; the code ships with the
scope below and nothing wider.
**Date:** September 2026
**Touches:** architecture invariant 5 (`CLAUDE.md`), `docs/ai-merchandising.md`, and the
import plan's rule that no vision model reads a picture (`docs/product-link-import.md`).

---

## Context

Alt text is what a screen reader says for an image. Fanwise has stored it per image since the
font workspace shipped (`product_assets.metadata.altText`, editable on a ready row because
`metadata` is outside the immutability trigger), and nudged the creator to write it. Almost
nobody does, and until this ADR the channels never sent it anyway: Shopify, Etsy and
WooCommerce received the listing title on every image, and Gumroad received nothing.

The founder asked for alt text to be chosen automatically. Alt text cannot be written from the
FactSheet alone: the FactSheet knows a product has six images and nothing about what any of
them shows. The only honest source for "a specimen sheet of Facette in white on a black card,
spelling the family name" is the picture.

That runs into two written rules. Invariant 5 says AI may never introduce a factual claim
absent from the FactSheet, and the listing prompt tells the model it cannot see the product.
The import plan says a picture is a product image and nothing else: no vision model reads it,
and nothing it shows becomes a fact. Both exist for the same reason, that a model describing
how a typeface looks is making claims about the product, and a claim about the product must
come from the creator.

## Decision

The model is shown a product image in exactly one place, `lib/ai/alt-text.ts`, to write that
image's alt text, and the image is a fact source for that sentence and for nothing else.

The rule of the AI layer applies to the sentence unchanged:

1. The same factuality validator runs on the answer against the product's FactSheet, as one
   field of an otherwise empty listing. A model that counts the weights on a specimen sheet,
   names a script it can read there, or mentions a format is refused unless the creator has
   stated that fact. One retry names the refused values; a second refusal leaves the field
   empty and the creator sees the readiness nudge as before.
2. Nothing seen becomes a product fact. The job writes one key on one asset's `metadata`. It
   never touches the product, the FactSheet, a listing field or another image.
3. The words are labelled. `metadata.altTextSource` is `generated`, the editor says
   "Suggested from the image. Edit it if it is wrong", and a creator's edit relabels it
   `creator`. A generated suggestion never overwrites a creator's words, including ones typed
   while the job ran.
4. The listing prompt is untouched. Listing and field generations still send no image and are
   still told the model cannot see the product. The provider request gained an optional
   `images` list; a listing generation never fills it.

The channels now send the image's own alt text when there is one, the listing title otherwise.

The prompt tells the model what alt text is for, forbids counts, number words and vague
quantities outright (the validator refuses those anyway), and says the filename is a hint
about intent and never a fact about the picture.

## What this is not

It is not vision for import, for merchandising or for anything else. The import plan's rule
stands for import: pictures added to a draft become product images and no words. It is not
review-gated: a suggestion reaches a channel at the next publish, on the B2 precedent that
publishing is the approval, which is decision 30 in `0002` if the founder wants otherwise.

## Consequences

- One short model call per uploaded product image, after it finalizes, roughly a cent each
  with the picture scaled to 1568 pixels. `FANWISE_AUTO_ALT_TEXT=off` stops the automatic ask
  for a deployment or a test run; the editor's "Suggest from the image" still works.
- The worker is deployed by hand and lags `main`. Until it is redeployed, the finalize job on
  the worker does not describe anything, and the button queues a job the worker does not
  know. Both degrade to an empty field.
- The public product page (`/@handle/<slug>`) does not yet read `metadata.altText`: `anon`
  has a column-level grant on `product_assets` that excludes `metadata`. Widening it is a
  migration and its own review.
