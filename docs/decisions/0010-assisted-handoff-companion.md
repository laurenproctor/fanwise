# ADR 0010: A companion window for the assisted handoff, and what it may never do

**Status:** proposed, 11 September 2026. Written at the founder's request after they chose
a sidebar over a form-filling browser extension. The constraints are meant to hold; the
choice between the two forms and the timing are the founder's to accept, amend or overrule.
**Date:** September 2026
**Blocks:** nothing. A8 builds the handoff screen whether or not a companion follows.
**Register:** open-decisions entry 28, which stays as an index pointer

---

## Context

An assisted channel is one Fanwise prepares a listing for and a person submits by hand:
Creative Market at A8, Behance at B9, one of Adobe Stock or MyFonts at B4. Each gets a
handoff screen, specified in `docs/channels/creative-market.md` §10 and
`docs/channels/behance.md` §10, ordered to match the marketplace's own editor so the creator
works down both at once.

Both at once means two windows. Section 12 of the Creative Market spec already names the
failure that follows: creators "get lost between windows." It prescribes fixing the step
order first, and the order is the cheap fix. A layout that keeps the handoff beside the
editor is the next one.

On 11 September 2026 the founder asked about a browser extension for these channels. Two
kinds were weighed:

- **An extension that works on the marketplace's page:** fills fields, attaches files,
  clicks through. This is browser automation, which `CLAUDE.md` and the roadmap exclude, and
  the channels it would serve forbid it in writing. Behance's Community Guidelines, under "Be
  Authentic," prohibit "using automated or scripting processes (such as bulk or automated
  uploading of content through a script)." Adobe's General Terms of Use §6.6 prohibit access
  "by any means other than the interface we provide or authorize." Creative Market's Terms
  §8(b) prohibit automated systems making more requests than a human reasonably could, as
  `docs/channel-feasibility.md` records. Its value is also highest exactly where it is least
  permitted: one listing saves minutes, and a catalog pushed through is the bulk upload the
  clauses name. A version where the creator clicks "fill this field" and then publishes is
  the same act in smaller pieces.
- **A sidebar that shows Fanwise's handoff beside the marketplace and touches nothing on the
  marketplace's page.** The founder chose this one.

## Decision

The assisted handoff may be shown in a **companion window** beside the marketplace's editor.
The companion is a second view of the same handoff. It is never an agent on the
marketplace's page.

### Constraints, which do not bend

1. **It never reads, writes or scripts a marketplace's page.** No content scripts, no host
   permission on any marketplace origin, no field filling, no simulated clicks, no file
   injection, no reading the page back to check it. The clauses above are why.
2. **It holds no marketplace credential or session** and never asks for one. Invariant 7.
3. **It captures only what the creator hands it.** The listing URL is pasted, as on the web
   handoff; or, in the extension form only, it is the current tab's address, read when the
   creator clicks the extension's own button or menu item.
4. **Every row it writes is `self_reported`.** Nothing it records is verification, and the
   trigger that refuses `verified` on an assisted channel applies unchanged. Invariant 8, and
   A8's exit test.
5. **It renders the handoff from the same data and the same component as the web page.** It
   is a layout, not a second implementation of the steps, so the two can never disagree
   about what the creator should paste.

A marketplace granting written permission for anything beyond these would be recorded here,
with the permission, before anything was built on it.

### Two forms, in order

**A. A pop-out window from the Fanwise web app.** A button on the handoff screen opens the
handoff in a small window that stays on top of other windows, using the Document
Picture-in-Picture API. The window is a same-origin document of the page that opened it:
same session, same data, no install, no store review, and no new client to secure. ADR 0007's
headers need no change, because a pop-out is not a frame.

- Support: Chrome and Edge 116 and later on desktop, Firefox 151 and later. Not Safari, and
  not mobile. Where it is missing the button is not offered and the full page is the
  handoff, the same rule invariant 8 applies to channels: the UI does not offer what cannot
  be done.
- Limits: it opens only on a click; the site cannot position it; one per tab; it cannot be
  navigated; stylesheets have to be copied into it.
- **[verify]** at build: that copy buttons in the pop-out write to the clipboard, including
  the formatted text Creative Market's description needs (§6 of that spec); and whether
  images and files can be dragged from it into the marketplace's upload control, with a
  download as the fallback.

**B. A browser extension side panel.** Chrome's `sidePanel` API, Chrome 114 and later with the
`sidePanel` permission, docks the handoff beside the marketplace tab.

- It **cannot frame the Fanwise app**: ADR 0007 sends `frame-ancestors 'none'` and
  `X-Frame-Options`, correctly. So the panel renders the handoff itself from an API and
  signs in on its own. That is a second authenticated client, with its own threat model in
  `docs/security.md` before it ships.
- The side panel page does not see the marketplace tab. Capturing its address takes the
  `activeTab` grant, which Chrome gives on a click of the extension's toolbar action, a
  context-menu item or a keyboard shortcut, shows no install warning, and lasts until the
  tab navigates. A click inside the panel does not grant it.
- Chrome Web Store review on every release, separate packaging for Firefox's sidebar, and
  still nothing for Safari.
- What it buys over A: it docks rather than floats, and it can take the URL with a click
  instead of a paste.

**Recommendation:** A first. It delivers the sidebar with none of B's cost, and B's two
advantages are conveniences. B only if A has been built, used, and found wanting, and then as
its own decision.

## When

Not now. A7 is the current step, and A8 has not built the handoff this would show.

- **A8** builds the handoff as one component that does not assume the width of a full page.
  That is the only thing this ADR asks of A8, and it costs a layout rule, not scope.
- **The evidence decides the rest.** A8's exit run and the B2a creator test watch for the
  failure in Creative Market §12. If the order is right and creators still lose their place
  between windows, form A is built, and the creator test is the place to see it work. If they
  do not, this stays proposed and nothing is built.

## Consequences

- The roadmap's "browser automation" exclusion now says what it covers: anything that works
  on a marketplace's page. A companion that touches none is not browser automation.
- Decision 16, assisted versus automatic pricing, gets one more piece of evidence either
  way. An assisted channel that is one uninterrupted flow is easier to charge for than one
  that is two windows and a clipboard.
- Nothing here changes the capability matrix. A companion adds no capability to any channel,
  and an assisted adapter still implements no `publish`.
