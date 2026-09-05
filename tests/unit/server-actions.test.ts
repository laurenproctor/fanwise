import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * A guard for a failure `pnpm build` does not catch.
 *
 * A `"use server"` module may export async functions and nothing else. Types and
 * interfaces are erased before the constraint is applied, so those are fine; a
 * `const` object is not. Exporting one compiles, builds, and then throws at
 * runtime on the first request that loads the module:
 *
 *     A "use server" file can only export async functions, found object.
 *
 * That is the whole app down, from a line that passed typecheck, lint and a
 * production build. It cost nine E2E failures to find, and the failures pointed
 * at UI locators rather than at the cause.
 */

const ROOT = join(__dirname, "..", "..")
const SEARCH_DIRS = ["lib", "app", "components"]

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }

  for (const entry of entries) {
    if (entry === "node_modules" || entry.startsWith(".")) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

function isServerActionModule(contents: string): boolean {
  // The directive has to be the first statement to count.
  return /^\s*(\/\*[\s\S]*?\*\/\s*)?["']use server["']/.test(contents)
}

/**
 * Exports that are erased before the runtime constraint applies. Everything
 * else in a "use server" module has to be an async function.
 */
const ERASED = /^export\s+(type|interface)\b/

describe('"use server" modules', () => {
  const modules = SEARCH_DIRS.flatMap((dir) => sourceFiles(join(ROOT, dir)))
    .filter((file) => isServerActionModule(readFileSync(file, "utf8")))
    .map((file) => ({
      path: relative(ROOT, file).split(sep).join("/"),
      contents: readFileSync(file, "utf8"),
    }))

  it("finds the server action modules at all, so this suite cannot pass vacuously", () => {
    expect(modules.length).toBeGreaterThan(0)
  })

  it("export only async functions, types and interfaces", () => {
    const offenders: string[] = []

    for (const { path, contents } of modules) {
      for (const [index, line] of contents.split("\n").entries()) {
        if (!line.startsWith("export")) continue
        if (ERASED.test(line)) continue
        if (/^export\s+async\s+function\s/.test(line)) continue
        // `export default async function` is also legal.
        if (/^export\s+default\s+async\s+function\s/.test(line)) continue
        offenders.push(`${path}:${index + 1} ${line.trim()}`)
      }
    }

    expect(offenders).toEqual([])
  })
})
