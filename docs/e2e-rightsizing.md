# Right-sizing the E2E suite

12 September 2026. Branch `chore/rightsize-e2e-suite`, from `origin/main` at `ccb78d6`.

The Playwright suite went from **111 tests to 47**. No production code, schema, migration,
dependency or copy changed. Every removed test is accounted for below: its guarantee either
already lived at a lower layer, was moved there in this change, or was folded into a browser
journey that was kept. `docs/testing.md` says what the suite is for now.

## Measurements

| | Before | After |
|---|---|---|
| Playwright tests | 111 in 18 files | 47 in 18 files |
| Local run, `CI=1`, one worker, retries 2 | 5.2 min (282 s in tests) | 2.3 min |
| Flaky or retried | 0 | 0 |
| Unit tests (`pnpm test`) | 1,206 in 68 files | 1,286 in 77 files (+80) |
| Database tests (`pnpm test:db`) | unchanged | unchanged |

The brief was written against 104 tests. `not-found.spec.ts` (7 tests, PR #80) landed after
it; its four width checks were then folded into one of its own tests, so the planned 44 is 47
here. CI timings are in the pull request,
measured from GitHub Actions rather than extrapolated from local hardware.

Before, the slowest files were `catalog.spec.ts` (47 s), `journey-01-product.spec.ts` (36 s),
`import-journey.spec.ts` (27 s), `journey-05-publish-everywhere.spec.ts` (27 s) and
`journey-14-public-pages.spec.ts` (25 s). Most of that was setup: every test except journey
1's signup signed a new account up through the form, renamed the workspace through
Settings, and then built the same product, uploads and listing the test beside it had just
built.

## How the cuts were made

- **Keep** — a critical journey that needs a running application.
- **Consolidate** — the assertion now runs inside a kept journey that already stands on that
  page, so the browser still proves it without its own account, product and uploads. Used
  where the guarantee genuinely needs a browser (a drop event's cancellation, sideways
  overflow, Tab order, a click-driven client computation) or where a server round trip is
  the point.
- **Move** — the guarantee is decided by logic, rendered markup or a source rule, and is now
  proved in `tests/unit` or `tests/db`, for every case rather than the one a browser reached.
  "Existing" means it already was, and the browser test was redundant.

Unit tests here run in Node with no DOM (`vitest.config.mts`, no jsdom or Testing Library),
and adding either was out of scope. So nothing that needs a real event, layout or focus was
moved below the browser; those were consolidated instead. Where a server component or
client handler cannot be rendered in Node, its wiring is pinned by reading its source,
which is the pattern `tests/unit/settings-page.test.ts` and `tests/unit/marketing.test.ts`
already use.

Every new unit test was checked against a deliberately broken copy of the code it guards
(the proxy redirect, the only-buyer-file guard, the listing card's publish gate, the
required mark, the importer's server refusal); each failed, and the production files were
restored before committing.

**Totals for the 64 removed tests:** 47 consolidated into kept journeys, 11 moved to a lower
layer, 6 removed as redundant (already proved at the right layer, nothing new needed). 60
were in the brief; the other four are `not-found.spec.ts` width checks.

**Setup.** Only `journey-01-signup.spec.ts` signs up through the form. Every other test
starts from `newCreator` (`tests/e2e/support.ts`): a unique account from the local auth
admin API, a real sign-in through the form, and the workspace provisioned by the production
`/onboarding` route under that session. Workspace names are written directly. The helper
refuses any Supabase URL that is not local. `security-headers.spec.ts` keeps its own signup
because that file is held byte for byte as it was.

## Rejected or changed after audit

- **Every signed-out redirect test was on the removal list** (catalog, journey 9, journey 14,
  settings, both importer tests, smoke). The proxy's redirect had no test at any lower layer:
  only `isPublic` was tested. Removing them all as written would have left the redirect
  unproven. Kept instead: a stranger in its own browser context is sent to sign in from a
  private workspace inside journey 9, and `tests/unit/proxy.test.ts` runs the real proxy
  over every private route.
- **Pricing arithmetic could not move to a unit test.** The calculator and landing picker
  keep their own constants and compute inside client components; proving the clicks below
  the browser needed a production change or a DOM library. The clicks are consolidated into
  the kept marketing journey, and a unit test pins the constants to `lib/billing/rules.ts`.
- **`/reset-password` stating the link is gone is not implied by the kept spent-link test**,
  which never loads that page. It is folded into that test explicitly.
- **The canonical-title pull** was folded with a canonical title distinct from the product
  name, as the original test had, so it still proves the pull reads the canonical record.
- **A trailing-slash canonical redirect** is not in `proxy.test.ts`: a running Next server
  strips the slash before the proxy is called, and a hand-built `NextRequest` does not, so a
  unit assertion would test the harness. Journey 14 asserts it against the server.
- **`security-headers.spec.ts` keeps all its tests, untouched.** `not-found.spec.ts` keeps
  every assertion; see its own section below.

## Test by test

Paths are under `tests/`. "Kept journey" names the retained test an assertion now runs in.

### catalog.spec.ts

| Original E2E test | Disposition | Destination | Guarantee preserved | Why that layer |
|---|---|---|---|---|
| the catalog says what is here, where it is live, and what to do next | Keep | — | Live count, next action, keyboard tip | Needs a real publish and a rendered row |
| search narrows the catalog, says so, and clears back to all of it | Keep | — | Search, count sentence, clear | URL-driven server render |
| the status filter only ever shows products that are in that state | Keep | — | Filter and fallback | URL-driven server render |
| search never reaches another workspace's catalog | Move (existing) | `db/product-tenancy.test.ts` | One workspace cannot select another's products; the catalog reads through RLS | Isolation is a database property; journey 9 covers the browser |
| a long product name does not push the row sideways, in either theme | Consolidate | Kept: status filter (320–1280 px, both themes); `unit/catalog-page.test.ts` wrap classes | No sideways overflow with a long name | Overflow is layout; only a browser measures it |
| every row's action stays reachable and tappable on a phone | Consolidate | Kept: catalog says what is here (360 px box and tap) | Row action on screen and not swallowed by the row link | Hit-testing needs a browser |
| a product with nothing built is offered the thing that builds it | Consolidate | Kept: status filter; `unit/catalog.test.ts` label and href | "No listings yet", no tip, Build listings offered | Label logic is unit; the row is read in place |
| no search results is not an empty workspace | Consolidate | Kept: search | Count sentence, not first run, Show all products | Same page the search journey loads |
| one primary action, and it goes to this workspace's new-product route | Consolidate | Kept: search | One Add product, href, no competing link | Read on a page already loaded |
| the keyboard reaches the controls, then each row, in the order they are read | Consolidate | Kept: search | Tab order header → Add product → controls | Real focus needs a browser |
| a signed-out visitor never reaches a catalog | Move (new) | `unit/proxy.test.ts`; kept journey 9 stranger | No session → sign in | Proxy decision is unit-testable; one browser proof kept |

### first-run.spec.ts

| Original E2E test | Disposition | Destination | Guarantee preserved | Why that layer |
|---|---|---|---|---|
| an empty workspace offers one primary action, an honest import and the path | Keep | — | First-run screen and its one action | Integrated first visit |
| fits phone and tablet widths without sideways scrolling | Consolidate | Kept: first run (320–768 px) | No overflow, CTA above graphic, 44 px nav targets | Layout needs a browser |
| the keyboard reaches the header, then the primary action, then import | Consolidate | Kept: first run | Tab order | Real focus needs a browser |
| once a product exists the catalog is the normal dashboard | Consolidate | Kept: `journey-01-product` create; catalog search | Products h1, list, Add product, no first run | Both journeys already create products |

### journey-01-product.spec.ts

| Original E2E test | Disposition | Destination | Guarantee preserved | Why that layer |
|---|---|---|---|---|
| a creator signs up, gets a workspace, and creates a product | Keep (renamed "a creator gets a workspace and creates a product") | — | Create, theme carries, catalog becomes dashboard | Signup itself is journey-01-signup |
| the canonical record saves and survives a reload | Keep | — | Save persists | Server round trip |
| a creator drops an image onto the product's images panel | Keep | — | Drop reaches handler, upload lands, cover | Dispatched drop needs a browser |
| a creator drops a file into the Files section | Keep | — | Drop filed as selected type | Dispatched drop needs a browser |
| a repeated image says which one it repeats | Consolidate | Kept: images panel; new `unit/duplicate-image-label.test.ts` | Same bytes, other name → "Same image as the cover", once | Checksum needs a real upload; wording is unit |
| a file dropped on the input itself uploads once, not twice | Consolidate | Kept: Files section | One file in, one row | Real upload |
| a creator drops an image onto the dashed Add-images tile | Consolidate | Kept: images panel (second drop is on the tile) | Drop bubbles from label to section | Event bubbling needs a browser |
| required fields carry a mark, and optional ones do not | Move (new) | `unit/required-marks.test.ts` | Sign-up, new-product and Field marks; Brand name unmarked; mark aria-hidden | Pure markup |
| the guard leaves a native file input alone | Consolidate | Kept: images panel | Drop on file input not cancelled | Window listener in an effect needs a browser |
| the Files section draws a single outline around controls and list | Consolidate | Kept: Files section | Input and empty state in one box | Read on a page already loaded |
| a file dropped off-target is refused rather than opened | Consolidate | Kept: images panel | Stray drop cancelled, page survives | Window listener in an effect needs a browser |

### journey-01-signup.spec.ts

| Original E2E test | Disposition | Destination | Guarantee preserved | Why that layer |
|---|---|---|---|---|
| a new creator signs up and lands in a provisioned workspace | Keep | — | The one real signup | Critical journey |
| the root, a replayed onboarding and a new session all resolve to the one workspace | Consolidate | Kept: signup; `db/workspace-provisioning.test.ts` | `/`, two replays, new session → same workspace | Redirect chain needs a server; idempotency is db |

### journey-03-channels.spec.ts

| Original E2E test | Disposition | Destination | Guarantee preserved | Why that layer |
|---|---|---|---|---|
| one product yields two independent listings, judged by different rules | Keep | — | Two listings, two verdicts | Integrated |
| disconnecting a channel takes its listings with it | Keep | — | Cascade seen by the creator | Integrated |
| the assisted channel never offers publishing, anywhere | Consolidate | Kept: two listings (assisted card); new `unit/listing-panel.test.ts` every liveness | No publish affordance for an assisted channel | Rule is markup; one browser read kept |
| a channel states what it cannot do before it is connected | Move (new) | `unit/capability-list.test.ts` | Every capability line and absence for both mock adapters | Pure render of declared capabilities |

### journey-04-listing-editor.spec.ts

| Original E2E test | Disposition | Destination | Guarantee preserved | Why that layer |
|---|---|---|---|---|
| a creator hand-writes a listing and watches readiness resolve | Keep | — | Live readiness, save, reload | Client state plus server |
| two channels judge the same hand-written copy differently | Keep | — | Independent verdicts and rows | Integrated |
| a field can be pulled from the canonical product on purpose | Consolidate | Kept: hand-writes (distinct canonical title) | Pull restores the canonical title | Server action plus client mirror |
| a listing the channel would reject still saves, so the reason stays visible | Move (existing + new) | `unit/listing-editor.test.ts` schema and message, `db/listing-editing.test.ts` storage | Rejectable copy saves; reason and note shown | Schema, rule and storage are below the browser |

### journey-05-publish-everywhere.spec.ts

| Original E2E test | Disposition | Destination | Guarantee preserved | Why that layer |
|---|---|---|---|---|
| one click publishes what it can and names what it skipped | Keep | — | The A7 journey | Integrated |
| a second run sends nothing again, and says why | Consolidate | Kept, after reload; `db/publication-idempotency.test.ts` | Nothing to send, button disabled, one link | Idempotency is db; one browser proof |
| the activity log records what the run did | Consolidate | Kept, after reload; `db/publish-runs.test.ts` | Empty log, then run and settled job | Records seen by the creator |
| offers nothing to press when no connected channel can publish | Consolidate | Kept (assisted-only phase first); `unit/publish-run.test.ts`; `unit/listing-panel.test.ts` gate pin | Region absent until a publishable channel connects | Gate is logic; one browser read kept |

### journey-05-publish.spec.ts

| Original E2E test | Disposition | Destination | Guarantee preserved | Why that layer |
|---|---|---|---|---|
| a product publishes, and clicking publish again creates nothing | Keep | — | The A5 journey | Integrated |
| a listing that is not ready cannot be published | Consolidate | Kept (before uploads); `unit/listing-panel.test.ts`; `unit/channels.test.ts` readiness | Publish disabled with a reason | Readiness is unit; one browser read kept |
| an assisted channel never offers to publish | Consolidate | Kept: Publish Everywhere and channels journeys; `unit/listing-panel.test.ts` | No Publish on an assisted card | Duplicate of journey 3's rule |

### journey-09-tenancy.spec.ts

| Original E2E test | Disposition | Destination | Guarantee preserved | Why that layer |
|---|---|---|---|---|
| workspace A cannot reach workspace B by URL | Keep | — | 404, nothing leaks | Journey 9, never skipped |
| workspace A cannot reach workspace B's product by URL | Keep | — | 404, nothing leaks | Journey 9, never skipped |
| an anonymous visitor cannot reach a workspace by URL | Consolidate | Kept: A cannot reach B (stranger context); `unit/proxy.test.ts` | No session → sign in, nothing shown | Browser proof kept; every route in unit |
| a workspace that never existed is indistinguishable from one that is not yours | Consolidate | Kept: A cannot reach B | Same 404 and headline | Status code needs a server |

### journey-14-public-pages.spec.ts

| Original E2E test | Disposition | Destination | Guarantee preserved | Why that layer |
|---|---|---|---|---|
| a creator publishes a profile and a stranger reads it | Keep | — | Draft 404, published 200, nothing private | Anonymous render |
| renaming a handle leaves the old address working | Keep | — | Old handle redirects | Server redirect |
| unpublishing removes the page from the public web | Keep | — | 404 after unpublish | Server status |
| the marketing site and the application still resolve alongside the public web | Consolidate | Kept: stranger reads (sitemap, robots); `unit/proxy.test.ts` public paths; new `unit/robots.test.ts`; `marketing.spec.ts`; journey 9 | Sitemap lists `/@handle`, not `/profile/`; robots disallows it; public paths reachable; app needs a session | Sitemap reads the database; the rest is proxy logic |
| the public URL keeps its shape, and the internal one is not a second address | Consolidate | Kept: rename (capitals, trailing slash, `/profile/`, canonical tag); `unit/public-routing.test.ts`; `unit/proxy.test.ts` 308 | One canonical address | Rewrite plus redirect need a server |
| a reserved or malformed handle is refused while the creator types | Consolidate | Kept: rename (reserved, Save disabled); `unit/public-handles.test.ts` every message | Live refusal and its words | Wiring needs a browser; rules are unit |

### journey-settings.spec.ts

| Original E2E test | Disposition | Destination | Guarantee preserved | Why that layer |
|---|---|---|---|---|
| each save button belongs to its own section and waits for a change | Keep | — | Independent sections | Client state plus server |
| an icon is staged, validated and only stored when the section is saved | Keep | — | Staging and storage | File input plus storage |
| changing the email address reports a confirmation rather than a completed change | Keep | — | Honest outcome | Auth server |
| subscription shows the workspace's real state and no save button | Keep | — | Real billing state | Integrated |
| one creator cannot open another creator's settings | Move (existing) | `db/tenancy.test.ts`; journey 9's layout 404 | Another workspace unreadable | Same layout guard as journey 9 |
| the address is shown, fixed, and does not break routing | Consolidate | Kept: save buttons; `unit/settings-page.test.ts` | Address shown, Copy, URL unchanged after rename | Markup is unit; rename round trip in browser |
| changing a password sends a link rather than taking a new password here | Consolidate | Kept: email change; `unit/settings-page.test.ts` no password input | Link sent or honestly not, no raw error | Auth server |
| the page is reachable by keyboard and fits a phone | Consolidate | Kept: subscription | Controls focusable, no overflow at 390/768 | Focus and layout need a browser |
| an invalid name is explained next to the field and keeps what was typed | Consolidate | Kept: save buttons | Blank name and bad email disable save, value kept | Client form state |
| the page is four sections, and Access is not one of them | Move (existing) | `unit/settings-page.test.ts`; signup journey (Settings aria-current) | Sections, order, save buttons, no Access | Pure markup |
| an unauthenticated visitor cannot reach settings | Move (new) | `unit/proxy.test.ts`; `unit/settings-page.test.ts` page check | No session → sign in | Proxy logic |

### marketing.spec.ts

| Original E2E test | Disposition | Destination | Guarantee preserved | Why that layer |
|---|---|---|---|---|
| every marketing page is reachable without an account | Keep | — | Every page 200 signed out | Server |
| the light and dark view survives a navigation | Keep | — | Theme before hydration | Browser |
| the landing picker prices the shops a visitor selects | Consolidate | Kept: reachable; `unit/marketing.test.ts` constants | $21 → $27 on a click | Client computation; constants pinned |
| every Get started on the site reaches the account form | Consolidate | Kept: reachable (every nav CTA href, one click through) | CTAs go to `/sign-up` | Rendered links read in place |
| the pricing calculator does the arithmetic the billing model states | Consolidate | Kept: reachable; `unit/marketing.test.ts` constants and `estimate` | Monthly, annual, tiles, clamps | Client computation; constants pinned |
| the nav reaches every page it links to | Consolidate | Kept: reachable | Nav links land on rendered pages | Client navigation |
| /start sends a visitor to the real account form | Move (existing) | `unit/marketing.test.ts` | `/start` redirects to sign-up, no form | Source rule |

### password-recovery.spec.ts

| Original E2E test | Disposition | Destination | Guarantee preserved | Why that layer |
|---|---|---|---|---|
| the answer is identical for a registered and an unregistered address | Keep | — | No account oracle | Auth server |
| a spent or forged link explains itself instead of failing silently | Keep | — | Safe failure | Auth server |
| a malformed address is rejected without claiming anything was sent | Move (new) | `unit/password-reset-request.test.ts` | Refused, `sent: false`, auth server never called | The server action is what was under test |
| a signed-out creator can reach the reset form from sign in | Consolidate | Kept: identical answer (starts from sign in) | Link from sign in | Read on the way through |
| the reset page states the link is gone rather than bouncing to sign in | Consolidate | Kept: spent link; `unit/proxy.test.ts` | Stays on `/reset-password` with its message | Session-less render |

### product-link-import.spec.ts

| Original E2E test | Disposition | Destination | Guarantee preserved | Why that layer |
|---|---|---|---|---|
| the importer opens from the new-product page and says what it is | Keep | — | Entry point | Integrated |
| a pasted link becomes an import that survives a refresh | Keep | — | Persistent import | Job and database |
| a failed import can be retried, and readiness never claims the source is done | Keep | — | Honest retry | Job and database |
| importing the same link twice opens the import that exists | Keep | — | Idempotent import | Database |
| the screen widens without ever scrolling sideways | Consolidate | Kept: opens (every width, both themes) | No overflow | Layout needs a browser |
| no other route was widened | Move (new) | `unit/import-screen.test.ts` | Only the import chrome carries the wide canvas; layout keeps 1160 px | One CSS rule and one attribute |
| the bad shapes are refused before anything is fetched | Consolidate | Kept: opens (http case); new `unit/import-refusals.test.ts` | All three refused with their words, server touches nothing | Validator and action are unit |
| an import id from another workspace is not found rather than forbidden | Consolidate | Kept: pasted link; `unit/import-deliverables.test.ts` page pin; `db/product-import.test.ts` | Not found for an unknown id | RLS is db; page answer in browser |
| the gutters are the wide ones on a desktop and the narrow ones on a phone | Consolidate | Kept: opens | 48+/64/24 px | Computed style needs a browser |
| a signed-out visitor cannot reach the importer | Move (new) | `unit/proxy.test.ts` | No session → sign in | Proxy logic |
| a signed-out visitor cannot reach somebody's import | Move (new) | `unit/proxy.test.ts`; page session check pinned | No session → sign in | Proxy logic |

### import-journey.spec.ts

| Original E2E test | Disposition | Destination | Guarantee preserved | Why that layer |
|---|---|---|---|---|
| a creator goes from a pasted link to the marketplace drafts | Keep | — | The import journey | Integrated |
| the master listing stays canonical and the marketplace drafts derive from it | Keep | — | One canonical record | Integrated |
| a private link offers a way out and never reads as imported | Keep | — | Safe recovery | Integrated |
| replacing the source keeps everything and shows what changed | Keep | — | Work survives a replaced link | Integrated |
| a failed replacement upload leaves the file that was already there | Move (new) | `unit/import-deliverables.test.ts` | Only ready file cannot be removed until a replacement is ready | The guard is the action's decision |
| another workspace cannot reach, read or act on an import | Move (existing) | `db/product-import.test.ts`; journey 9 | Read, insert, update, attest, license refused | Isolation is a database property |
| the whole flow works on a phone, without scrolling sideways | Consolidate | Kept: replacing the source (runs at 390 px) | No overflow, gate action on screen | Layout needs a browser |

### smoke.spec.ts

| Original E2E test | Disposition | Destination | Guarantee preserved | Why that layer |
|---|---|---|---|---|
| the health endpoint answers | Keep | — | Deployment answers | Server |
| the root serves the marketing site to an anonymous visitor | Move (existing) | Kept `marketing.spec.ts` reachable | `/` is the landing page signed out | Already asserted by a kept journey |
| an anonymous visitor is still turned away from the app | Move (new) | `unit/proxy.test.ts` (onboarding); journey 9 stranger | No session → sign in | Proxy logic; one browser proof kept |

### not-found.spec.ts

Not in the original brief; added by PR #80 after it was written. Its account setup moved to
`newCreator`, and its four width checks were folded into the test that already loads the same
unknown URL signed out.

| Original E2E test | Disposition | Destination | Guarantee preserved | Why that layer |
|---|---|---|---|---|
| an unknown URL answers 404 with the not-found page | Keep | — | 404, title, links, shared shell | Server status and render |
| a signed-in creator on an unknown workspace gets the same page, hydrated and clean | Keep | — | Hydrates under the nonce policy, no errors | Browser |
| go to dashboard asks a signed-out visitor to sign in | Keep | — | Link goes to sign in | Navigation |
| does not scroll sideways at 320px | Consolidate | Kept: unknown URL answers 404 | No overflow, fresh load at the width | Layout needs a browser |
| does not scroll sideways at 390px | Consolidate | Kept: unknown URL answers 404 | No overflow, fresh load at the width | Layout needs a browser |
| does not scroll sideways at 768px | Consolidate | Kept: unknown URL answers 404 | No overflow, fresh load at the width | Layout needs a browser |
| does not scroll sideways at 1280px | Consolidate | Kept: unknown URL answers 404 | No overflow, fresh load at the width | Layout needs a browser |

### Unchanged

`security-headers.spec.ts` (7 tests) is byte for byte as it was.
