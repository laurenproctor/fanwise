# The Fanwise standard for typeface descriptions

Adopted 13 September 2026. The model reads a condensed form of this, in
`lib/ai/guidance.ts`; `docs/ai-merchandising.md` records how it is wired in and
what enforces it. When this document changes, change the guidance text and bump
its version.

A strong typeface description should help the right buyer recognize that a font belongs in
their project. It should communicate the typeface's identity, practical uses, distinctive
qualities, and technical capabilities without relying on vague praise or inflated language.

## What typeface buyers want to know

### 1. Classification

Clearly identify the typeface's fundamental category: serif, sans serif, slab serif,
display, script, handwritten, blackletter, monospaced, experimental, variable, decorative.

Add a useful subcategory whenever it is accurate: grotesk, geometric, humanist,
transitional, Didone, old style, neo-grotesk, brush script, condensed, high-contrast serif,
or another recognized description.

"Modern font" alone is not sufficiently specific. "High-contrast display serif" gives the
buyer and the search system something meaningful to work with.

### 2. Visual character and mood

Describe how the typeface feels when it is used. Buyers often begin with an emotional or
aesthetic direction rather than a technical classification.

Useful qualities may include elegant, luxurious, editorial, playful, friendly, authoritative,
industrial, futuristic, nostalgic, romantic, minimal, raw, rebellious, sophisticated, warm,
corporate, cinematic, quirky, dramatic, approachable.

Choose only qualities that the letterforms genuinely support. Avoid collecting contradictory
adjectives simply to capture more searches.

### 3. Intended applications

Explain where the typeface performs best. Buyers frequently search by project rather than by
typographic terminology.

Common applications include brand identities and logos, editorial design and magazines,
packaging, posters, album artwork, book covers, websites and digital products, advertising
campaigns, fashion and beauty branding, food and beverage packaging, hospitality, wedding
invitations, social media graphics, film titles, signage and wayfinding, presentation design,
long-form reading, headlines and display copy, captions and small text.

Be honest about limitations. If the typeface is intended primarily for large display
settings, say so. A precise description builds more trust than claiming that every font is
suitable for everything.

### 4. Distinctive design features

Identify the visible qualities that make the design recognizable: high or low stroke
contrast, sharp or soft terminals, wide or narrow proportions, large x-height, tight or open
spacing, angular curves, rounded construction, unusual ink traps, flared strokes, exaggerated
serifs, compact capitals, expressive punctuation, alternate letterforms, distinctive italics,
unconventional numerals.

Whenever possible, connect the feature to its effect. For example:

> Its narrow proportions and compact spacing allow headlines to carry more language without
> losing visual impact.

That is more useful than simply calling the font "condensed."

### 5. Historical and cultural references

If the design has a genuine source of inspiration, explain it. This gives the typeface
intellectual context and makes it more memorable.

Relevant references could include a typographic period or movement, historic printing
methods, architecture, transportation systems, newspapers or broadcast media, technology,
music scenes, political movements, vernacular signage, a specific place or regional visual
culture, or a pivotal change in media or society.

The history should illuminate the design rather than become an invented origin story.
Clearly distinguish direct research, loose inspiration, revival, reinterpretation, and
coincidence.

### 6. Family composition

State exactly what the buyer receives: number of weights, number of styles, presence of true
italics or obliques, widths such as condensed, normal, or expanded, variable-font axes and
ranges, display and text optical sizes, upright and italic families, static font files
included alongside variable files.

Avoid ambiguous claims such as "a complete family." Define what complete means.

### 7. Character and language support

Buyers need to know whether the font can typeset their content. Include verified
information about uppercase and lowercase characters, numerals, punctuation, symbols,
currency characters, accented characters, supported writing systems, supported languages,
and total glyph count, if known.

Writing-system support is more meaningful than saying "multilingual." For example, specify
Latin Extended, Cyrillic, Greek, Arabic, Devanagari, or another supported script. If the font
supports a verified number of languages, that number may also be included.

### 8. OpenType and special features

List only features that are actually present: standard and discretionary ligatures,
stylistic alternates, stylistic sets, swashes, contextual alternates, small capitals,
case-sensitive punctuation, fractions, superscripts and subscripts, tabular and proportional
figures, oldstyle and lining figures, ordinals, localized forms, initial and terminal forms.

Translate technical features into practical value. For example:

> Six stylistic sets make it possible to shift the typeface from restrained to highly
> expressive without changing families.

### 9. Formats and compatibility

State what files are delivered and where they can be used: OTF, TTF, WOFF, WOFF2, variable
font files, desktop use, web use, app embedding, e-book use, software requirements, and
whether special features require OpenType-aware software.

Licensing should be displayed as structured information near the description, not hidden
inside promotional copy.

## How people search for typefaces

Typeface searches commonly combine several kinds of intent:

- **Classification + aesthetic**: elegant serif font, friendly geometric sans serif,
  experimental display typeface, vintage condensed font.
- **Use case + aesthetic**: luxury font for skincare branding, retro font for a concert
  poster, minimal font for a fashion magazine, playful font for children's packaging.
- **Industry + type**: serif font for a restaurant brand, modern font for architecture,
  display typeface for music artwork, professional sans serif for a technology company.
- **Technical requirement + style**: variable grotesk font, Cyrillic display typeface, serif
  with small caps, multilingual branding font, condensed font with italics.
- **Period or cultural reference + format**: 1970s editorial serif, Bauhaus geometric font,
  Art Nouveau display font, medieval blackletter typeface, Y2K futuristic font.
- **Problem or desired outcome**: readable font for small text, narrow font for long
  headlines, font that feels expensive, alternative to a popular grotesk, distinctive font
  for a logo.

A good description should naturally contain the accurate terms a buyer might use. It should
never repeat keywords mechanically or claim qualities the design does not possess.

## Recommended description structure

**Opening: identity and positioning.** One or two sentences explaining what the typeface is,
its defining visual character, and the kinds of work it suits.

> [Typeface name] is a [specific classification] characterized by [two or three defining
> features]. Designed for [primary uses], it gives projects a [accurate emotional or
> aesthetic effect] voice.

**Design story.** The idea, research, history, or cultural observation behind the typeface,
connected to specific decisions in the letterforms.

**Visual behavior.** Proportions, contrast, rhythm, spacing, terminals, texture, and other
meaningful attributes, and how they affect typography in use.

**Best uses.** Three to six credible applications, broad contexts and specific industries
where relevant.

**Family and features.** Weights, styles, variable axes, glyph coverage, languages, OpenType
features, and included formats.

**Closing.** The design opportunity the typeface creates rather than generic sales language.

## Example description

Container is a condensed industrial display sans serif shaped by the visual language of
global freight: shipping labels, identification codes, container markings, and the rigid
modularity of objects designed to move across borders.

Its narrow proportions, firm vertical rhythm, and utilitarian construction give headlines a
dense, authoritative presence. Small irregularities keep the family from feeling sterile,
preserving some of the physical character of stamped information, painted steel, and working
infrastructure.

Container is particularly effective for editorial headlines, identity systems, packaging,
posters, music artwork, apparel, and projects concerned with industry, movement, trade, or
systems. Its compact width accommodates longer headlines while retaining scale and impact.

The family includes [verified weights and styles], with [verified language support] and
features including [verified OpenType features]. Files are supplied in [verified formats].

Container turns the anonymous typography of circulation into a visible identity: type
designed not merely to label an object, but to suggest where it has been and where it is
going.

The bracketed slots are for a person writing by hand. Generated copy never contains them: a
fact the FactSheet does not hold is left out, not marked.

## Quality rules for Fanwise-generated descriptions

- Never invent glyph counts, language support, OpenType features, formats, variable axes,
  historical sources, or licensing rights.
- Separate verified font metadata from inferred visual interpretation.
- Prefer specific typographic observations over generic adjectives.
- Mention the primary classification within the opening paragraph.
- Include credible use cases in natural language.
- Use approximately three to six carefully selected aesthetic terms.
- Avoid keyword stuffing and repeated synonyms.
- Do not describe every typeface as timeless, versatile, unique, or perfect.
- Do not promise readability without considering size and context.
- Do not treat "multilingual" as sufficient language documentation.
- Explain why a feature matters instead of merely listing it.
- Preserve the designer's voice and stated intention.
- Keep the main description scannable, with technical specifications displayed separately
  when possible.

The goal is not to make every typeface sound desirable to everyone. It is to make the
typeface legible, conceptually and technically, to the people whose projects genuinely need
it.
