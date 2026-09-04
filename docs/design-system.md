# Design system

Extracted from `design/marketing/`. Those files are the source; this is the reference.

Two surfaces, deliberately different. The marketing site commits to a dark, atmospheric
world. The product application is light, dense and quiet, because people work in it all day.
Both use the same typefaces and the same accent, which is what makes them one brand.

## Typefaces

| Role | Face | Weights | Used for |
|---|---|---|---|
| Display | Archivo | 200, 300, 400, 500 | Headings, prices, large numbers. Extralight at large sizes |
| Body | Instrument Sans | 400, 500, 600 | Running text, UI labels, buttons |
| Mono | JetBrains Mono | 400, 500 | Metadata, statuses, specs, figures, eyebrows |

Rules that carry the brand more than the palette does:

- Display is set light and tight: `font-weight: 200`, `letter-spacing: -0.04em` at hero
  sizes, tightening as size increases.
- Mono is always uppercase with `letter-spacing: 0.12em` to `0.14em`, at 9.5px to 11px. It
  is the voice of anything the system knows rather than says.
- Numbers that align in columns get `font-variant-numeric: tabular-nums`. Always.
- Running text stays near 65 characters. Headings get `text-wrap: balance`.

## Product palette, dark

The application surface and the marketing hero.

```
--void        #04060D   deepest ground, hero
--deep        #070C1A   section ground
--navy        #0B142A   raised section
--panel       #0D1526   app window
--panel-2     #111B30   app window, raised
--on-dark     #E9F0FF   primary text
--on-dark-2   #98A6C2   secondary text
--rule-d      rgba(200,218,255,.14)
--glow        #6C9BFF   accent, light ground
--blue        #2E5CE6   accent, solid
```

## Marketing palette, light

The pricing page and any document surface.

```
--paper       #FBFAF7   ground, warm off-white
--paper-2     #F3F1EC   raised
--card        #FFFFFF
--ink         #14161C   primary text
--ink-2       #4C525F   secondary
--ink-3       #838996   tertiary, mono labels
--rule        #E3E0D9
--rule-2      #EDEBE5
--accent      #1E3ED4   one accent, used sparingly
--accent-soft #EBEEFC
```

The neutrals are warm on light and cool on dark, both biased slightly toward the accent. A
pure grey would read as unconsidered.

## Semantic colors

Separate from the accent, and never used decoratively.

```
ok      #46D695 on dark   #1B8A5A on light   live, connected, healthy
warn    #F5B944 on dark                      in review, pending, with the team
bad     #FF8071 on dark                      needs a fix, rejected, failed
```

State must be readable from form as well as color: a pill with a dot, a left border, a
label. Never color alone.

## Components

**Buttons** are fully rounded pills, `border-radius: 999px`, 10px by 18px padding at 14px
medium. Solid for primary, 1px border for secondary. This was tried square and reverted, so
leave it alone.

**Status pills** are mono, uppercase, 10px, with a 5px dot, a tinted background at 8 to 9
percent and a border at 30 percent of the semantic color.

**Cards** get an 18px radius on dark and 14 to 16px on light. Spend border, fill and shadow
by role: lift the one thing that matters instead of stamping every block.

**Tables** are the workhorse of the product UI. Hairline rules, mono column headers at 10px
uppercase, display face at 17px in the first column, tabular numbers everywhere, and
`overflow-x: auto` on the container so the page never scrolls sideways.

**The signature device** is the equation on the pricing page: `$9 base + $6 per marketplace
x n = total`, set in large extralight Archivo with the total in accent. Reuse it wherever
pricing is explained. It is the most memorable thing in the system.

**The fan mark** is five strokes radiating from a filled pivot dot, drawn on a 24 by 24
viewBox with `stroke-width: 1.5` and round caps, taking `currentColor`. The same geometry
scales up into the hero canvas as six beams from one light source.

## Layout

Content column is 1160px max with 68px gutters, stepping to 44px on tablet and 22px on
mobile. Sections are 92px vertical, 66px on mobile. The marketing frame is a 26px-radius
rounded container on a light grey ground.

## In the app

`app/globals.css` defines these as Tailwind v4 `@theme` tokens. Style through tokens, never
literals, so the palette is one file to change.

## What to avoid

Purple-to-blue gradient heroes, glowing effects for their own sake, emoji as section
markers, rounded corners on everything at the same radius, AI robot imagery, chat-first UI,
and stat tiles when the numbers are not the point of the screen.

The reference is professional creative infrastructure. Linear and Stripe, not an AI SaaS
template.
