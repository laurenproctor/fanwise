import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Guards for the hosted-project overrides in supabase/config.toml.
 *
 * The [remotes.production] block is applied to the live project by
 * `pnpm auth:push`, and it carries the SMTP wiring. Two things must stay true
 * of it: the credentials are env() references and never literals, because the
 * file is committed; and the push script that guards it stays wired into
 * package.json, because `supabase config push` run by hand skips the check
 * that keeps a half-filled block from disabling auth email.
 */

const ROOT = join(__dirname, "..", "..")

function section(contents: string, header: string): string {
  const start = contents.indexOf(header)
  expect(start, `${header} is missing from supabase/config.toml`).toBeGreaterThanOrEqual(0)
  const rest = contents.slice(start + header.length)
  const next = rest.search(/^\[/m)
  return next === -1 ? rest : rest.slice(0, next)
}

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
    const script = readFileSync(join(ROOT, "scripts", "push-auth-config.sh"), "utf8")
    for (const variable of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_ADMIN_EMAIL"]) {
      expect(script).toContain(variable)
    }
    expect(script).toContain("supabase config push")
  })
})
