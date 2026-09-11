# ADR 0009: CI token privilege, pinned actions, and the repository settings audit

**Status:** accepted, 10 September 2026
**Owns:** `.github/workflows/ci.yml`, `.github/dependabot.yml`
**Proves:** `tests/unit/workflows.test.ts`

---

## Context

Phase 4b of the security hardening. The CI workflow referenced five third-party actions
by moving tag (`@v4`, `@v1`), ran with the repository's default token permissions, let
checkout leave its token in the working tree, and had no job timeouts. Each is a supply-chain
exposure of a familiar shape: a moved tag runs code nobody reviewed, a token with more than
read is a token a compromised step can use, a persisted credential is one a build step can
push with, and a job with no timeout holds a runner for as long as a hung Supabase stack
lasts.

## Decision

- **Every third-party action is pinned to the full commit of a published release**, resolved
  from the action's own repository and verified as a commit object, with the release named
  beside it. What the moving tags pointed at on 10 September 2026 was pinned, so nothing
  about CI's behaviour changed:

  | Action | Release | Commit |
  |---|---|---|
  | `actions/checkout` | v4.4.0 | `11d5960a326750d5838078e36cf38b85af677262` |
  | `pnpm/action-setup` | v4.3.0 | `b906affcce14559ad1aafd4ab0e942779e9f58b1` |
  | `actions/setup-node` | v4.4.0 | `49933ea5288caeca8642d1e84afbd3f7d6820020` |
  | `supabase/setup-cli` | v1.7.1 | `ab058987d8d6c725971f6cf9d0b5c98467e30bd1` |
  | `actions/upload-artifact` | v4.6.2 | `ea165f8d65b6e75b540449e92b4886f43607fa02` |

  `pnpm/action-setup`'s `v4` tag sits on v4.3.0, not the newer v4.4.0, because v4.4.0 moves
  the action to the Node 24 runtime and the maintainers left the major tag behind; the pin
  follows the tag. Newer majors exist for every action and are Dependabot's to propose.
- **The workflow token is `contents: read`**, declared at the top of the workflow. No job
  pushes, comments, publishes or approves. Artifact upload and the setup actions work with
  read; a job that one day needs more declares it on that job.
- **Checkout does not persist credentials.** No job pushes, so no build step can.
- **Every job has a timeout**: 15 minutes for the static job, 30 for the tenancy suite, 40
  for E2E, each several times the observed duration.
- **Dependabot updates GitHub Actions only**, weekly, grouped into one pull request, at most
  two open. It bumps the pinned commit and the release comment together. npm version
  updates are deliberately absent: they would open pull requests against `package.json` and
  `pnpm-lock.yaml`, both edited by the open C1 billing pull request. Add the npm entry once
  that has merged.
- **No dependency-review job.** GitHub's dependency-review action reads the dependency
  graph, and this repository's dependency graph is not enabled: the GraphQL manifests query
  returns zero manifests and the compare endpoint answers 403. A job added now would fail on
  every pull request. Enable the graph first (below), then add the job pinned to
  `actions/dependency-review-action` v4.9.0, commit `2031cfc080254a8a887f58cffee85186f0e49e48`,
  on `pull_request` only, failing on high and critical severities and on denied licences.
- **The rules are tests.** `tests/unit/workflows.test.ts` reads every workflow and refuses a
  tag-only action, a missing top-level permissions block, `write-all`, a
  `pull_request_target` trigger, a job without a timeout, or a checkout that keeps its
  token; and it holds Dependabot to the Actions-only, weekly, grouped policy. No YAML parser
  was added: the shapes are line-level, and a dependency added only to validate a config
  file would itself be a supply-chain surface.

## Repository settings, audited read-only on 10 September 2026

Nothing below was changed by this decision; each is a dashboard setting.

| Setting | State | Recommendation |
|---|---|---|
| Secret scanning | enabled | keep |
| Push protection | enabled | keep |
| Secret scanning, non-provider patterns | disabled | enable; cheap and catches generic tokens |
| Dependency graph | not enabled | **enable**; prerequisite for alerts, security updates and dependency review |
| Dependabot alerts | disabled | enable after the graph |
| Dependabot security updates | disabled | enable after the graph; distinct from version updates |
| Code scanning (CodeQL) | not configured; default setup available for JavaScript/TypeScript and Actions | enable default setup |
| Branch protection on `main` | none; no rulesets | require the `verify`, `tenancy` and `e2e` checks, require a pull request, forbid force pushes and deletion; do not require the Vercel check while previews fail |
| Actions allowed | all | restrict to actions from GitHub and verified creators, plus the pinned ones |
| Default workflow token | read | keep; the workflow now declares it explicitly as well |

## Consequences

- An action bump is a visible diff of forty hex characters and a release name, reviewed
  like any other change, rather than an invisible move of a tag.
- A future job that needs to write, such as one that publishes a release, declares its
  permissions on that job and, if it must push, sets `persist-credentials` deliberately.
- The `.github/scripts/export-supabase-env.sh` helper is unchanged; it runs inside the
  jobs with the same read-only token.
