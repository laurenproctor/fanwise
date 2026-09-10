import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The invariants of .github/workflows, read from the files themselves.
 *
 * A workflow runs whatever a tag points at on the day it runs, with whatever
 * token permissions the repository default hands it, for as long as the
 * runner allows. Each of those is a decision this repository has made the
 * other way (ADR 0009), and each is the kind of thing that erodes one edit at
 * a time. So the rules are tests: a tag-only action, a missing permissions
 * block, a checkout that keeps its token, a job with no timeout, or a
 * pull_request_target trigger fails the unit suite before it reaches CI.
 *
 * No YAML parser is used: the shapes asserted here are line-level (a `uses:`
 * value, a key at a given indent), and a dependency added only to validate a
 * config file would itself be a supply-chain surface.
 */

const ROOT = join(__dirname, "..", "..")
const WORKFLOWS = join(ROOT, ".github", "workflows")

const workflows = readdirSync(WORKFLOWS)
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => ({ name, lines: readFileSync(join(WORKFLOWS, name), "utf8").split("\n") }))

/** `owner/repo@<40 hex>` followed by a release comment, or a local action. */
const PINNED = /^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40}\s+#\s*v\d+(?:\.\d+)*$/
const LOCAL = /^\.\//

function usesValues(lines: string[]): string[] {
  return lines
    .map((line) => /^\s*-?\s*uses:\s*(.+?)\s*$/.exec(line)?.[1])
    .filter((value): value is string => typeof value === "string")
}

/** Job blocks: the key at two-space indent under `jobs:`, with its lines. */
function jobs(lines: string[]): Array<{ name: string; lines: string[] }> {
  const start = lines.findIndex((line) => /^jobs:\s*$/.test(line))
  expect(start).toBeGreaterThanOrEqual(0)
  const out: Array<{ name: string; lines: string[] }> = []
  for (const line of lines.slice(start + 1)) {
    const job = /^  ([A-Za-z_][\w-]*):\s*$/.exec(line)
    if (job) out.push({ name: job[1]!, lines: [] })
    else if (out.length > 0) out[out.length - 1]!.lines.push(line)
  }
  return out
}

/** Step blocks within a job: each `- ` at six-space indent and what follows it. */
function steps(jobLines: string[]): string[][] {
  const out: string[][] = []
  for (const line of jobLines) {
    if (/^      - /.test(line)) out.push([line])
    else if (out.length > 0) out[out.length - 1]!.push(line)
  }
  return out
}

describe.each(workflows)("$name", ({ lines }) => {
  it("pins every third-party action to a full commit and names the release beside it", () => {
    const offenders = usesValues(lines).filter((value) => !LOCAL.test(value) && !PINNED.test(value))
    expect(offenders).toEqual([])
  })

  it("declares least-privilege token permissions at the top, and no write-all anywhere", () => {
    const top = lines.findIndex((line) => /^permissions:\s*$/.test(line))
    expect(top, "a top-level permissions block").toBeGreaterThanOrEqual(0)
    expect(lines[top + 1]).toMatch(/^  contents: read\s*$/)
    expect(lines.some((line) => /write-all/.test(line))).toBe(false)
  })

  it("never runs on pull_request_target", () => {
    expect(lines.some((line) => /pull_request_target/.test(line))).toBe(false)
  })

  it("gives every job a timeout", () => {
    for (const job of jobs(lines)) {
      expect(
        job.lines.some((line) => /^    timeout-minutes:\s*\d+\s*$/.test(line)),
        `${job.name} has timeout-minutes`,
      ).toBe(true)
    }
  })

  it("never lets a checkout keep its token in the working tree", () => {
    for (const job of jobs(lines)) {
      for (const step of steps(job.lines)) {
        if (!/uses:\s*actions\/checkout@/.test(step[0]!)) continue
        expect(
          step.some((line) => /^\s+persist-credentials:\s*false\s*$/.test(line)),
          `${job.name}: checkout sets persist-credentials: false`,
        ).toBe(true)
      }
    }
  })
})

describe(".github/dependabot.yml", () => {
  const contents = readFileSync(join(ROOT, ".github", "dependabot.yml"), "utf8")

  it("updates GitHub Actions only, weekly, grouped", () => {
    const ecosystems = [...contents.matchAll(/package-ecosystem:\s*(\S+)/g)].map((m) => m[1])
    expect(ecosystems).toEqual(["github-actions"])
    expect(contents).toMatch(/interval:\s*weekly/)
    expect(contents).toMatch(/^\s+groups:/m)
  })
})
