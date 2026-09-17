import { describe, expect, it } from "vitest"
import { flattenSections, scoreCommand, searchCommands } from "@/lib/commands/search"
import type { FanwiseCommand } from "@/lib/commands/types"

function command(
  overrides: Partial<FanwiseCommand> & { id: string; label: string },
): FanwiseCommand {
  return { group: "quick", scope: "global", enabled: true, execute: () => {}, ...overrides }
}

const COMMANDS: FanwiseCommand[] = [
  command({ id: "product.create", label: "Create a product", keywords: ["new", "add"] }),
  command({
    id: "nav.products",
    label: "Go to Products",
    group: "navigation",
    keywords: ["catalog"],
  }),
  command({ id: "nav.settings", label: "Go to Settings", group: "navigation" }),
  command({
    id: "account.subscription",
    label: "Subscription",
    group: "account",
    keywords: ["billing", "plan"],
    description: "Plan, marketplaces and what they cost.",
  }),
  command({ id: "product.open:aster", label: "Aster Grotesk", group: "products", hidden: true }),
  command({
    id: "product.open:meridian",
    label: "Meridian Serif",
    group: "products",
    hidden: true,
  }),
  command({ id: "editor.save", label: "Save draft", group: "page", scope: "page" }),
]

describe("searchCommands with no query", () => {
  it("lists the groups in order, hides hidden rows, and offers the suggested ones first", () => {
    const sections = searchCommands(COMMANDS, "", {
      suggested: ["product.open:meridian", "missing"],
    })
    expect(sections.map((s) => s.label)).toEqual([
      "Suggested",
      "Quick actions",
      "Current page",
      "Navigation",
      "Account and settings",
    ])
    expect(sections[0]!.commands.map((c) => c.label)).toEqual(["Meridian Serif"])
    expect(flattenSections(sections).map((c) => c.id)).not.toContain("product.open:aster")
  })

  it("has no Suggested section when nothing is suggested", () => {
    expect(searchCommands(COMMANDS, "  ").map((s) => s.group)).not.toContain("suggested")
  })
})

describe("searchCommands with a query", () => {
  it("finds hidden products by name", () => {
    const rows = flattenSections(searchCommands(COMMANDS, "aster"))
    expect(rows.map((c) => c.id)).toEqual(["product.open:aster"])
  })

  it("ranks a label prefix above a word inside the label, and keywords below both", () => {
    const rows = flattenSections(searchCommands(COMMANDS, "prod"))
    expect(rows.map((c) => c.id)).toEqual(["product.create", "nav.products"])
    expect(scoreCommand(COMMANDS[1]!, "catalog")).toBeLessThan(
      scoreCommand(COMMANDS[1]!, "products"),
    )
  })

  it("matches keywords and descriptions", () => {
    expect(flattenSections(searchCommands(COMMANDS, "billing")).map((c) => c.id)).toEqual([
      "account.subscription",
    ])
    expect(flattenSections(searchCommands(COMMANDS, "marketplaces")).map((c) => c.id)).toEqual([
      "account.subscription",
    ])
  })

  it("needs every word to land somewhere", () => {
    expect(flattenSections(searchCommands(COMMANDS, "go settings")).map((c) => c.id)).toEqual([
      "nav.settings",
    ])
    expect(searchCommands(COMMANDS, "go nowhere")).toEqual([])
  })

  it("ignores case and accents", () => {
    expect(flattenSections(searchCommands(COMMANDS, "MERIDIAN")).map((c) => c.id)).toEqual([
      "product.open:meridian",
    ])
    expect(flattenSections(searchCommands(COMMANDS, "sérif")).map((c) => c.id)).toEqual([
      "product.open:meridian",
    ])
  })
})
