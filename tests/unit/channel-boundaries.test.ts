import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { describe, expect, it } from "vitest"
import { CHANNEL_KEYS, CAPABILITY_KEYS } from "@/lib/channels/types"
import { listAdapters } from "@/lib/channels/registry"

/**
 * The architectural invariants of A3, enforced rather than reviewed.
 *
 * Invariant 2 says no provider name appears in the product domain, in
 * components outside components/channels, or in shared utils. That is a rule
 * about the whole tree, so the only honest way to check it is to read the tree.
 */

const ROOT = join(__dirname, "..", "..")

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }

  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full))
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

/** Where a channel key is allowed to appear. */
function isSanctioned(path: string): boolean {
  const rel = relative(ROOT, path).split(sep).join("/")
  return (
    rel.startsWith("lib/channels/") ||
    rel.startsWith("components/channels/") ||
    rel.startsWith("app/w/[slug]/channels/") ||
    rel.startsWith("tests/")
  )
}

describe("provider names stay inside the adapter layer", () => {
  it("no channel key appears in the product domain, shared utils or unrelated components", () => {
    const offenders: string[] = []

    for (const file of sourceFiles(ROOT)) {
      if (isSanctioned(file)) continue
      const contents = readFileSync(file, "utf8")
      for (const key of CHANNEL_KEYS) {
        if (contents.includes(key)) {
          offenders.push(`${relative(ROOT, file)} mentions ${key}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it("the product domain does not import from the channel layer", () => {
    const offenders: string[] = []

    for (const file of sourceFiles(join(ROOT, "lib", "products"))) {
      const contents = readFileSync(file, "utf8")
      if (/from ["']@\/lib\/channels/.test(contents)) {
        offenders.push(relative(ROOT, file))
      }
    }

    // The arrow points one way: product -> adapter -> listing, never back.
    expect(offenders).toEqual([])
  })
})

describe("the registry and the channels table agree", () => {
  const migration = readFileSync(
    join(ROOT, "supabase", "migrations", "20260904173000_channels_connections_listings.sql"),
    "utf8",
  )

  const seeded = [...migration.matchAll(/\('([a-z_]+)', '([^']+)', '(api|assisted)'/g)].map(
    (m) => ({
      key: m[1],
      name: m[2],
      integrationType: m[3],
    }),
  )

  it("seeds exactly the channels the registry knows about", () => {
    expect(seeded.map((s) => s.key).sort()).toEqual([...CHANNEL_KEYS].sort())
  })

  it("agrees on every channel's name and integration type", () => {
    for (const row of seeded) {
      const adapter = listAdapters().find((a) => a.key === row.key)
      expect(adapter, `${row.key} is seeded but not registered`).toBeDefined()
      expect(adapter!.name).toBe(row.name)
      expect(adapter!.integrationType).toBe(row.integrationType)
    }
  })

  it("registers exactly one adapter per key, with the key matching its slot", () => {
    const adapters = listAdapters()
    expect(adapters).toHaveLength(CHANNEL_KEYS.length)
    expect(new Set(adapters.map((a) => a.key)).size).toBe(adapters.length)
  })

  it("declares every capability on every adapter, so none defaults to undefined", () => {
    for (const adapter of listAdapters()) {
      for (const capability of CAPABILITY_KEYS) {
        expect(
          typeof adapter.capabilities[capability],
          `${adapter.key} does not declare ${capability}`,
        ).toBe("boolean")
      }
    }
  })
})
