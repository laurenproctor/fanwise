import { spawnSync } from "node:child_process"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Guards for the hosted-project overrides in supabase/config.toml, and for the
 * script that applies them.
 *
 * The [remotes.production] block is applied to the live project by
 * `pnpm auth:push`, and it carries the SMTP wiring. Three things must stay
 * true: the credentials are env() references and never literals, because the
 * file is committed; the push script stays wired into package.json, because
 * `supabase config push` run by hand skips every check; and the script itself
 * keeps the deployment boundary described in ADR 0008: no default project, a
 * named commit on origin/main, a temporary detached worktree that is the only
 * thing linked, cleanup on every exit, and the CLI's own diff prompt as the
 * approval.
 *
 * The refusal tests run the real script. Every path they exercise exits before
 * the script touches git, the CLI or the network, and none of them supplies a
 * credential value: the variables are named, never filled.
 */

const ROOT = join(__dirname, "..", "..")

function section(contents: string, header: string): string {
  const start = contents.indexOf(header)
  expect(start, `${header} is missing from supabase/config.toml`).toBeGreaterThanOrEqual(0)
  const rest = contents.slice(start + header.length)
  const next = rest.search(/^\[/m)
  return next === -1 ? rest : rest.slice(0, next)
}

/**
 * The major version the hosted project runs. Read from the project itself on
 * 10 September 2026 (server_version 17.6). When Supabase upgrades the project,
 * update this and the [db] block together; until then a drift between the two
 * means migrations are exercised locally and in CI on a version the hosted
 * database does not run.
 */
const HOSTED_POSTGRES_MAJOR = 17

describe("supabase/config.toml database version", () => {
  const contents = readFileSync(join(ROOT, "supabase", "config.toml"), "utf8")

  it("declares the major version the hosted project runs", () => {
    const db = section(contents, "[db]")
    expect(db).toMatch(new RegExp(`^major_version = ${HOSTED_POSTGRES_MAJOR}$`, "m"))
  })
})

describe("supabase/config.toml production overrides", () => {
  const contents = readFileSync(join(ROOT, "supabase", "config.toml"), "utf8")

  it("targets the hosted project by ref", () => {
    const remote = section(contents, "[remotes.production]")
    expect(remote).toMatch(/^project_id = "[a-z]{20}"$/m)
  })

  it("points auth at the live app URL, not localhost", () => {
    const auth = section(contents, "[remotes.production.auth]")
    expect(auth).toMatch(/^site_url = "https:\/\/[^"]+"$/m)
    expect(auth).not.toContain("localhost")
  })

  it("reads every SMTP credential from the environment, never a literal", () => {
    const smtp = section(contents, "[remotes.production.auth.email.smtp]")
    for (const [field, variable] of [
      ["host", "SMTP_HOST"],
      ["user", "SMTP_USER"],
      ["pass", "SMTP_PASS"],
      ["admin_email", "SMTP_ADMIN_EMAIL"],
    ]) {
      expect(smtp, `${field} must be env(${variable})`).toMatch(
        new RegExp(`^${field} = "env\\(${variable}\\)"$`, "m"),
      )
    }
  })

  it("is pushed through the guarded script, which package.json exposes", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts["auth:push"]).toBe("bash scripts/push-auth-config.sh")
    const script = readFileSync(SCRIPT, "utf8")
    for (const variable of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_ADMIN_EMAIL"]) {
      expect(script).toContain(variable)
    }
    expect(script).toContain("supabase config push")
  })
})

const SCRIPT = join(ROOT, "scripts", "push-auth-config.sh")

/** Runs the script with a scrubbed environment: no SMTP value can leak in from the shell. */
function run(args: string[], env: Record<string, string> = {}) {
  const clean: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV,
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
  }
  const result = spawnSync("bash", [SCRIPT, ...args], {
    cwd: ROOT,
    env: { ...clean, ...env },
    encoding: "utf8",
    // stdin is a pipe, never a terminal: the script must refuse before pushing.
    stdio: ["pipe", "pipe", "pipe"],
  })
  return { code: result.status, out: result.stdout + result.stderr }
}

describe("the auth-config deployment script keeps the hosted boundary", () => {
  const script = readFileSync(SCRIPT, "utf8")
  const hostedRef = /project_id = "([a-z]{20})"/.exec(
    readFileSync(join(ROOT, "supabase", "config.toml"), "utf8"),
  )?.[1]

  it("names no project by default: the reference is always an argument", () => {
    expect(hostedRef).toBeTruthy()
    expect(script).not.toContain(hostedRef!)
    expect(script).toContain("--project-ref")
  })

  it("refuses to run without a project reference and a commit, touching nothing", () => {
    const { code, out } = run([])
    expect(code).toBe(2)
    expect(out).toContain("usage:")
    expect(out).toContain("--project-ref")
    expect(out).toContain("--commit")
  })

  it("refuses a malformed project reference", () => {
    const { code, out } = run(["--project-ref", "nope", "--commit", "HEAD"])
    expect(code).toBe(2)
    expect(out).toContain("20-letter")
  })

  it("refuses while any SMTP variable is blank, and says which, before anything else", () => {
    const { code, out } = run(["--project-ref", "abcdefghijklmnopqrst", "--commit", "HEAD"])
    expect(code).toBe(1)
    expect(out).toContain("Not pushing")
    for (const variable of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_ADMIN_EMAIL"]) {
      expect(out).toContain(variable)
    }
    expect(out).toContain("The hosted project is unchanged.")
  })

  it("refuses an env file that does not exist", () => {
    const { code, out } = run([
      "--project-ref",
      "abcdefghijklmnopqrst",
      "--commit",
      "HEAD",
      "--env-file",
      "/nonexistent/fanwise-smtp.env",
    ])
    expect(code).toBe(1)
    expect(out).toContain("does not exist")
  })

  it("refuses to push without a terminal, so the CLI's diff prompt is always a person's", () => {
    // Every variable set to a placeholder word, not a credential. This is the
    // first check past the credential gate, and it fails on a piped stdin.
    const placeholders = Object.fromEntries(
      ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_ADMIN_EMAIL"].map((k) => [k, "placeholder"]),
    )
    const { code, out } = run(
      ["--project-ref", "abcdefghijklmnopqrst", "--commit", "HEAD"],
      placeholders,
    )
    expect(code).toBe(1)
    expect(out).toContain("without a terminal")
    expect(out).not.toContain("placeholder")
  })

  it("would push only from a temporary detached worktree it unlinks on every exit", () => {
    expect(script).toContain("git worktree add --detach")
    expect(script).toContain("trap cleanup EXIT INT TERM")
    expect(script).toContain("supabase unlink")
    expect(script).toContain("merge-base --is-ancestor")
    expect(script).toContain("supabase/.temp/project-ref")
    expect(script).not.toContain("--yes\n")
    expect(script).not.toMatch(/config push[^\n]*--yes/)
  })

  it("left no deployment worktree behind after the refusals above", () => {
    const leftovers = readdirSync(join(ROOT, "..")).filter((name) =>
      name.startsWith("fanwise-auth-deploy-"),
    )
    expect(leftovers).toEqual([])
  })
})
