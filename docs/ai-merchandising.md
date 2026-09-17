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

## Formatting

Descriptions are Markdown (ADR 0011). A generated channel description may use paragraphs and
bullet lists, and bold sparingly where the channel profile allows; never headings, links,
images or emoji. The canonical description an import composes is the exception: it is
structured with `##` and `###` headings and paragraphs, because it is the product page a
buyer scans rather than one channel's copy (`docs/product-link-import.md` §16). The factuality validator reads the description as the words a buyer sees
(`markdownToClaimText`): markup is removed, list markers are dropped because they are
structure rather than counts, and everything else, a link's address included, is checked as
before. The FactSheet's description is read the same way.

## Channel profiles

Do not write the canonical description four times.

- **Shopify**: direct conversion, brand storytelling, SEO, owned-customer relationship.
- **Etsy**: buyer search intent, descriptive terms, useful tags, human benefit language.
- **Creative Market**: designers, asset completeness, technical compatibility, use cases,
  aesthetic positioning. Markdown restricted to their subset, see
  `docs/channels/creative-market.md`.
- **Adobe Stock**: keyword-driven, no prose description, up to 49 keywords.
- **MyFonts**: type-specific vocabulary, under 500 words.

## Product type guidance

A channel profile says how a channel's buyers read. What a buyer of one kind of product needs
to learn is the same on every channel, so it is written once per product type and sits
between the rules and the profile (`lib/ai/guidance.ts`). The profile comes last and decides
length, structure and markup; the guidance supplies the substance. A type without a written
standard composes from the rules and the profile alone.

**Typefaces**, adopted 13 September 2026. The full standard is
[`docs/merchandising/typefaces.md`](merchandising/typefaces.md): classification, mood,
applications, distinctive features, history, family, language support, OpenType features and
formats, the search intents buyers combine, and the six-part structure (identity, design
story, visual behaviour, best uses, family and features, closing). The prompt carries a
condensed form.

What enforces which part:

| Part of the standard | Enforced by |
|---|---|
| Never invent counts, formats, languages, license rights | The factuality validator, as before |
| A decade or year the creator did not state ("1970s", "'90s") | The validator. Before this, a numeral followed by a letter was skipped, so a decade's plural passed; it is now read as the number |
| Never invent a history, influence, designer or origin in words | The rules block, for every product type. **No deterministic check.** A named movement the facts lack ("Bauhaus") is not caught; review is the backstop |
| Never state a visual quality not in the facts | The rules block. The model cannot see the letterforms, so mood, classification and features come from the creator's description |
| Structure, word choice, use cases, no placeholders | The guidance, and review |

**Font facts in the FactSheet**, added 15 September 2026 after the font workspace (#105) put
them on the product. The FactSheet now carries the creator's confirmed classification (in
words), styles with weight, width and italic, variable axes with their ranges, writing
systems, OpenType feature tags, the license types sold (names only, never prices, limits or
the EULA address) and the creator's search keywords. `renderFactSheet` states them the way a
buyer reads them: "Weights: 3 (Thin, Regular, Bold)", "Weight (wght): 100 to 700, default
400", "Small capitals (smcp)", with the counts a description would want (weights, italic
styles, stylistic sets) derived deterministically. What the files detected but the creator
has not confirmed stays on the asset rows and is not a fact.

The validator admits all of it to the corpus and the allowed numbers, including the counts
derived from it and the number of languages and writing systems. It also gained two
vocabularies, used for every product type:

- **OpenType features** ("small caps", "oldstyle figures", "discretionary ligatures",
  "stylistic sets", "swashes", "italics", "variable font" and so on), each a group of ways
  to say one feature. A term passes when any term of its group is in the facts' words or its
  tag is in the feature list, so "small caps" passes for `smcp`.
- **Writing systems** (Latin, Latin Extended, Greek, Cyrillic, Arabic, Hebrew, Devanagari,
  Kana, Hangul and others). "Latin Extended" is judged before "Latin"; "Arabic numerals" is
  ordinary English and ignored. Language names are not checked: they collide with design
  history ("Swiss", "Dutch") too often to refuse deterministically.

The guidance is part of the cached prefix, so the prefix is now the same bytes per channel
and product type rather than per channel. Its version is appended to `prompt_version` as
`font.<version>` when present, so a row still says exactly what was asked.

The import prompt carries the same guidance since 16 September 2026, for the case the model
decides a source is a typeface: the product type is its choice in the same answer, so the
guidance rides in the rules block with a line saying when it applies, and
`product_imports.prompt_version` records `<rules>+font.<version>`.

## Review

No first generation reaches a marketplace without explicit approval. The review UI supports
editing a field, regenerating a field, regenerating the whole listing, restoring an earlier
generation, and approving.

Auto-publishing a first generation would be the fastest way to destroy trust in the product.

**Built at B2, on 8 September 2026**, on the listing page rather than a screen of its own:

| Action | Where | What it does |
|---|---|---|
| Edit a field | the editor, since A4 | Save writes the words. It no longer approves them |
| Regenerate a field | Regenerate beside each field | One generation row with `field` set, the same prefix and validator, one column written |
| Regenerate the whole | Compose again | As at B1 |
| Restore | Earlier drafts, under the compose panel | Puts an accepted generation's `structured_output` back, whole or one field, as the signed-in user, with a `restore` snapshot. No model is called |
| Approve | Publish itself | When composed copy is waiting, the button reads "Review and publish" and the click stamps `approved_at` before the send |

Applying or restoring a generation stamps `metadata.composedAt`; publishing stamps
`approved_at` when the first is newer. The listing card says composed copy is waiting and
that publishing counts as approval, and the button says what it is doing. A save is not an
approval, which it was at B1 for want of anything better.

**A separate Approve button was built and dropped on the same day.** Two clicks that both
meant "I have looked at this" was one too many, and a button always pressed right before
another button is ceremony. The rule the paragraph above states is kept in substance: nothing
composed ships without the person who ships it choosing to, and the record shows when they
did.

Regenerate acts on the row, so the editor holds it back while the screen holds unsaved words:
a regeneration lands by remounting the editor, which would discard an edit in progress.

A field is regenerated from the facts and the profile alone, not from the rest of the listing.
The other fields may be the creator's own words, which may state things the FactSheet does
not; a model that copied a hand-written count into a new title would then be refused for
repeating something the creator vouched for.

Only an accepted generation can be restored. The copy on a refused row was never allowed on
the listing, and restoring it would be the one door the validator does not guard.

## Image alt text

Added 17 September 2026, ADR 0014, proposed. The one place the model is shown a picture.

A product image's alt text is written by `lib/ai/alt-text.ts` from the image and the FactSheet,
after the image finalizes and on request from the editor ("Suggest from the image"). The image
is a fact source for that sentence and for nothing else: the job writes `metadata.altText` and
`metadata.altTextSource: "generated"` on that one asset, and nothing it sees reaches the product,
the FactSheet or a listing.

The rule above applies to the sentence. The factuality validator runs on it as one field of an
otherwise empty listing (`onlyField`), so a count of weights read off a specimen sheet, a script
the model can see, or a format is refused unless the creator has stated it. One retry names the
refused values. A second refusal leaves the field empty for the creator. The prompt forbids
numbers, number words and vague quantities outright, and says the filename is a hint about
intent and never a fact about the picture.

Listing and field generations are unchanged: no image, and the rules block still says the
model cannot see the product. `GenerationRequest.images` exists for alt text and is never
filled by `buildPrompt`.

The channels send the image's own alt text when there is one (`altTextFor`), the listing
title otherwise. `FANWISE_AUTO_ALT_TEXT=off` stops the automatic ask; the button still works.

## What B1 built

`lib/ai`, and one table. The pieces map onto the three layers above:

| Layer | Where | What it does |
|---|---|---|
| FactSheet | `lib/ai/factsheet.ts` | Derived from the product, its validated metadata and its ready assets. Deliverable formats are measured from the filenames, not declared. Hashed by canonical JSON |
| Prompt | `lib/ai/prompt.ts` | System blocks for the rules, the product type's guidance when there is one, and the channel profile, then the FactSheet alone in the user turn. The profile block carries the cache boundary, so the prefix is the same bytes for every product of one type on a channel |
| Zod validation | `lib/ai/output.ts` | Six text fields. Price, currency and category are not the model's to decide and are not in the schema |
| Factuality validator | `lib/ai/factuality.ts` | Numerals, number words, vague quantities, format tokens, software and platform names, and licensing, support and standing claims. Each is allowed only if the FactSheet states it, as a value or in the creator's own words. Biased to refuse |
| Provider | `lib/ai/providers/` | One vendor, chosen by which key is present. Its name appears in that folder and nowhere else; a unit test reads the tree. An organization-level key also needs `ANTHROPIC_WORKSPACE_ID`, sent as a header; the vendor refuses such a key without one (found 16 September 2026, on the worker) |
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
