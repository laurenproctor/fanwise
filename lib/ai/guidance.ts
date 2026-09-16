import type { ProductType } from "@/lib/products/types"

/**
 * What good copy says about one kind of product, whatever the channel.
 *
 * The channel profile says how a channel's buyers read. This says what a buyer
 * of this kind of product needs to learn, which is the same on every channel:
 * a type buyer wants the classification, the family and the language coverage
 * whether they arrived from a search box or a storefront. It sits between the
 * rules and the channel profile, so the channel has the last word on shape,
 * length and markup, and the prefix still caches: the same bytes for every
 * product of one type on one channel.
 *
 * Only a type with a written standard has guidance. The rest compose from the
 * rules and the profile, as they did before.
 *
 * The factual rule is not relaxed by anything here. The guidance names what a
 * description covers when the facts support it, and says outright that a
 * section the facts cannot support is left out, because a standard that lists
 * "glyph count" as something buyers want is otherwise an invitation to supply
 * one.
 */

export interface ProductTypeGuidance {
  /** Bumped by hand whenever the text changes. Written to the row with the rest. */
  version: string
  text: string
}

const FONT: ProductTypeGuidance = {
  version: "2026-09-13.1",
  text: `PRODUCT TYPE GUIDANCE: TYPEFACES

This product is a typeface. The aim is not to make it sound desirable to everyone; it is to make it legible, conceptually and technically, to the people whose projects need it. A buyer should finish the description knowing what kind of type this is, how it feels in use, where it works, and what they receive.

You cannot see the letterforms. Everything you say about how the typeface looks, feels or came to be must come from the verified facts, most often the creator's own description, in whatever words suit the channel. Rephrase and sharpen what the creator says; never add a visual quality, a feature or a story they did not give.

What to cover, in this order, each only when the facts support it:

- Identity. Open with what the typeface is: its classification, as specifically as the facts allow (a high-contrast display serif, a condensed grotesk, a brush script), its two or three defining features, and the kind of work it suits. The classification belongs in the opening, not buried later. "Modern font" is not a classification.
- Design story. The idea, research, period, place or observation behind it, connected to specific decisions in the letterforms. Only a source the creator names. Keep their distinction between direct research, loose inspiration, revival and reinterpretation; do not upgrade an influence into a revival or invent an origin.
- Visual behaviour. Proportions, contrast, rhythm, spacing, terminals, texture. Tie each feature to its effect in use: narrow proportions let a headline carry more words at the same size, which is worth saying; "condensed" alone is not.
- Best uses. Three to six credible applications drawn from what the creator says it is for: brand identities, editorial headlines, packaging, posters, album artwork, book covers, websites, signage, long-form reading, small text. Be honest about limits the creator states. If it is meant for large display sizes, say so; do not promise readability at small sizes the creator has not claimed.
- Family and features. What the buyer receives: styles, weights, italics, widths, variable axes, glyph coverage, writing systems and languages, OpenType features, formats. Only what the facts list. Name writing systems rather than calling a font multilingual. Translate a feature into what it lets the buyer do, instead of only listing it.
- Closing. End on the design opportunity the typeface creates, not on generic sales language.

Word choice:

- Use roughly three to six aesthetic terms, chosen from the creator's own description (elegant, editorial, industrial, playful, warm, cinematic and so on). Do not pile up contradictory adjectives to catch more searches.
- Prefer a specific typographic observation to a general adjective. Do not call the typeface timeless, versatile, unique, perfect or complete; if something is complete, say what it contains.
- Use the words buyers search with where they are true: classification with mood (friendly geometric sans serif), use with mood (luxury font for skincare branding), technical need with style (variable grotesk, serif with small caps), period with form (Bauhaus geometric). Never repeat keywords mechanically.
- A period stated as a number, such as a decade or a year, is a number: use it only if the facts state it. A named movement or era the creator names may be used as they name it.
- Preserve the designer's voice and stated intention.

Licensing belongs in the listing's structured fields. Do not restate or summarise license terms in the description beyond what the channel profile asks for.

When the facts are thin, write a shorter description. Leave out any section the facts cannot support, and never write a placeholder, a bracket or a note that something is unknown.

The channel profile that follows decides length, structure and markup. Where it asks for a different order or a list, follow it and carry the substance above into that shape.`,
}

const GUIDANCE: Partial<Record<ProductType, ProductTypeGuidance>> = {
  font: FONT,
}

export function guidanceFor(productType: ProductType): ProductTypeGuidance | null {
  return GUIDANCE[productType] ?? null
}
