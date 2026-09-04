# Design

The published mockups, checked in as the specification. When a question comes up about how
something should look or read, these files answer it, not a screenshot in a chat thread.

```
design/marketing/landing.html    the Fanwise marketing site
design/marketing/pricing.html    the pricing page
```

Both are self-contained: open either directly in a browser, no build step.

## What they are for

**They are the source of truth for the visual system.** `docs/design-system.md` extracts the
tokens; these files are where those tokens came from and where the intent lives.

**The landing page contains a working mockup of the product UI.** The workspace window in
the middle of `landing.html` shows one master listing on the left and six derived channel
listings on the right, with per-channel derived-draft summaries, live and pending and
needs-a-fix statuses, and an inline rejection with a suggested fix. That section is the
closest thing to a product spec for the publish screen, and it should be read as one when
step A4 and A7 arrive.

**They are not the app.** No part of `design/` is imported by `app/`. These pages are static
HTML with inline styles and a canvas animation. When the marketing site is built for real it
should be a separate deployment, and when app screens are built they should derive from
`docs/design-system.md` and Tailwind tokens rather than copying markup from here.

## What is real and what is placeholder

The mockups deliberately show a working product. Every number in them is invented.

| In the mockups | Status |
|---|---|
| Usage stats (41,280 listings, 2,406 designers, 99.4%) | Placeholder |
| The Aster Grotesk sample workspace | Placeholder |
| Channel spec sheet values | Illustrative. `docs/channels/creative-market.md` has verified ones |
| Channel modes (Storefront, Automatic, Assisted) | **Accurate**, per `docs/channel-feasibility.md` |
| Pricing: $9 base plus $6 per marketplace | **Accurate**, matches `docs/billing.md` |

Before any of this goes public, replace the placeholder numbers or mark them as illustrative
on the page. Shipping invented usage statistics as fact is not a rounding error.

## Editing

These were published as Claude artifacts and can be republished from the same files. Keep
this copy and the published version in sync, or pick one as canonical and say which here.
