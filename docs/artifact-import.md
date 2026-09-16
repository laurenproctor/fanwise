# Importing a Claude artifact

The plan for turning a Claude artifact into a Fanwise product listing, now that the link
importer shipped in PR #78 has shown that the link on its own cannot do it.

**Status: planned 12 September 2026 at the founder's request. Not opened.** Two paths, and
they are not equal:

- **Bring the artifact** (§7) can be built now. The creator exports their own artifact with
  Claude's Copy or Download button and hands it to Fanwise.
- **The browser extension** (§8) is **blocked**. Anthropic's terms prohibit it unless
  Anthropic explicitly permits it (§3). It is planned in full so that it is ready the day
  permission is granted in writing, and not a day before.

The server contract in §6 is shared by both paths, so building the first path first
wastes none of the second.

---

## 1. What this is, and why the link could not do it

PR #78 imports a product from a public web page. For ordinary product pages it works. For
the use case the feature was named after — pasting a Claude artifact link — it cannot
work, and the reason was established from a real artifact rather than assumed.

Tested 12 September 2026 against `https://claude.ai/code/artifact/cfe57222-d5aa-4c49-9f72-f70b505596de`:

| What was checked | What came back |
|---|---|
| The artifact page | `200`, 17,992 bytes — **the same size as the page for an id that does not exist**. Title, description and share image are the generic "Claude Artifact" boilerplate on every artifact |
| The page's own robots meta tag | `<meta name="robots" content="noindex, nofollow">` |
| Where the content actually loads from | The page's inline script requests `claude.ai/api/frame/<id>` and renders the result in an iframe on `<id>.frame.claudeusercontent.com` |
| `claude.ai/robots.txt` | `User-Agent: *` → `Disallow: /api/*` |
| `claude.site/robots.txt` | `User-Agent: *` → `Disallow: /`. Only share-card crawlers are allowed |
| The frame hosts, requested directly | `404 not found` at the root, and no robots.txt of their own |
| The public artifact page | Loads hCaptcha |

So the page contains no artifact, and the only route to the artifact is `/api/frame/`,
which the site's robots.txt disallows for automated clients. `/api/frame/` was never
requested while this plan was researched, and nothing in this plan requests it.

**What PR #78 does with an artifact link today** is correct and should stay that way:
`lib/imports/sources/hosted-artifact.ts` recognises the boilerplate shell and refuses it with
`unsupported_source`, so it no longer builds a product called "Claude Artifact". This plan
turns that honest refusal into a way forward.

---

## 2. What opens this step

| Condition | State on 12 September 2026 |
|---|---|
| Link import shipped | true, PR #78, merge `9b55b37` |
| The founder decides whether the artifact is what buyers receive (§10, question 2) | open |
| **Extension path only:** written permission from Anthropic (§3) | not requested |

This is off-roadmap, as PR #78 was. `CLAUDE.md` names A8 as the current step, and Gate A has
not passed. It is proposed as **B13**, because PRs #73 and #74 have claimed B11 and B12. The
roadmap and the open-decisions register are deliberately left untouched here, so this PR
cannot conflict with those two while they are open. They gain an entry once #73 and #74
settle the numbering.

---

## 3. The terms, and what they block

ADR 0010 refused to build a marketplace extension because the marketplaces' written terms
forbid automation. It also refused the click-triggered version, on the grounds that "a
version where the creator clicks 'fill this field' and then publishes is the same act in
smaller pieces". The same test applies to Claude, and the terms were read rather than
assumed.

**Anthropic Consumer Terms, effective 8 October 2025,** under the uses that are not allowed:

> You may not access or use, **or help another person to access or use**, our Services in
> the following ways: … To crawl, scrape, or otherwise harvest data or information from our
> Services other than as permitted under these Terms. … **Except when you are accessing our
> Services via an Anthropic API Key or where we otherwise explicitly permit it**, to access
> the Services through automated or non-human means, whether through a bot, script, or
> otherwise.

Three consequences, stated plainly:

1. **An extension that scripts reading an artifact out of Claude is "automated or non-human
   means … script".** A creator clicking the button does not change what the script does.
2. **Fanwise shipping that extension is "help[ing] another person"** to do it. The
   restriction binds Fanwise as well as the creator.
3. **The terms themselves provide the way through:** "where we otherwise explicitly permit
   it". So the extension is not ruled out for good. It needs **explicit written permission
   from Anthropic**, recorded in this document before any extension code is written — the
   same rule ADR 0010 applies to a marketplace.

**And the terms support the path in §7.** §4 of the same terms: "Subject to your compliance
with our Terms, we assign to you all of our right, title, and interest—if any—in Outputs."
An artifact is the creator's Output. A creator copying or downloading their own artifact
with the controls Claude provides, and handing the result to Fanwise, is using their own
Output through permitted means. Nothing in that path touches Claude automatically.

This is a reading of the terms and not legal advice. If there is any doubt, counsel should
confirm the reading, or Anthropic should confirm it directly when permission is requested.

---

## 4. Constraints, which do not bend

These hold for both paths, and each one is written so a test can fail it.

1. **Fanwise never requests `claude.ai/api/*`, and never automates Claude.** No server
   fetch, no headless browser, no extension, until §3's permission exists. The server-side
   `hosted_artifact` importer reads only the page, as it does today, and refuses the shell.
2. **Fanwise never runs artifact code.** A pasted or uploaded artifact is untrusted text.
   It is parsed statically. It is never evaluated, rendered as a page, placed in an iframe,
   bundled or transpiled. The same rule as `lib/imports/retrieval/html.ts`.
3. **No Claude credential, cookie, session or conversation content ever reaches Fanwise.**
   Neither path needs one.
4. **The artifact is never served back from the Fanwise origin as a document.** Stored
   copies are downloaded as attachments, never rendered inline.
5. **Everything drafted from an artifact goes through the same claims check** as a page
   import. Code is evidence of what a tool does, not permission to invent a licence, a
   compatibility claim or a support promise.
6. **ADR 0010 is unchanged.** Nothing here reads, writes or scripts a marketplace's page.

---

## 5. The shape of one import

```
  BRING THE ARTIFACT (buildable now)

  creator pastes artifact link ──► PR #78 refuses the shell, as today
                                          │
                               "Bring the artifact instead"
                                          │
          ┌───────────────────────────────┴───────────────────────────────┐
          │  In Claude: Copy (code) or Download (file)                     │
          │  In Fanwise: paste the code, or drop the downloaded file       │
          └───────────────────────────────┬───────────────────────────────┘
                                          │  server action, as the signed-in creator
                                          ▼
                     validate size and shape ──► store as a `source_file` asset
                                          │
                     static extraction (§7.2) ──► ProductSourceEvidence
                                          │        capture.method = paste | upload
                                          ▼
                     compose job (no fetch) ──► claims check ──► suggestions
                                          │
                                          ▼
                     the import screen, as it already is
```

```
  THE EXTENSION (blocked on §3)

  creator views their artifact in Claude ──► clicks the toolbar button
                                          │
                     read the rendered artifact frame, in the creator's browser
                                          │
                     opens fanwise.vercel.app/?handoff=<nonce>
                                          │  the signed-in Fanwise page asks the extension
                                          ▼  for the payload that matches the nonce
                     the same server action, capture.method = extension
                                          │
                                          ▼
                     the same compose job, claims check and import screen
```

---

## 6. The shared server contract

Both paths end in one server action that accepts evidence that has already been extracted.
This is what makes §7 reusable by §8.

- **`importFromArtifactAction(workspaceSlug, input)`**, as the signed-in member through RLS,
  exactly as `startImportAction` is.
- **Input is Zod-validated and capped.** A pasted artifact: at most 1 MB of text. An
  uploaded one: the existing upload pipeline's limits, with the extraction reading at most
  the first 1 MB.
- **`ProductSourceEvidence` gains `capture: { method: "fetch" | "paste" | "upload" |
  "extension" }`** and a new `EvidenceOrigin` value, `"code"`. Evidence is jsonb and
  validated on read, so **no migration is needed** — `[verify]` against the generated types
  at build. `import_provider` stays `hosted_artifact`.
- **The content hash is computed on the server** from what arrived, never trusted from the
  client.
- **Idempotency is unchanged.** The artifact link, when given, is the `normalized_url` dedupe
  key. Without a link, the content hash stands in for it within the workspace.
- **The runner is split** so composing no longer depends on fetching. `runImport` becomes
  *retrieve* then *compose*, and an artifact import enqueues only *compose*. One new job
  name, `compose_import`, is registered the way `import_source` was — `lib/jobs/types.ts`,
  `handlers.ts`, `trigger/jobs.ts` — and the existing test that holds those three lists
  together fails until all three agree.
- **`unsupported_source` for a `hosted_artifact` source gains the recovery
  `bring_artifact`**, listed first. This replaces the paste-code recovery that PR #78 removed
  because it was not built.

---

## 7. Bring the artifact — buildable now

### 7.1 The creator's side

The refusal screen for an artifact link stops being a dead end:

> Claude doesn't let other apps read artifacts from a link. In Claude, open the artifact and
> use **Copy** or **Download**, then bring it here. Fanwise reads it and never runs it.

Two inputs, one step:

- A code box. Pasting is one click in Claude and one keystroke here.
- A drop zone for the downloaded file, through `lib/products/upload-client.ts`, the same
  helper the product page uses.

The artifact link the creator already pasted is kept as provenance. It is never a
deliverable.

### 7.2 What static extraction reads

Nothing below runs the artifact. Every value is read from text.

| Artifact kind | Read as | Observed values |
|---|---|---|
| HTML (a downloaded artifact is often one self-contained file) | **`lib/imports/retrieval/html.ts`, unchanged** | title, meta description, headings, list items, image references |
| React / JSX / TSX | a bounded lexer over JSX text and string literals | `<title>`, text inside headings, buttons, labels, `placeholder`, `aria-label`, `<option>`; the default export's component name |
| Markdown | headings and list items | title (first `#`), sections, bullets |
| SVG / Mermaid | text nodes and labels | a title and labels, where present |

**What is observed and what is inferred** has to stay honest here, because code invites
over-reading:

- **Observed (`origin: "code"`):** text the artifact would display to a person — a button
  saying "Export to CSS", a heading saying "Type Scale Studio".
- **Not observed, and never promoted to evidence:** what an imported library implies. An
  artifact importing a chart library has not thereby claimed a charting feature. That is at
  most a suggestion, marked `suggested` and reviewed, and the claims check still applies.

The extractor keeps the reader's discipline: a hard cap on bytes and on the number of
extracted strings, entities decoded once, control and bidirectional characters stripped,
and a failure mode that finds less rather than runs something.

### 7.3 Is the artifact what buyers receive?

This is the founder's decision (§10, question 2), and it changes one line:

- **If yes:** the stored artifact is also a `deliverable` and satisfies the Buyer files step.
  Selling a type-scale tool is selling its code.
- **If no:** it is a `source_file` only. It is evidence for the listing, and Buyer files is
  still a separate upload.

Until this is answered, the plan assumes **no**. A link has never satisfied Buyer files, and
an artifact that silently did would be a change nobody decided on.

### 7.4 Security

- **The pasted text is untrusted input from the creator's clipboard,** which may hold
  anything. It is capped, stored as bytes, parsed statically, and never executed.
- **The stored object is never rendered as a document.** Downloads set
  `Content-Disposition: attachment` (`createDownloadUrl`). The one inline route,
  `app/[slug]/assets/[assetId]/preview`, serves only `ready` assets whose sniffed type starts
  with `image/`, and `sniffMimeType` has no HTML signature, so an HTML artifact is stored as
  `application/octet-stream` and can never be previewed.
- **SVG is the exception, and it gets a rule.** `sniffMimeType` labels SVG `image/svg+xml`,
  so the preview route would serve it. An SVG can carry script. It would render from the
  storage origin rather than Fanwise's, and an `<img>` never runs SVG script, but a direct
  visit to the signed URL would. So an artifact stored by this path is **always recorded as
  `text/plain`, whatever it sniffs as**, and a test asserts that an SVG artifact's preview
  returns `404`.
- **No malware scanning exists in this repository.** An artifact kept as a *deliverable*
  (§7.3, if yes) would be the first creator-supplied code handed to buyers. That makes the
  quarantine requirement in `docs/product-link-import.md` §12 **a precondition of shipping
  the "yes" answer**, not a follow-up.

---

## 8. The extension — blocked on §3, planned in full

Nothing in this section is built until Anthropic's explicit permission is recorded in §3.

### 8.1 How it squares with ADR 0010

| ADR 0010 | Here |
|---|---|
| C1: never reads, writes or scripts a **marketplace** page | Holds. The only host permission is on `*.frame.claudeusercontent.com`. A manifest test fails on any marketplace origin |
| C2: holds no marketplace credential | Holds, and more: it holds **no credential of any kind** (§8.3) |
| C3: captures only what the creator hands it | Holds. It reads only on a click of its own toolbar button, and only the artifact in that tab |
| C4: every row `self_reported` | Not applicable. This is not a channel |
| C5: same component as the web page | Holds. The extension has no listing UI; the import screen does the rendering |
| "Pop-out before extension" | **Does not apply.** A pop-out is a Fanwise-origin window and cannot see another site's content. The two solve different problems |
| The click-triggered objection | **Applies in full**, which is why §3 gates this on permission |

This would be Fanwise's first extension. ADR 0010's form-B costs all apply: store review on
every release, separate packaging for Firefox, nothing for Safari, and an entry in
`docs/security.md` before it ships.

### 8.2 Permissions, and nothing more

| Permission | Why | Install warning |
|---|---|---|
| `activeTab` | Read the current tab's URL, on click, to find the artifact id | none |
| `scripting` | Inject the extractor, on click, into the artifact frames | none on its own |
| host `https://*.frame.claudeusercontent.com/*` | The artifact renders on that origin; `activeTab` does not reach a cross-origin frame | "Read and change your data on frame.claudeusercontent.com" |

Explicitly **absent**, and asserted by a test that snapshots the manifest: `cookies`,
`storage` holding any Claude data, `webRequest`, `tabs`, `history`, any host permission on
`claude.ai`, and a persistent content script. Nothing runs until the creator clicks.

### 8.3 The handoff, with no second authenticated client

ADR 0010's largest cost for an extension was that it would have to sign in on its own. This
design avoids that:

1. The extension extracts the payload and holds it in memory under a random, single-use
   nonce with a short lifetime.
2. It opens `https://fanwise.vercel.app/?handoff=<nonce>`. The root already sends a signed-in
   creator to their workspace (`lib/routes.ts`); this step adds only the forwarding of the
   nonce on to the import screen, so **no new reserved route is needed** (`/import` is
   claimed by B12).
3. **The signed-in Fanwise page asks the extension for the payload.** It uses
   `externally_connectable`, which accepts only the Fanwise production origin, and the page
   accepts replies only from the pinned extension id.
4. The extension returns the payload once for that nonce and forgets it.
5. The page calls §6's action **as the signed-in creator**. The extension never talks to
   Fanwise's API and never holds a Fanwise token.

Everything that arrives is treated as untrusted, exactly as a fetched page is.

### 8.4 What it reads

The rendered DOM of the artifact frame, in the content script's isolated world. The artifact
code has already run where Anthropic intends it to run, in Anthropic's sandbox origin, and
the extension only reads the result. Values: visible headings, button and label text,
`placeholder` and `aria-label`, `<option>` text, and bounded visible text, all with the same
caps and sanitising as §7.2. It never reads the Claude chat or interface around the frame.

A cropped screenshot of the frame, through `captureVisibleTab`, would give the listing its
first real preview image. That is **v1.1**, and `[verify]`.

### 8.5 Code layout

- `extension/`, Manifest V3, built by an `esbuild` script inside the existing package
  (`pnpm build:extension`) rather than a new workspace, per `CLAUDE.md`'s rule against
  infrastructure without a demonstrated need.
- The payload schema is imported from `lib/imports/evidence.ts`, so the extension and the
  server cannot disagree about shape.

---

## 9. Testing

**Unit, bring-the-artifact.** Extraction against fixtures for each kind in §7.2. A JSX
fixture whose imports suggest a capability must produce no observed claim for it. Caps,
entities decoded once, and control characters. The claims check over a code-derived draft.
Recoveries: `bring_artifact` is listed first for a `hosted_artifact` shell.

**Database.** The new capture method round-trips through the evidence schema. Idempotency by
link, and by content hash when there is no link. RLS on the new action's writes is inherited
from `product_imports` and re-asserted.

**E2E.** Paste an artifact link, get the refusal, bring the artifact by paste, and reach a
draft with the artifact's real name. The same by upload.

**Extension, once permitted.** A manifest snapshot test for §8.2. The handoff protocol:
single-use nonce, expiry, origin pinning, size cap. Playwright can load an unpacked MV3
extension in Chromium, driven against **a local fixture page that mirrors the frame's
structure, on a test-only match pattern set at build time.**

**Never automated, on either path:** no test, script or CI job requests `claude.ai` or
`claudeusercontent.com`. Real-artifact fixtures are captured **by a person**, with Claude's
own Copy and Download buttons — which is the §7 path, used for its own tests.

---

## 10. Open questions

1. **Will Anthropic explicitly permit the extension?** The founder decides whether to ask,
   and through which channel. Nothing in §8 is built without it.
2. **Is the artifact what buyers receive?** §7.3. If yes, quarantine becomes a precondition.
3. **What do Copy and Download actually produce** for each artifact kind — a self-contained
   HTML file, a `.tsx`, a `.md`? `[verify]` by the founder in Claude, using
   `cfe57222-d5aa-4c49-9f72-f70b505596de` as the first case, whose exported contents become the
   first real fixture.
4. **Extension only:** does the artifact frame need Chrome's `matchOriginAsFallback` to accept
   the content script, and does the nested `-top` frame need `allFrames`? `[verify]`.
5. **Extension only:** Chrome Web Store review time, and the privacy policy wording for what
   the extension reads. PR #81 is currently changing that policy.
6. **Roadmap placement.** B13, off-roadmap like PR #78, which is itself not yet in
   `docs/roadmap.md`.

---

## 11. Exit tests

**Bring the artifact.** The founder pastes `…/artifact/cfe57222-…` and gets the honest
refusal with "Bring the artifact instead". They use Copy in Claude, paste the result, and get
a draft with the artifact's **real name and real features** — not "Claude Artifact" — which
reaches 100% readiness. No request to `claude.ai` appears in Fanwise's logs at any point.

**The extension, once permitted.** An unlisted build is installed. The founder opens the same
artifact, clicks **Send to Fanwise**, and reaches the same draft. The Fanwise request logs
show **no Claude cookie, token or conversation content**, and the extension's manifest
matches §8.2 exactly.

---

## 12. Estimate and order

1. **Bring the artifact:** about **two days**. It clears fix-later item 1 from PR #78 and
   ships a working artifact path under the current terms.
2. **Ask Anthropic,** in parallel, if the founder wants the extension.
3. **The extension:** about **three to five days** once permission is recorded, plus store
   review. Because §6 already exists, it is a thin client over a finished server.

---

## 13. What is not built

- **No request to `claude.ai/api/*`, and no headless browser pointed at Claude.** Ever,
  without §3's permission.
- **No execution of artifact code**, anywhere, including a sandbox of our own.
- **No other AI tools' artifacts.** Each has its own terms, and each needs its own reading.
- **No background reading, no detection of open artifacts, no bulk export.** One artifact,
  on one click or one paste.
- **No Firefox or Safari extension** in v1.
- **Nothing on a marketplace page.** ADR 0010 is unchanged.
