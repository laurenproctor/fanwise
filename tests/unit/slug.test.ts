import { describe, expect, it } from "vitest"
import { SLUG_LIMITS, ensureMinimumLength, randomSuffix, slugify, withSuffix } from "@/lib/slug"
import { workspaceNameSchema, workspaceSlugSchema } from "@/lib/workspaces/schemas"

// The database enforces the same shape. If these ever diverge, the migration wins
// and the app starts throwing, so keep them in step.
const DB_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

describe("slugify", () => {
  it("is deterministic", () => {
    expect(slugify("Northbound Type")).toBe(slugify("Northbound Type"))
  })

  it("lowercases and hyphenates", () => {
    expect(slugify("Northbound Type")).toBe("northbound-type")
  })

  it("strips diacritics rather than dropping the letter", () => {
    expect(slugify("Café Foundry")).toBe("cafe-foundry")
  })

  it("collapses runs of punctuation into a single hyphen", () => {
    expect(slugify("Bold  &&  Bright!!  Studio")).toBe("bold-bright-studio")
  })

  it("never leaves a leading or trailing hyphen", () => {
    expect(slugify("  ...Studio...  ")).toBe("studio")
  })

  it("truncates to the column limit without a trailing hyphen", () => {
    const slug = slugify("a".repeat(30) + " " + "b".repeat(40))
    expect(slug.length).toBeLessThanOrEqual(SLUG_LIMITS.max)
    expect(slug.endsWith("-")).toBe(false)
  })

  it("produces slugs the database will accept", () => {
    for (const name of ["Northbound Type", "Café Foundry", "Bold && Bright", "Studio 99"]) {
      expect(slugify(name)).toMatch(DB_SLUG_PATTERN)
    }
  })

  it("can return an empty string for a name with no alphanumerics", () => {
    // Callers must pass this through ensureMinimumLength before use.
    expect(slugify("!!!")).toBe("")
  })
})

describe("randomSuffix", () => {
  it("uses only slug-safe characters", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(randomSuffix()).toMatch(/^[a-z0-9]{4}$/)
    }
  })

  it("is injectable for deterministic tests", () => {
    expect(randomSuffix(4, () => 0)).toBe("aaaa")
  })
})

describe("withSuffix", () => {
  it("appends with a hyphen", () => {
    expect(withSuffix("northbound-type", "k3f9")).toBe("northbound-type-k3f9")
  })

  it("keeps the result inside the column limit", () => {
    const result = withSuffix("a".repeat(SLUG_LIMITS.max), "k3f9")
    expect(result.length).toBeLessThanOrEqual(SLUG_LIMITS.max)
    expect(result).toMatch(DB_SLUG_PATTERN)
  })

  it("does not produce a double hyphen when the base is trimmed mid-word", () => {
    expect(withSuffix("studio-", "k3f9")).toBe("studio-k3f9")
  })

  it("falls back to the bare suffix when there is no base left", () => {
    expect(withSuffix("", "k3f9")).toBe("k3f9")
  })
})

describe("ensureMinimumLength", () => {
  it("leaves a long enough slug alone", () => {
    expect(ensureMinimumLength("northbound", "k3f9")).toBe("northbound")
  })

  it("pads a slug that is too short for the column", () => {
    const result = ensureMinimumLength("ab", "k3f9")
    expect(result.length).toBeGreaterThanOrEqual(SLUG_LIMITS.min)
    expect(result).toMatch(DB_SLUG_PATTERN)
  })

  it("rescues an empty slug", () => {
    expect(ensureMinimumLength("", "k3f9")).toBe("k3f9")
  })
})

describe("workspace schemas", () => {
  it("trims the name", () => {
    expect(workspaceNameSchema.parse("  Northbound  ")).toBe("Northbound")
  })

  it("rejects a blank name", () => {
    expect(workspaceNameSchema.safeParse("   ").success).toBe(false)
  })

  it("rejects a name over 80 characters", () => {
    expect(workspaceNameSchema.safeParse("a".repeat(81)).success).toBe(false)
  })

  it("rejects slugs the database would reject", () => {
    for (const bad of ["ab", "-leading", "trailing-", "double--hyphen", "Has Caps", "sym!bol"]) {
      expect(workspaceSlugSchema.safeParse(bad).success).toBe(false)
    }
  })

  it("accepts a well formed slug", () => {
    expect(workspaceSlugSchema.safeParse("northbound-type-2").success).toBe(true)
  })
})
