import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * A regression guard for a failure that cost an afternoon.
 *
 * Next loads .env.local during `next build`, not only during `next dev`. A
 * NODE_ENV pinned in an env file therefore overrides the production value that
 * `next build` sets for itself, and the build resolves React inconsistently:
 * prerendering the framework's own /_global-error page dies with
 * "Cannot read properties of null (reading 'useContext')".
 *
 * The error names a Next internal page and reproduces on a hello-world app, so
 * it reads as a framework bug and sends you to the issue tracker. It is not one.
 * This test asserts the shipped template cannot reintroduce it.
 */

const ROOT = join(__dirname, "..", "..")

function assignments(contents: string): string[] {
  return contents
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
}

describe(".env.example", () => {
  const contents = readFileSync(join(ROOT, ".env.example"), "utf8")

  it("does not set NODE_ENV, which Next sets for itself", () => {
    const offenders = assignments(contents).filter((line) => line.startsWith("NODE_ENV"))
    expect(offenders).toEqual([])
  })

  it("still explains why, so the line is not helpfully added back", () => {
    expect(contents).toContain("Do NOT set NODE_ENV here")
  })

  it("carries every variable lib/env.ts requires, so a fresh copy boots", () => {
    const present = new Set(assignments(contents).map((line) => line.split("=")[0]))
    for (const key of [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_APP_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
    ]) {
      expect(present.has(key), `${key} is missing from .env.example`).toBe(true)
    }
  })
})
