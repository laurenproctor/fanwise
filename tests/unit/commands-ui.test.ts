import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { CommandPalette } from "@/components/commands/command-palette"
import { CommandsButton } from "@/components/commands/commands-button"
import { FanwiseGuide } from "@/components/commands/fanwise-guide"
import { ShortcutReference } from "@/components/commands/shortcut-reference"
import { KeyboardSettings } from "@/app/[slug]/settings/keyboard-settings"
import { SEQUENCE_DESTINATIONS } from "@/lib/commands/navigation"
import type { FanwiseCommand } from "@/lib/commands/types"

/**
 * The keyboard surfaces, as markup.
 *
 * The unit suite has no DOM, so this pins what a static render decides: the
 * roles and names the dialogs carry, that a disabled row says why, that the
 * guide's live region is always present and fills with the destinations, and
 * that a keycap prints the right modifier. Keys actually being pressed is
 * tests/e2e/keyboard-commands.spec.ts.
 */

function render(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(element)
}

function textOf(markup: string): string {
  return markup
    .split(/<[^>]*>/)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
}

function command(
  overrides: Partial<FanwiseCommand> & { id: string; label: string },
): FanwiseCommand {
  return { group: "quick", scope: "global", enabled: true, execute: () => {}, ...overrides }
}

const COMMANDS: FanwiseCommand[] = [
  command({ id: "product.create", label: "Create a product", shortcuts: [{ key: "c" }] }),
  command({
    id: "palette.open",
    label: "Open command palette",
    shortcuts: [{ key: "k", mod: true }],
    hidden: true,
  }),
  command({
    id: "editor.publish",
    label: "Publish everywhere",
    group: "page",
    scope: "page",
    shortcuts: [{ key: "Enter", mod: true, shift: true }],
    enabled: false,
    disabledReason: "Add a price and cover image before publishing.",
  }),
  command({
    id: "nav.products",
    label: "Go to Products",
    group: "navigation",
    scope: "navigation",
  }),
  command({
    id: "list.next",
    label: "Next product",
    group: "page",
    scope: "selection",
    within: "catalog",
    shortcuts: [{ key: "j" }, { key: "ArrowDown" }],
    hidden: true,
  }),
]

describe("FanwiseGuide", () => {
  it("keeps one polite live region in the DOM, empty until F", () => {
    const closed = render(createElement(FanwiseGuide, { open: false, message: null }))
    expect(closed).toContain('role="status"')
    expect(closed).toContain('aria-live="polite"')
    expect(closed).toContain("sr-only")
    expect(textOf(closed)).toBe("")
  })

  it("prints Fanwise and every destination with its key", () => {
    const open = render(createElement(FanwiseGuide, { open: true, message: null }))
    const text = textOf(open)
    expect(text.startsWith("Fanwise:")).toBe(true)
    for (const destination of SEQUENCE_DESTINATIONS) {
      expect(text).toContain(`${destination.key.toUpperCase()} ${destination.label}`)
    }
    expect(open).not.toContain("sr-only")
  })

  it("carries a command's refusal in the same region", () => {
    const said = render(
      createElement(FanwiseGuide, {
        open: false,
        message: "Publish everywhere: Add a price first.",
      }),
    )
    expect(textOf(said)).toBe("Publish everywhere: Add a price first.")
  })
})

describe("CommandPalette", () => {
  const markup = render(
    createElement(CommandPalette, {
      open: false,
      onClose: () => {},
      commands: COMMANDS,
      platform: "mac",
      run: () => {},
      workspaceSlug: "studio",
    }),
  )

  it("is a labelled, described dialog around a combobox and a listbox", () => {
    expect(markup).toContain("<dialog")
    expect(markup).toContain('data-command-dialog="palette"')
    expect(markup).toMatch(/aria-labelledby="[^"]+"/)
    expect(markup).toMatch(/aria-describedby="[^"]+"/)
    expect(markup).toContain('role="combobox"')
    expect(markup).toContain('aria-autocomplete="list"')
    expect(markup).toContain('role="listbox"')
    expect(markup).toContain('aria-label="Search commands"')
  })

  it("groups results, hides hidden rows, and marks the first row selected", () => {
    expect(textOf(markup)).toContain("Quick actions")
    expect(textOf(markup)).toContain("Current page")
    expect(textOf(markup)).toContain("Navigation")
    expect(markup).not.toContain("Open command palette")
    expect(markup).not.toContain("Next product")
    expect(markup.split('aria-selected="true"')).toHaveLength(2)
    expect(markup).toMatch(/aria-activedescendant="[^"]+"/)
  })

  it("says why a disabled command cannot run, in words and not only colour", () => {
    expect(markup).toContain('aria-disabled="true"')
    expect(textOf(markup)).toContain(
      "Publish everywhere Unavailable Add a price and cover image before publishing.",
    )
  })

  it("prints Mac keycaps for a Mac and words otherwise", () => {
    expect(markup).toContain("<kbd")
    expect(markup).toContain(">⌘<")
    expect(markup).toContain(">Shift<")
    const other = render(
      createElement(CommandPalette, {
        open: false,
        onClose: () => {},
        commands: COMMANDS,
        platform: "other",
        run: () => {},
      }),
    )
    expect(other).toContain(">Ctrl<")
    expect(other).not.toContain(">⌘<")
  })

  it("announces the count", () => {
    expect(textOf(markup)).toContain("3 commands.")
  })
})

describe("ShortcutReference", () => {
  it("lists live shortcuts by scope and the F sequences from the destinations table", () => {
    const markup = render(
      createElement(ShortcutReference, {
        open: false,
        onClose: () => {},
        commands: COMMANDS,
        platform: "other",
        singleKeysEnabled: true,
      }),
    )
    const text = textOf(markup)
    expect(markup).toContain('data-command-dialog="reference"')
    expect(text).toContain("Keyboard shortcuts")
    expect(text).toContain("Everywhere")
    expect(text).toContain("This page")
    expect(text).toContain("Product list")
    expect(text).toContain("Fanwise navigation")
    expect(text).toContain("Create a product")
    expect(text).toContain("Ctrl Shift Enter")
    for (const destination of SEQUENCE_DESTINATIONS)
      expect(text).toContain(`F, then ${destination.key.toUpperCase()}`)
    expect(text).not.toContain("Off")
  })

  it("marks single keys off when the preference is off", () => {
    const markup = render(
      createElement(ShortcutReference, {
        open: false,
        onClose: () => {},
        commands: COMMANDS,
        platform: "mac",
        singleKeysEnabled: false,
      }),
    )
    expect(textOf(markup)).toContain("Create a product Off")
    expect(textOf(markup)).toContain("Single-key shortcuts are off")
  })
})

describe("outside a provider", () => {
  it("the header control renders nothing", () => {
    expect(render(createElement(CommandsButton))).toBe("")
  })

  it("the setting still renders, checked by default, with no reference button", () => {
    const markup = render(createElement(KeyboardSettings))
    expect(markup).toContain('type="checkbox"')
    expect(markup).toContain("checked")
    expect(textOf(markup)).toContain("Single-key shortcuts")
    expect(markup).not.toContain("Show all shortcuts")
  })
})
