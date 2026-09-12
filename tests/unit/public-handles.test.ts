import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  HANDLE_LIMITS,
  PUBLIC_SLUG_LIMITS,
  RESERVED_HANDLES,
  RESERVED_PUBLIC_PRODUCT_SLUGS,
  canonicalHandle,
  checkHandle,
  checkPublicSlug,
  suggestHandle,
} from "@/lib/public/handles"
import { publicProfileSchema, publicProductPageSchema } from "@/lib/public/schemas"
import { displayHost, referrerHost, safeExternalUrl } from "@/lib/public/urls"

const MIGRATIONS = join(__dirname, "..", "..", "supabase", "migrations")
const MIGRATION = join(MIGRATIONS, "20260912010000_public_creator_pages.sql")

/**
 * The migration that most recently (re)defines a constraint. A later migration
 * that drops and re-adds the check is the one the database actually holds, so
 * comparing against the first definition would pass while the two drift.
 */
function latestDefinitionOf(constraint: string): string {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse()
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8")
    if (
      new RegExp(`add constraint ${constraint}|constraint ${constraint}\\s*\\n?\\s*check`).test(sql)
    ) {
      return sql
    }
  }
  throw new Error(`no migration defines ${constraint}`)
}

describe("a handle is lowercase ASCII or it is refused", () => {
  it("accepts the ordinary shapes", () => {
    for (const handle of ["northline", "northline-studio", "studio-42", "a1b", "x".repeat(32)]) {
      expect(checkHandle(handle), handle).toEqual({ ok: true, value: handle })
    }
  })

  it("lowercases rather than refusing, because typing a capital is not a mistake", () => {
    expect(checkHandle("NorthLine")).toEqual({ ok: true, value: "northline" })
    expect(canonicalHandle("  NorthLine  ")).toBe("northline")
  })

  it("refuses the separator shapes that make an ugly URL", () => {
    for (const handle of ["-northline", "northline-", "north--line", "-", "--"]) {
      expect(checkHandle(handle).ok, handle).toBe(false)
    }
  })

  it("refuses anything outside the character set", () => {
    for (const handle of ["north line", "north_line", "north.line", "north/line", "north@line"]) {
      expect(checkHandle(handle).ok, handle).toBe(false)
    }
  })

  it("enforces both ends of the length", () => {
    expect(checkHandle("ab").ok).toBe(false)
    expect(checkHandle("abc").ok).toBe(true)
    expect(checkHandle("x".repeat(HANDLE_LIMITS.max)).ok).toBe(true)
    expect(checkHandle("x".repeat(HANDLE_LIMITS.max + 1)).ok).toBe(false)
  })
})

/**
 * The deceptive-Unicode cases, which are the reason the character set is
 * narrow rather than merely tidy.
 *
 * Each of these renders as something a reader would accept as an existing
 * handle. None of them can reach a row, and the messages say why rather than
 * repeating "invalid characters", because somebody looking at a field that
 * appears to contain plain letters needs to be told what they cannot see.
 */
describe("a handle cannot impersonate another handle", () => {
  // Each of these renders as "northline", or close enough that a reader would
  // not look twice, and each is a distinct string as far as Postgres is
  // concerned. That gap is the whole attack.
  it.each([
    ["Cyrillic a", "northlinа"],
    ["Greek omicron", "nοrthline"],
    ["fullwidth letters", "ｎｏｒｔｈｌｉｎｅ"],
    ["a zero-width space inside", "north​line"],
    ["a soft hyphen inside", "north­line"],
    ["a right-to-left override", "north‮line"],
    ["a Turkish dotless i", "northlıne"],
    ["an fi ligature", "northlineﬁ"],
  ])("refuses %s", (_label, handle) => {
    expect(checkHandle(handle).ok).toBe(false)
  })

  it("names invisibility rather than blaming the visible characters", () => {
    const checked = checkHandle("north​line")
    expect(checked.ok).toBe(false)
    expect(checked.ok === false && checked.message).toMatch(/invisible/i)
  })

  it("names the lookalike case separately", () => {
    // NFKC folds a fullwidth letter, which is how the check notices.
    const checked = checkHandle("ｎorthline")
    expect(checked.ok).toBe(false)
    expect(checked.ok === false && checked.message).toMatch(/look like plain letters/i)
  })
})

describe("reserved handles", () => {
  it("refuses a name that would read as Fanwise speaking", () => {
    for (const handle of ["fanwise", "support", "help", "admin", "security", "api"]) {
      const checked = checkHandle(handle)
      expect(checked.ok, handle).toBe(false)
      expect(checked.ok === false && checked.message).toMatch(/reserved/i)
    }
  })

  /**
   * The list and the CHECK constraint are two halves of one rule, and a
   * feature that only enforced the application half would be enforced until
   * the first seed script.
   */
  it("matches the constraint in the migration exactly", () => {
    const sql = latestDefinitionOf("public_profiles_handle_not_reserved")
    // 20260912160000 re-adds the constraint with `channels`; reading the
    // original definition instead would let the two lists drift unnoticed.
    expect(sql).toContain("public_profile_drafts")
    const block =
      /public_profiles_handle_not_reserved[\s\S]*?array\[([\s\S]*?)\]::extensions\.citext\[\]/.exec(
        sql,
      )
    expect(block, "the constraint should be findable in the migration").not.toBeNull()

    const inSql = [...block![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!).sort()
    expect(inSql).toEqual([...RESERVED_HANDLES].sort())
  })

  it("matches the product-slug constraint too", () => {
    const sql = readFileSync(MIGRATION, "utf8")
    const block =
      /public_product_pages_slug_not_reserved[\s\S]*?array\[([\s\S]*?)\]::extensions\.citext\[\]/.exec(
        sql,
      )
    expect(block).not.toBeNull()
    const inSql = [...block![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!).sort()
    expect(inSql).toEqual([...RESERVED_PUBLIC_PRODUCT_SLUGS].sort())
  })

  it("refuses the collections segment as a product address", () => {
    const checked = checkPublicSlug("collections")
    expect(checked.ok).toBe(false)
    expect(checked.ok === false && checked.message).toMatch(/collections/i)
  })
})

describe("product slugs", () => {
  it("take the same shape with a longer ceiling", () => {
    expect(checkPublicSlug("aster-grotesk")).toEqual({ ok: true, value: "aster-grotesk" })
    expect(checkPublicSlug("x".repeat(PUBLIC_SLUG_LIMITS.max)).ok).toBe(true)
    expect(checkPublicSlug("x".repeat(PUBLIC_SLUG_LIMITS.max + 1)).ok).toBe(false)
  })

  it("are case-insensitive in the same direction as handles", () => {
    expect(checkPublicSlug("Aster-Grotesk")).toEqual({ ok: true, value: "aster-grotesk" })
  })
})

describe("suggesting a handle from a studio name", () => {
  it("is deterministic and URL-shaped", () => {
    expect(suggestHandle("Northline Studio")).toBe("northline-studio")
    expect(suggestHandle("Northline Studio")).toBe(suggestHandle("Northline Studio"))
  })

  it("strips accents rather than dropping the letters", () => {
    expect(suggestHandle("Café Type")).toBe("cafe-type")
  })

  it("never suggests something that cannot be saved", () => {
    for (const name of ["A", "Ab", "API", "Settings", "!!!", "Pricing", "  "]) {
      const suggestion = suggestHandle(name)
      if (suggestion === "") continue
      expect(checkHandle(suggestion).ok, `${name} -> ${suggestion}`).toBe(true)
    }
  })

  it("returns nothing for a name with no usable characters, rather than a guess", () => {
    expect(suggestHandle("!!!")).toBe("")
  })
})

describe("the profile schema", () => {
  const valid = {
    handle: "northline",
    displayName: "Northline Studio",
    shortBio: "",
    location: "",
    websiteUrl: "",
    instagramUrl: "",
    contactUrl: "",
    seoTitle: "",
    seoDescription: "",
  }

  it("turns an emptied optional field into null rather than an empty string", () => {
    // The database's CHECK on `location` refuses a zero-length value, so an
    // empty string from a cleared input has to become null on the way.
    const parsed = publicProfileSchema.parse(valid)
    expect(parsed.location).toBeNull()
    expect(parsed.shortBio).toBeNull()
    expect(parsed.websiteUrl).toBeNull()
  })

  it("accepts https links and refuses everything else", () => {
    expect(
      publicProfileSchema.parse({ ...valid, websiteUrl: "https://a.example" }).websiteUrl,
    ).toBe("https://a.example")
    for (const url of ["http://a.example", "javascript:alert(1)", "a.example", "ftp://a.example"]) {
      expect(publicProfileSchema.safeParse({ ...valid, websiteUrl: url }).success, url).toBe(false)
    }
  })

  it("accepts a mailto only for the contact field", () => {
    expect(
      publicProfileSchema.parse({ ...valid, contactUrl: "mailto:hi@example.com" }).contactUrl,
    ).toBe("mailto:hi@example.com")
    expect(
      publicProfileSchema.safeParse({ ...valid, websiteUrl: "mailto:hi@example.com" }).success,
    ).toBe(false)
  })

  it("refuses an Instagram link that is not Instagram", () => {
    expect(
      publicProfileSchema.safeParse({ ...valid, instagramUrl: "https://instagram.com/x" }).success,
    ).toBe(true)
    expect(
      publicProfileSchema.safeParse({ ...valid, instagramUrl: "https://notinstagram.com/x" })
        .success,
    ).toBe(false)
  })

  it("carries the same handle rules as the checker, so the two cannot disagree", () => {
    for (const handle of ["ab", "-x-", "north line", "fanwise", "north​line"]) {
      expect(publicProfileSchema.safeParse({ ...valid, handle }).success, handle).toBe(false)
    }
  })
})

describe("the product page schema", () => {
  const valid = {
    slug: "aster-grotesk",
    titleOverride: "",
    summaryOverride: "",
    descriptionOverride: "",
    coverAssetId: "",
    featured: false,
    seoTitle: "",
    seoDescription: "",
  }

  it("treats an unset cover as automatic rather than an error", () => {
    expect(publicProductPageSchema.parse(valid).coverAssetId).toBeNull()
  })

  it("refuses a cover id that is not an id", () => {
    expect(publicProductPageSchema.safeParse({ ...valid, coverAssetId: "nope" }).success).toBe(
      false,
    )
  })
})

/**
 * The render-time guard, which is the layer a row written before any of the
 * schemas existed still has to pass.
 */
describe("safeExternalUrl", () => {
  it("passes a plain https URL", () => {
    expect(safeExternalUrl("https://shop.example/item")).toBe("https://shop.example/item")
  })

  it("refuses every scheme that is not https", () => {
    for (const url of [
      "http://shop.example",
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox",
      "file:///etc/passwd",
      "mailto:hi@example.com", // not without the option
    ]) {
      expect(safeExternalUrl(url), url).toBeNull()
    }
  })

  it("refuses a scheme smuggled past a check with a control character", () => {
    // A browser strips these before parsing, so the string a naive check sees
    // and the URL the browser navigates to are different strings.
    for (const url of ["java script:alert(1)", "java\tscript:alert(1)", "java\nscript:alert(1)"]) {
      expect(safeExternalUrl(url), JSON.stringify(url)).toBeNull()
    }
  })

  it("refuses credentials in the authority, which are a phishing display trick", () => {
    expect(safeExternalUrl("https://shop.example@evil.example/")).toBeNull()
  })

  it("refuses anything unreasonably long", () => {
    expect(safeExternalUrl(`https://a.example/${"x".repeat(3000)}`)).toBeNull()
  })

  it("accepts a bare mailto only when asked, and only a plain address", () => {
    expect(safeExternalUrl("mailto:hi@example.com", { allowMailto: true })).toBe(
      "mailto:hi@example.com",
    )
    // Headers after a ? can pre-fill a body, which is a message sent over the
    // visitor's name that they did not write.
    expect(
      safeExternalUrl("mailto:hi@example.com?subject=x&body=y", { allowMailto: true }),
    ).toBeNull()
    expect(safeExternalUrl("mailto:not-an-address", { allowMailto: true })).toBeNull()
  })

  it("treats null, undefined and blank as absent rather than throwing", () => {
    expect(safeExternalUrl(null)).toBeNull()
    expect(safeExternalUrl(undefined)).toBeNull()
    expect(safeExternalUrl("   ")).toBeNull()
    expect(safeExternalUrl("not a url at all")).toBeNull()
  })
})

describe("displayHost and referrerHost", () => {
  it("drops www for display", () => {
    expect(displayHost("https://www.northline.studio/x")).toBe("northline.studio")
  })

  it("returns nothing for a link that would not be rendered anyway", () => {
    expect(displayHost("javascript:alert(1)")).toBeNull()
  })

  it("reduces a referrer to a host, keeping no path", () => {
    expect(referrerHost("https://news.example/some/private/page?q=1")).toBe("news.example")
    expect(referrerHost(null)).toBeNull()
    expect(referrerHost("not a url")).toBeNull()
  })
})

describe("what a refused handle says", () => {
  /**
   * The creator reads these while typing, beside the field. The browser still
   * types a reserved one in journey-14-public-pages.spec.ts; every rule's words
   * are pinned here, because a message that names the wrong problem is a field
   * a creator cannot fill in.
   */
  it.each([
    ["fanwise", "That handle is reserved. Choose another."],
    ["no", `A handle is at least ${HANDLE_LIMITS.min} characters.`],
    ["Not A Handle", "A handle uses lowercase letters, numbers and hyphens only."],
    ["north--line", "A handle cannot start or end with a hyphen, or contain two in a row."],
    ["-northline", "A handle cannot start or end with a hyphen, or contain two in a row."],
    ["", "Choose a handle."],
  ])("refuses %j with the words for that problem", (input, message) => {
    expect(checkHandle(input)).toEqual({ ok: false, message })
  })
})
