import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { describe, expect, it } from "vitest"
import { SOURCE_DESCRIPTORS, SOURCE_LABELS, sourceKindFor } from "@/lib/imports/sources/registry"
import { SOURCE_KINDS } from "@/lib/imports/types"

/**
 * The import feature's own boundaries, enforced rather than reviewed.
 *
 * Two of them, and neither is covered by the existing
 * tests/unit/channel-boundaries.test.ts, which reads `CHANNEL_KEYS` and knows
 * nothing about a source:
 *
 *   1. **A source's real name stays inside `lib/imports/sources/`.** Invariant
 *      2 read one layer across: a service name in the product domain or in a
 *      shared util is logic branching on whose page it is reading, and the
 *      import stops being general the moment it does.
 *   2. **Nothing in this feature can execute what it imported.** The screen
 *      renders text it read from a stranger's page, so the absence of `eval`,
 *      `innerHTML` and an iframe is a property worth failing CI over rather
 *      than a habit worth trusting.
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
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

function relPath(path: string): string {
  return relative(ROOT, path).split(sep).join("/")
}

/**
 * The names a service is actually known by, derived from the registry rather
 * than typed here, so a source added without a test still gets one.
 *
 * **The full host, and deliberately not its first label.** A bare "claude" is
 * already all over this repository for an unrelated and legitimate reason: it
 * is the vendor behind the AI provider, and `lib/ai/providers/anthropic`
 * names its models. `claude.ai` is a source host and cannot mean anything
 * else, so that is what is swept for. Narrowing the needle rather than widening
 * the exemptions keeps the check meaning one thing.
 */
const NEEDLES: readonly string[] = [
  ...new Set(
    SOURCE_DESCRIPTORS.flatMap((descriptor) => descriptor.hosts).map((host) => host.toLowerCase()),
  ),
]

/**
 * Where a source host may be written.
 *
 * The registry and its fixtures, the tests, and the marketing site — the same
 * exemption tests/unit/channel-boundaries.test.ts grants for the same reason.
 * A page whose job is to say what Fanwise can import may name what it imports;
 * what it may not do is import the registry and branch on the answer.
 */
function isSanctioned(path: string): boolean {
  const rel = relPath(path)
  return (
    rel.startsWith("lib/imports/sources/") ||
    rel.startsWith("tests/") ||
    rel.startsWith("components/marketing/") ||
    rel.startsWith("app/(marketing)/")
  )
}

/**
 * Source with its comments removed.
 *
 * These files document the patterns they refuse to use — "no
 * dangerouslySetInnerHTML, no eval, no iframe" — and a sweep that read prose
 * would fail on the sentence promising the thing is absent. Crude on purpose:
 * it only has to be right about this tree, and a comment parser would be a
 * second thing to get wrong.
 */
function withoutComments(contents: string): string {
  return contents.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ")
}

describe("a source's name stays inside the source layer", () => {
  it("has names to look for at all", () => {
    // A registry that stopped naming anything would make the sweep below pass
    // vacuously, which is the way this kind of test dies quietly.
    expect(NEEDLES.length).toBeGreaterThan(0)
    expect(NEEDLES).toContain("claude.ai")
  })

  it("appears in no other file in the tree", () => {
    const offenders: string[] = []

    for (const file of sourceFiles(ROOT)) {
      if (isSanctioned(file)) continue
      const contents = readFileSync(file, "utf8").toLowerCase()
      for (const needle of NEEDLES) {
        if (contents.includes(needle)) offenders.push(`${relPath(file)} names "${needle}"`)
      }
    }

    expect(offenders).toEqual([])
  })

  it("keeps every generic kind describable without one", () => {
    // Each kind has a label, so a screen can say what a link is without any
    // file outside the registry knowing the answer.
    for (const kind of SOURCE_KINDS) {
      expect(SOURCE_LABELS[kind]).toBeTruthy()
    }
  })
})

describe("resolving a link to a kind", () => {
  it("claims a registered host and its subdomains, and nothing that merely ends like one", () => {
    expect(sourceKindFor(new URL("https://claude.ai/code/artifact/abc"))).toBe("hosted_artifact")
    expect(sourceKindFor(new URL("https://www.claude.ai/x"))).toBe("hosted_artifact")
    // The suffix trap: a host that ends in the registered name but is not it.
    expect(sourceKindFor(new URL("https://claude.ai.example.com/x"))).toBe("webpage")
    expect(sourceKindFor(new URL("https://notclaude.ai/x"))).toBe("webpage")
  })

  it("is total: something always claims a link", () => {
    for (const href of [
      "https://example.com/",
      "https://sub.domain.example.co.uk/a/b?c=d",
      "https://claude.site/artifacts/xyz",
    ]) {
      expect(SOURCE_KINDS).toContain(sourceKindFor(new URL(href)))
    }
  })

  it("keeps the catch-all last, so the order of the list is the order of the answer", () => {
    expect(SOURCE_DESCRIPTORS[SOURCE_DESCRIPTORS.length - 1]!.hosts).toEqual([])
  })
})

describe("nothing in the import feature can run what it imported", () => {
  const FORBIDDEN: Array<[RegExp, string]> = [
    [/dangerouslySetInnerHTML/, "sets HTML from a string"],
    [/\.innerHTML\b/, "assigns innerHTML"],
    [/\beval\s*\(/, "calls eval"],
    [/new\s+Function\s*\(/, "builds a function from a string"],
    [/<iframe/i, "renders an iframe"],
    [/<object/i, "renders an object element"],
    [/<embed/i, "renders an embed element"],
  ]

  const FILES = [
    ...sourceFiles(join(ROOT, "lib", "imports")),
    ...sourceFiles(join(ROOT, "components", "imports")),
    ...sourceFiles(join(ROOT, "app", "[slug]", "new")),
  ]

  it("reads the files it is asserting about", () => {
    expect(FILES.length).toBeGreaterThan(10)
  })

  it("uses none of the ways a page can be made to execute a stranger's code", () => {
    const offenders: string[] = []

    for (const file of FILES) {
      const code = withoutComments(readFileSync(file, "utf8"))
      for (const [pattern, what] of FORBIDDEN) {
        if (pattern.test(code)) offenders.push(`${relPath(file)} ${what}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it("would notice if one of them appeared", () => {
    // The sweep above passes over a tree that has never contained these, so it
    // would pass just as happily if the patterns were wrong. This is the
    // control: the same patterns, over a string that does contain them.
    const planted = 'const x = eval("1"); el.innerHTML = y; <iframe src="z" />'
    const caught = FORBIDDEN.filter(([pattern]) => pattern.test(planted))
    expect(caught.map(([, what]) => what)).toEqual([
      "assigns innerHTML",
      "calls eval",
      "renders an iframe",
    ])
  })

  it("fetches nothing from the browser", () => {
    // Every read of a stranger's URL happens server-side through
    // lib/net/outbound.ts. A fetch in a client component would be the browser
    // reaching a host on the creator's behalf, with their cookies, from their
    // network — which is the whole of what the outbound boundary prevents.
    const offenders: string[] = []

    for (const file of FILES) {
      const contents = readFileSync(file, "utf8")
      if (!contents.startsWith('"use client"')) continue
      const code = withoutComments(contents)
      if (/\bfetch\s*\(/.test(code)) offenders.push(`${relPath(file)} fetches in the browser`)
      if (/XMLHttpRequest/.test(code)) offenders.push(`${relPath(file)} opens an XHR`)
    }

    expect(offenders).toEqual([])
  })
})
