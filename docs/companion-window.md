# The companion window

The build plan for B11: showing an assisted channel's handoff beside the marketplace's own
editor, in a window that never touches the marketplace's page.

The decision this implements is `docs/decisions/0010`, which is still **proposed**. The
constraints there are the law of this document and are not restated to be softened. This
file is the part 0010 deliberately left out: what gets built, in what order, and what would
have to be true for it to be worth building at all.

**Status: planned 12 September 2026 at the founder's request. Not opened. Conditional on
evidence that does not exist yet, see section 2.**

---

## 1. What this is

An assisted channel is one Fanwise prepares a listing for and a person submits by hand.
Creative Market at A8, Behance at B9, one of Adobe Stock or MyFonts at B4. Each has a
handoff screen, ordered to match the marketplace's own editor so the creator works down both
at once.

Both at once means two windows, and two windows is where creators get lost.
`docs/channels/creative-market.md` §12 names it as a failure mode to watch for and prescribes
fixing the step order first. The companion window is the fix after that one.

The founder's word for it is the sidebar. In code, UI and docs the word is **companion
window**, for the same reason the vocabulary table exists: the thing that docks to the side
of a browser is form B, which is not what gets built first, and calling form A a sidebar
would make every later sentence about form B ambiguous.

**What it is:** a second view of the handoff the creator already has, placed where they can
read it while typing into the marketplace.

**What it is not:** an agent on the marketplace's page. It fills nothing, clicks nothing,
reads nothing back, and holds no marketplace session. `docs/decisions/0010` records which
clause of whose terms forbids each of those, for Behance, Adobe and Creative Market. That
list is the reason the constraint is absolute rather than cautious.

---

## 2. What opens this step

B11 does not open on a schedule. It opens on a finding.

| Condition | Where it comes from | State today |
|---|---|---|
| The handoff exists and its step order matches the marketplace's editor | A8 | not built |
| Creators were watched using it, with the order already right | A8's exit run, and the three-creator test in `docs/channels/creative-market.md` §12 | not run |
| They still lose their place between windows | the same two | unknown |

All three, or this stays a document. The failure mode has a cheaper fix ahead of it, and
`docs/decisions/0010` says to try the cheap one first: if the order is wrong, fix the order.
A companion window over a badly ordered handoff hides the defect instead of removing it.

There is a second, weaker signal worth recording if it appears: a creator who keeps the
Fanwise tab and the marketplace tab side by side by hand, resizing both, is asking for this
without saying so. Note it in the session record; it is not on its own enough to open B11.

**If the finding never arrives, close this file rather than leaving it open.** A plan that
waits forever for evidence becomes a plan somebody eventually builds because it is there.

---

## 3. What A8 owes this step, and it is one rule

The handoff is **one component that does not assume the width of a full page**. It takes its
data as props, renders at any width from about 320 pixels up, and reads nothing from the
route it happens to sit in.

That is the whole ask, it costs a layout rule rather than scope, and it is already written
into `docs/channels/creative-market.md` §10. If A8 builds the handoff as a page instead,
B11 begins with a refactor of a screen that creators have already been tested against, which
is the expensive order to do this in.

Concretely, for A8:

- `components/channels/handoff-panel.tsx`, or whatever it is named, owns the steps, the copy
  buttons, the downloads, the mark-submitted control and the URL capture.
- `app/[slug]/[productSlug]/channels/[connectionId]/page.tsx` composes it and supplies data.
- No `window`, `document` or route hook reached for outside an effect, because in B11 this
  component renders into a document that is not the one it was mounted from.

---

## 4. Form A, the pop-out, which is what B11 builds

A button on the handoff opens the same handoff in a small always-on-top window, using the
Document Picture-in-Picture API. The window is a same-origin document of the page that
opened it: same session, same data, no install, no store review, no second authenticated
client, and no change to ADR 0007's headers, because a pop-out is not a frame.

```
  HANDOFF · Aster Grotesk                    [ Pop out ↗ ]
```

```
   ┌─ Creative Market ─────────┐  ┌─ Fanwise ────────────┐
   │                           │  │ CREATIVE MARKET      │
   │  [ the marketplace's own  │  │ Aster Grotesk        │
   │    editor, untouched ]    │  │                      │
   │                           │  │ 1 Category   [copy]  │
   │                           │  │ 2 Files  [download]  │
   │                           │  │ 3 Name       [copy]  │
   │                           │  │ …                    │
   │                           │  │ [ Mark submitted ]   │
   └───────────────────────────┘  └──────────────────────┘
        the creator's browser         the companion window
```

### 4.1 Mechanics

- **Opening.** `documentPictureInPicture.requestWindow({ width, height })`, called from the
  click handler. It needs transient user activation, so it cannot be opened on load, on a
  readiness change, or after an `await` that outlives the activation.
- **Rendering.** `createPortal(<HandoffPanel … />, pipWindow.document.body)`. One component,
  one instance of the data, two possible documents. Section 5 constraint 5 is satisfied
  structurally rather than by discipline.
- **Styles.** The pop-out's document starts with no stylesheets. Copy them at open:
  `adoptedStyleSheets` from the opener where the sheet is constructable, and clone the
  `<link rel="stylesheet">` and `<style>` nodes where it is not. Copy the `data-theme`
  attribute and the class list from `<html>` too, or the window opens in the wrong theme.
- **Closing.** `pagehide` on the pop-out window puts the handoff back inline and returns the
  button to its resting state. Closing the opener closes the pop-out; the reverse is not
  true, so nothing may live only in the pop-out's state.
- **One per tab.** Opening a second replaces the first. Two products cannot be handed off
  at once, which is correct: the marketplace editor cannot either.
- **It cannot be navigated.** No links out of it. The product name is text, not a link back
  to the product page.
- **Feature detection, never user agent.** `"documentPictureInPicture" in window`. Where it
  is absent the button is not rendered at all and the full page is the handoff. That is
  invariant 8's rule applied one level down: the UI does not offer what cannot be done.

### 4.2 The two things that decide whether it is any good

Both are **[verify]** at build, both have a known fallback, and neither is allowed to become
a reason to touch the marketplace's page.

1. **Copy buttons must work from the pop-out.** `navigator.clipboard.write` requires a
   focused document, and the creator's focus will usually be in the marketplace window. If
   a click inside the pop-out focuses it reliably enough for the write to succeed, the
   buttons work unchanged. If it does not, the fallback is a selectable, pre-selected text
   field per step, which is worse but honest. Creative Market's description needs a
   `ClipboardItem` carrying `text/html` as well as `text/plain`, because the target is a
   rich-text editor; `docs/channels/creative-market.md` §6. Test that one specifically.
2. **Files.** Downloads work from the pop-out the way they work anywhere. Whether an image
   can be *dragged* from the pop-out into the marketplace's upload control is the open
   question: the mechanism would be a `DownloadURL` entry on the drag's `DataTransfer`,
   which is Chrome-only and undefined across windows. Try it, and if it does not work in one
   afternoon, stop. **Download is the supported path and the drag is a nicety.** A creator
   who has to download eight screenshots and upload them is in exactly the position they are
   in today.

### 4.3 Size and layout

Open at roughly 420 by 720, remembering nothing across sessions: the site cannot position
the window, and pretending otherwise produces a preference that has no effect. The panel
must already render correctly at 320 wide because the creator can resize it smaller, and
that width is A8's layout rule paying for itself.

Inside, the only difference from the page is density: no page chrome, no navigation, no
product header beyond the name, and the readiness count kept, because it is the one number
that tells a creator whether to be in this window at all.

---

## 5. The constraints, as things a test can fail

`docs/decisions/0010` states five. Here they are as checks, because a constraint nobody can
fail is a preference.

| # | Constraint | How it fails CI |
|---|---|---|
| 1 | Never reads, writes or scripts a marketplace's page | The repo contains no content script, no extension manifest, and no marketplace origin in any host or connect list. A unit test reads the CSP's `connect-src` and asserts the origin set is unchanged from ADR 0007's |
| 2 | Holds no marketplace credential or session | Nothing new is added to the credential model; there is no new client to hold one. Invariant 7's existing tests stand |
| 3 | Captures only what the creator hands it | The URL field is the same field, the same server action and the same validation as the web handoff's. One code path, asserted by the component test rendering both hosts |
| 4 | Every row it writes is `self_reported` | Nothing here writes a row the handoff did not already write. The trigger that refuses `verified` on an assisted channel is untouched and its db test stands |
| 5 | Same data, same component as the web page | The pop-out renders the same component through a portal. A test asserts there is exactly one handoff component in the tree |

Constraint 1 deserves one more sentence. The temptation this design creates is small and
specific: having got the window beside the editor, it is one short step to read the
marketplace's page to check whether the creator pasted the right thing. That is a content
script, it is the thing the terms forbid, and the fact that it would be helpful is not a
defence. If a future session finds itself wanting it, the answer is the URL capture that
already exists.

---

## 6. What is not built

- **No new table, no migration, no new server action.** B11 is a layout. If it needs a
  schema change, something has been misread.
- **No new capability.** The capability matrix does not move, and an assisted adapter still
  implements no `publish`. `docs/channel-adapters.md` is untouched.
- **No extension**, of either kind. Form B is section 8.
- **No mobile story.** Document Picture-in-Picture is desktop only, and a creator filling in
  a marketplace form on a phone is not a case this product serves yet.
- **No persistence of window state**, per 4.3.

---

## 7. Testing

**Unit and component.** The handoff renders identically into a detached document and into
the page, given the same props. Copy writes both `text/plain` and `text/html` for the
description. The pop-out button is absent when the API is absent. The CSP origin set is
unchanged.

**E2E.** Playwright drives Chromium with `--auto-open-devtools-for-tabs` off and the
Document PiP API available; the spec opens the pop-out, asserts the handoff's steps are
present in the second window's document, copies one field, and closes it. If driving a
Document PiP window proves unreliable under Playwright, assert up to the API call and cover
the rest in the manual run rather than writing a test that passes for the wrong reason.

**Journey.** This is **not a fourteenth journey.** It is journey 7 run in the companion
window, and `docs/testing.md` gets a line saying so. A new journey number would imply a new
path from empty workspace to live listing, and there is not one.

**Manual, on the exit run.** Chrome and Edge at their current versions, Firefox if 0010's
support claim holds (**[verify]**, by feature detection on the day, not by release notes),
and Safari confirmed absent so the button is confirmed hidden.

---

## 8. Exit test

One creator, one real product, one assisted channel, on a machine where the API exists.
They open the companion, put it beside the marketplace's editor, and carry the product
through to a live listing without returning to the Fanwise tab until they paste the URL.

Two measures, both from `docs/channels/creative-market.md` §12 so the numbers compare:

- Time from first upload to live listing, against the under-fifteen-minutes target and
  against whatever A8's run actually recorded.
- Whether they lost their place between windows. This is the one the step exists for, and
  the honest outcome is a yes or no from a screen recording, not a metric.

**If the time does not improve and they still lose their place, revert it.** The button is
one component and a feature check; removing it is a smaller change than adding it was. A
companion window that does not fix the failure mode it was built for is two ways to read the
same handoff, and the second one has to be maintained forever.

---

## 9. Open questions, to answer at build

1. Do clipboard writes succeed from a Document PiP window when the creator's focus has been
   in another window? Section 4.2.
2. Does a formatted-text `ClipboardItem` survive into Creative Market's description editor
   from the pop-out, as it does from the page?
3. Can a file be dragged from the pop-out into a marketplace upload control, in Chrome, at
   all? Timeboxed; download is the answer if not.
4. Does 0010's Firefox 151 support claim hold? It was written from a support table, not from
   a browser.
5. Does the pop-out survive the opener navigating within the app, or does the creator lose it
   by clicking something in the background tab? If it dies, the button must restore cleanly.
6. Under Playwright, can a Document PiP window be addressed as a page or a frame? Section 7.

---

## 10. Form B, the extension side panel, and what it would take

Not in B11. Recorded so that a later session does not rediscover the cost.

Form B docks rather than floats, and it can take the listing URL from the current tab with a
click instead of a paste. Those are its two advantages and they are conveniences. Against
them:

- It **cannot frame the Fanwise app**. ADR 0007 sends `frame-ancestors 'none'` and
  `X-Frame-Options`, correctly, so the panel would render the handoff itself from an API and
  sign in on its own. That is a second authenticated client, and it needs its own section in
  `docs/security.md` before it ships, not after.
- Chrome Web Store review on every release. Separate packaging for Firefox's sidebar.
  Nothing for Safari.
- Reading the current tab's address needs the `activeTab` grant, which Chrome gives on a
  click of the extension's own toolbar action, context-menu item or shortcut. A click inside
  the panel does not grant it. This stays within constraint 3 only because the creator's
  click on the extension's own control is the handing-over.

**Form B opens only if form A has been built, used, and found wanting, and then as its own
decision with its own ADR.** Wanting to dock is not found wanting.

---

## 11. Billing

Nothing here changes what is charged. It is one more piece of evidence for decision 16,
assisted versus automatic pricing: an assisted channel that is one uninterrupted flow is
easier to charge the same $6 for than one that is two windows and a clipboard. Record which
way the exit run points, in `docs/decisions/0002` under 16, rather than deciding it here.
