# Handoff: Fanwise Marketing Site

## Overview
The complete marketing website for Fanwise ("Create once. Sell everywhere.") — a tool that holds one canonical product record and derives correct listings for each connected marketplace. Eight pages: Landing, Marketplaces, How It Works, Pricing, About, Get Started (signup), Terms, Privacy. Voice: launched product, matter-of-fact, no invented stats.

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior, not production code to copy directly. The `.dc.html` files use a proprietary template runtime (`{{ }}` holes, `<sc-for>`/`<sc-if>` tags, a `Component` logic class in a `data-dc-script` block) that will NOT run outside the design tool. **Recreate these designs in the fanwise repo's web stack** (per `docs/architecture.md`; if the marketing site has no stack yet, Next.js or Astro static pages are a good fit). All markup, exact inline styles, copy, and data live in the files — treat them as the spec. `theme.js` and `reveal.js` are plain JS and can be ported nearly as-is.

## Fidelity
**High-fidelity.** Colors, typography, spacing, copy, and interactions are final. Recreate pixel-perfectly.

## Pages
All pages share: max-width 1080px content column (landing: 1160px inside a 1440px rounded shell), nav (logo, page links, theme toggle, Sign in, Get started pill), footer (logo, links incl. Terms/Privacy, "fanwise, adv." dictionary line).

- **Landing** (`Fanwise Landing.dc.html`) — dark hero (#04060D) with an animated canvas: one point of light fanning into 6 labeled beams (see `componentDidMount` for the exact drawing code; respects `prefers-reduced-motion`). Then light slab (#F4F6FA): intro statement, workspace demo (dark app mock #0D1526 — master listing left, 6 derived-draft rows with Live/In review/Needs-a-fix statuses and a rejection-fix banner), shops rail, "the arithmetic" time table + bars, 3-step how-it-works, spec-sheet table, dark pricing band with interactive marketplace-count picker, signup form with validation, footer.
- **Marketplaces** — card per shop (Shopify=included storefront; Etsy, Creative Market, Envato, Gumroad, Adobe Stock, MyFonts = $6/mo) with spec rows + "what Fanwise handles" callout; full side-by-side spec table; dark CTA panel. Cards lift on hover (translateY(-4px) + shadow).
- **How It Works** — three large step rows (text left, spec panel card right), "after publish" grid of 4, dark CTA panel.
- **Pricing** — hero; the $9 + $6 × n equation band (#F3F1EC) with −/+ stepper (state: count 0–8); main plan card with Monthly/Annual toggle (annual = $90/$60, "two months free" chip); clickable example tiles (1/2/4/6 marketplaces, selected tile highlighted #EBEEFC, synced with stepper count); owned-vs-rented channel lists; model grid; Studio ($59/mo) banner; FAQ as `<details>`; dark CTA.
- **About** — manifesto: hero statement, "Canonical product → Channel adapter → Listing" rule card, 4-phase roadmap grid, "What Fanwise is not" list, dark CTA.
- **Get Started** — full dark page (#04060D, blurred blue orbs), 3-step list left, workspace form right (name, email, "mostly sells" select, "first shop" select; validates name + email regex; success card with personalized copy).
- **Terms / Privacy** — light legal pages, numbered sections, effective Sept 6 2026. Draft copy — legal review required.

## Interactions & Behavior
- **Theme toggle** (`theme.js`): circular button in every nav; applies `filter: invert(1) hue-rotate(180deg)` to `<html>`; persists in `localStorage['fw-theme']`. In production, prefer real design tokens (CSS variables with a dark palette) over the invert filter.
- **Scroll reveals** (`reveal.js`): sections/articles/headers/footers fade + rise 26px over 0.7s cubic-bezier(.2,.6,.2,1), staggered 90ms ×(i%4), IntersectionObserver threshold 0.06, rootMargin -40px; skipped entirely under `prefers-reduced-motion`.
- **Pulsing dots**: green status dots use `@keyframes fwPulse` (box-shadow ring 0→7px rgba(70,214,149,.45)→0, 2.4s infinite).
- **Landing hero canvas**: full redraw loop via requestAnimationFrame; beam pulse 0.82–1.0 sine; static frame when reduced motion. `beamMotion` boolean prop toggles animation.
- Pricing pickers, billing toggle, and both signup forms are client-state only (no backend); wire forms to the real signup endpoint.
- Hovers: nav links tint; pill buttons lighten; marketplace cards lift; links with `→` are underlined-border style.

## Design Tokens
**Type**: Archivo (display; weights 200/300/400/500, tight letter-spacing −0.02 to −0.05em), Instrument Sans (body, 16.5px), JetBrains Mono (labels/eyebrows, 9.5–11.5px, uppercase, letter-spacing .08–.16em). Google Fonts.
**Dark palette**: bg #04060D / #070C1A / #0B142A; app-mock #0D1526; text #E9F0FF / #EDF3FF; muted #98A6C2 / #6E7EA6; borders rgba(200,218,255,.14); accent blues #2E5CE6 / #6C9BFF / #1E44C8; green #46D695; amber #F5B944; red #FF8071.
**Light palette (landing slab)**: bg #F4F6FA; text #070A11; muted #464E5D / #7E8697; borders #DFE4EC; accent #2E5CE6.
**Light palette (interior pages)**: bg #FBFAF7; panel #FFFFFF; band #F3F1EC; text #14161C; muted #4C525F / #838996; borders #E3E0D9 / #EDEBE5; accent #1E3ED4 (tint #EBEEFC); green #1B8A5A; ink CTA #14161C.
**Radii**: pills 999px; cards 14–18px; app mock 18px; landing shell 26px/30px. **Spacing**: section padding ~92px vertical; grids `repeat(auto-fit, minmax(240–300px, 1fr))` with 32–56px gaps.

## Assets
No raster images. Logo = inline SVG fan mark (5 strokes from a point + dot), reused everywhere at 21–40px. All diagrams are HTML/CSS/canvas.

## Files
- `Fanwise Landing.dc.html`, `Fanwise Marketplaces.dc.html`, `Fanwise How It Works.dc.html`, `Fanwise Pricing.dc.html`, `Fanwise About.dc.html`, `Fanwise Start.dc.html`, `Fanwise Terms.dc.html`, `Fanwise Privacy.dc.html` — page specs (markup + inline styles + logic class at bottom of each file)
- `theme.js` — theme toggle web component; `reveal.js` — scroll reveals
