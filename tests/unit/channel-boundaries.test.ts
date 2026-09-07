import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { describe, expect, it } from "vitest"
import { CHANNEL_KEYS, CAPABILITY_KEYS } from "@/lib/channels/types"
import { CAPABILITY_METHODS, listAdapters } from "@/lib/channels/registry"

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

/**
 * Where a channel key is allowed to appear.
 *
 * The adapter layer, obviously. And the marketing site, less obviously, which
 * is worth stating rather than assuming.
 *
 * Invariant 2 exists so that no part of the product takes a marketplace's shape:
 * a provider name in `lib/products` or in a shared util means logic somewhere is
 * branching on which shop it is talking to. The marketing site does not have
 * that failure mode. Naming Etsy on a page whose job is to say which shops
 * Fanwise publishes to is the copy, not a leak — a Marketplaces page that could
 * not name a marketplace would have nothing to say.
 *
 * The exemption is narrow and paid for by `the marketing site names providers
 * without deriving behavior from them` below, which holds the line that matters:
 * marketing may print a provider's name and may not import the adapter layer.
 */
const MARKETING = ["components/marketing/", "app/(marketing)/"]

function isSanctioned(path: string): boolean {
  const rel = relative(ROOT, path).split(sep).join("/")
  return (
    rel.startsWith("lib/channels/") ||
    rel.startsWith("components/channels/") ||
    rel.startsWith("app/[slug]/channels/") ||
    MARKETING.some((dir) => rel.startsWith(dir)) ||
    rel.startsWith("tests/")
  )
}

describe("provider names stay inside the adapter layer", () => {
  it("no channel key appears in the product domain, shared utils or unrelated components", () => {
    const offenders: string[] = []

    for (const file of sourceFiles(ROOT)) {
      if (isSanctioned(file)) continue
      const contents = readFileSync(file, "utf8").toLowerCase()
      for (const key of CHANNEL_KEYS) {
        // Case-insensitive, and the key is also checked without its underscores.
        // A provider name does not stop being one because it was written
        // SHOPIFY_CLIENT_ID in an env schema or "Shopify" in a sentence, and
        // both are exactly the leaks invariant 2 is about.
        const needles = [key, key.replace(/_/g, "")].map((n) => n.toLowerCase())
        if (needles.some((needle) => contents.includes(needle))) {
          offenders.push(`${relative(ROOT, file)} mentions ${key}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it("the marketing site names providers without deriving behavior from them", () => {
    // The price of the exemption above. A marketing page may write "Shopify" in
    // a sentence; the moment it imports the registry, the site is rendering
    // itself from the adapter layer and a channel added for the product silently
    // changes the public copy.
    const offenders: string[] = []

    for (const dir of MARKETING) {
      for (const file of sourceFiles(join(ROOT, ...dir.split("/")))) {
        const contents = readFileSync(file, "utf8")
        if (/from ["']@\/lib\/channels/.test(contents)) {
          offenders.push(relative(ROOT, file))
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
  /**
   * Every migration, not one named file.
   *
   * A3 seeded its two mocks in its own migration and A5 seeds Shopify in
   * another, so a test pinned to a single filename stops checking the thing it
   * was written to check the moment a second channel lands. It fails loudly
   * rather than passing quietly, which is how this was caught, but the fix is
   * to read the directory.
   */
  const migrationsDir = join(ROOT, "supabase", "migrations")
  const seeded = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .flatMap((file) => {
      const sql = readFileSync(join(migrationsDir, file), "utf8")
      return [...sql.matchAll(/\('([a-z_]+)', '([^']+)', '(api|assisted)'/g)].map((m) => ({
        key: m[1],
        name: m[2],
        integrationType: m[3],
      }))
    })

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

describe("the adapter contract stays honest", () => {
  it("implements every method it declares a capability for", () => {
    for (const adapter of listAdapters()) {
      for (const { capability, method } of CAPABILITY_METHODS) {
        const declared = adapter.capabilities[capability]
        const implemented =
          typeof (adapter as unknown as Record<string, unknown>)[method] === "function"
        expect(implemented, `${adapter.key} declares ${capability} but has no ${method}()`).toBe(
          declared,
        )
      }
    }
  })

  it("never lets an assisted channel claim it can publish or update", () => {
    for (const adapter of listAdapters()) {
      if (adapter.integrationType !== "assisted") continue
      expect(adapter.capabilities.automaticPublish, `${adapter.key}`).toBe(false)
      expect(adapter.capabilities.automaticUpdate, `${adapter.key}`).toBe(false)
      expect(adapter.publish, `${adapter.key} implements publish`).toBeUndefined()
      expect(adapter.update, `${adapter.key} implements update`).toBeUndefined()
    }
  })

  it("implements activate wherever a manual step gates activation", () => {
    for (const adapter of listAdapters()) {
      const gates = adapter.manualSteps.some((step) => step.gatesActivation)
      if (!gates) continue
      expect(
        typeof adapter.activate,
        `${adapter.key} has a step that gates activation but no activate()`,
      ).toBe("function")
      // A step that gates activation is a step that holds the product back, so
      // the channel has to be able to hold it back in the first place.
      expect(adapter.capabilities.drafts, `${adapter.key} gates activation without drafts`).toBe(
        true,
      )
    }
  })

  it("declares a manual step wherever it cannot upload the deliverable itself", () => {
    for (const adapter of listAdapters()) {
      // Only meaningful for a channel that publishes. An assisted channel does
      // everything by hand and tracks none of it as a step.
      if (!adapter.capabilities.automaticPublish) continue
      if (adapter.capabilities.digitalFileUpload) continue
      expect(
        adapter.manualSteps.some((step) => step.needsDeliverable && step.required),
        `${adapter.key} publishes, cannot upload the deliverable, and asks nobody to`,
      ).toBe(true)
    }
  })

  it("only offers an authorization on a channel that can act through an API", () => {
    for (const adapter of listAdapters()) {
      if (!adapter.oauth) continue
      expect(adapter.integrationType, `${adapter.key}`).toBe("api")
    }
  })
})
