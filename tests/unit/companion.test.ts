import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"
import { companionApi, dressCompanionDocument } from "@/lib/ui/companion"

/**
 * The companion window's browser half, and the constraints in ADR 0010 that a
 * test can hold.
 *
 * The unit suite runs in node, so the documents here are the smallest objects
 * with the shape dressCompanionDocument touches. What the real browser does
 * with them (the window opening, the clipboard, dragging files out) is the
 * manual run in docs/companion-window.md §7.
 */

class FakeElement {
  className = ""
  dataset: Record<string, string | undefined> = {}
  textContent: string | null = null
  children: FakeElement[] = []
  constructor(readonly nodeName: string) {}
  appendChild(child: FakeElement) {
    this.children.push(child)
    return child
  }
}

function fakeDocument(styleSheets: unknown[] = []) {
  const documentElement = new FakeElement("HTML")
  const head = new FakeElement("HEAD")
  const body = new FakeElement("BODY")
  return {
    title: "",
    documentElement,
    head,
    body,
    styleSheets,
    createElement: (name: string) => new FakeElement(name.toUpperCase()),
    importNode: (node: FakeElement) => {
      const copy = new FakeElement(node.nodeName)
      copy.textContent = `clone of ${node.textContent}`
      return copy
    },
  }
}

const asDocument = (fake: ReturnType<typeof fakeDocument>) => fake as unknown as Document

describe("companionApi", () => {
  it("is null where the browser has no Document Picture-in-Picture", () => {
    expect(companionApi({} as Window)).toBeNull()
  })

  it("is the API where it exists", () => {
    const api = { requestWindow: async () => ({}) as Window }
    expect(companionApi({ documentPictureInPicture: api } as unknown as Window)).toBe(api)
  })
})

describe("dressCompanionDocument", () => {
  it("copies readable sheets as rules, clones unreadable links, and carries theme and fonts", () => {
    const link = new FakeElement("LINK")
    link.textContent = "cross-origin sheet"
    const page = fakeDocument([
      { cssRules: [{ cssText: ".a { color: red; }" }, { cssText: ".b { color: blue; }" }] },
      {
        get cssRules(): never {
          throw new Error("SecurityError")
        },
        ownerNode: link,
      },
    ])
    page.documentElement.className = "font-vars"
    page.documentElement.dataset.theme = "dark"
    page.body.className = "font-body antialiased"

    const companion = fakeDocument()
    dressCompanionDocument(asDocument(page), asDocument(companion), "Mock Marketplace handoff")

    expect(companion.title).toBe("Mock Marketplace handoff")
    expect(companion.head.children.map((child) => [child.nodeName, child.textContent])).toEqual([
      ["STYLE", ".a { color: red; }\n.b { color: blue; }"],
      ["LINK", "clone of cross-origin sheet"],
    ])
    expect(companion.documentElement.className).toBe("font-vars")
    expect(companion.documentElement.dataset.theme).toBe("dark")
    expect(companion.body.className).toBe("font-body antialiased")
  })
})

/*
  ADR 0010, constraint 1: the companion never reads, writes or scripts a
  marketplace's page. The ways to do that from a browser are an extension with
  content scripts or host permissions, or code that injects script into a tab.
  Neither may exist in this repository. The companion's own document is
  Fanwise's, and writing into it is the feature.
*/
describe("ADR 0010 constraints", () => {
  const root = join(__dirname, "..", "..")
  const SKIP = new Set([
    "node_modules",
    ".next",
    ".git",
    ".claude",
    "test-results",
    "playwright-report",
  ])

  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      if (SKIP.has(name)) return []
      const path = join(dir, name)
      return statSync(path).isDirectory() ? files(path) : [path]
    })
  }

  const all = files(root)

  it("has no browser extension manifest", () => {
    const manifests = all
      .filter((path) => path.endsWith("manifest.json"))
      .filter((path) =>
        /content_scripts|host_permissions|side_panel/.test(readFileSync(path, "utf8")),
      )
    expect(manifests.map((path) => relative(root, path))).toEqual([])
  })

  it("has no code that uses extension APIs or injects script into a tab", () => {
    const source = all.filter(
      (path) => /\.(ts|tsx|js|mjs)$/.test(path) && !path.includes(`${join("tests", "unit")}`),
    )
    const offenders = source.filter((path) =>
      /\bchrome\.(scripting|tabs|sidePanel)\b|\bbrowser\.(scripting|tabs)\b|\.executeScript\(/.test(
        readFileSync(path, "utf8"),
      ),
    )
    expect(offenders.map((path) => relative(root, path))).toEqual([])
  })

  it("renders the companion from the one handoff component", () => {
    const page = readFileSync(
      join(root, "app", "[slug]", "[productSlug]", "channels", "[connectionId]", "page.tsx"),
      "utf8",
    )
    expect(page.match(/<HandoffPanel\b/g)).toHaveLength(1)
    expect(page).toMatch(/<CompanionWindow[\s\S]*<HandoffPanel[\s\S]*<\/CompanionWindow>/)
  })
})
