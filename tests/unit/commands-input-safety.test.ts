import { describe, expect, it } from "vitest"
import {
  isVirtualKeyboardLikely,
  modifierKeyBlock,
  singleKeyBlock,
  type KeyEventLike,
  type TargetLike,
} from "@/lib/commands/input-safety"

/**
 * When a key is typing rather than a command.
 *
 * Targets are small fakes: a tag, its attributes, and the selectors an
 * ancestor would answer. That is every question the module asks of a DOM.
 */

function target({
  tag = "div",
  attrs = {},
  ancestors = [],
  contentEditable = false,
}: {
  tag?: string
  attrs?: Record<string, string>
  ancestors?: string[]
  contentEditable?: boolean
} = {}): TargetLike {
  const self: TargetLike = {
    tagName: tag.toUpperCase(),
    isContentEditable: contentEditable,
    getAttribute: (name) => attrs[name] ?? null,
    closest: (selector) => {
      // An element matches its own selectors as well as its ancestors'.
      if (ancestors.includes(selector)) return ancestorFor(selector)
      return null
    },
  }
  function ancestorFor(selector: string): TargetLike {
    return {
      tagName: "DIV",
      getAttribute: () => null,
      // The ancestor answers only for itself, and for the "own dialog"
      // marker when the test put one on it.
      closest: (inner) =>
        inner === selector || ancestors.includes(`${selector} ${inner}`) ? self : null,
    }
  }
  return self
}

function event(t: TargetLike | null, extra: Partial<KeyEventLike> = {}): KeyEventLike {
  return { target: t, ...extra }
}

describe("singleKeyBlock", () => {
  it("lets a plain element through", () => {
    expect(singleKeyBlock(event(target()))).toBeNull()
    expect(singleKeyBlock(event(target({ tag: "a" })))).toBeNull()
    expect(singleKeyBlock(event(target({ tag: "button" })))).toBeNull()
    expect(singleKeyBlock(event(null))).toBeNull()
  })

  it("refuses text entry of every kind", () => {
    expect(singleKeyBlock(event(target({ tag: "input" })))).toBe("editable")
    expect(singleKeyBlock(event(target({ tag: "input", attrs: { type: "search" } })))).toBe(
      "editable",
    )
    expect(singleKeyBlock(event(target({ tag: "input", attrs: { type: "number" } })))).toBe(
      "editable",
    )
    expect(singleKeyBlock(event(target({ tag: "textarea" })))).toBe("editable")
    expect(singleKeyBlock(event(target({ contentEditable: true })))).toBe("editable")
    expect(singleKeyBlock(event(target({ attrs: { contenteditable: "" } })))).toBe("editable")
    expect(singleKeyBlock(event(target({ attrs: { contenteditable: "plaintext-only" } })))).toBe(
      "editable",
    )
    expect(singleKeyBlock(event(target({ ancestors: [".ProseMirror"] })))).toBe("editable")
    expect(singleKeyBlock(event(target({ attrs: { role: "textbox" } })))).toBe("editable")
    expect(singleKeyBlock(event(target({ attrs: { role: "searchbox" } })))).toBe("editable")
  })

  it("lets inputs that take no typing through", () => {
    for (const type of ["checkbox", "radio", "button", "submit"]) {
      expect(singleKeyBlock(event(target({ tag: "input", attrs: { type } })))).toBeNull()
    }
    expect(singleKeyBlock(event(target({ attrs: { contenteditable: "false" } })))).toBeNull()
  })

  it("refuses selects, file pickers, comboboxes and open menus", () => {
    expect(singleKeyBlock(event(target({ tag: "select" })))).toBe("select")
    expect(singleKeyBlock(event(target({ tag: "input", attrs: { type: "file" } })))).toBe("file")
    expect(singleKeyBlock(event(target({ attrs: { role: "combobox" } })))).toBe("combobox")
    expect(singleKeyBlock(event(target({ attrs: { role: "menuitem" } })))).toBe("menu")
    expect(singleKeyBlock(event(target({ ancestors: ['[role="menu"], [role="menubar"]'] })))).toBe(
      "menu",
    )
    expect(singleKeyBlock(event(target({ attrs: { "aria-expanded": "true" } })))).toBe("menu")
    expect(singleKeyBlock(event(target({ attrs: { "aria-expanded": "false" } })))).toBeNull()
  })

  it("refuses during composition, by either signal", () => {
    expect(singleKeyBlock(event(target(), { isComposing: true }))).toBe("composing")
    expect(singleKeyBlock(event(target(), { keyCode: 229 }))).toBe("composing")
    // Composition wins even over an otherwise safe target.
    expect(singleKeyBlock(event(target({ tag: "button" }), { isComposing: true }))).toBe(
      "composing",
    )
  })

  it("refuses inside an open dialog unless it is our own", () => {
    expect(singleKeyBlock(event(target({ ancestors: ["dialog[open]"] })))).toBe("dialog")
    expect(
      singleKeyBlock(event(target({ ancestors: ["dialog[open]", "dialog[open] [data-own]"] })), {
        ownDialog: "[data-own]",
      }),
    ).toBeNull()
    expect(
      singleKeyBlock(event(target({ ancestors: ["dialog[open]"] })), { ownDialog: "[data-own]" }),
    ).toBe("dialog")
  })

  it("honours the explicit opt-out", () => {
    expect(
      singleKeyBlock(event(target({ tag: "button", ancestors: ['[data-shortcuts="off"]'] }))),
    ).toBe("opted-out")
  })
})

describe("modifierKeyBlock", () => {
  it("allows a modifier shortcut from inside a field", () => {
    expect(modifierKeyBlock(event(target({ tag: "textarea" })))).toBeNull()
    expect(modifierKeyBlock(event(target({ tag: "input" })))).toBeNull()
    expect(modifierKeyBlock(event(target({ contentEditable: true })))).toBeNull()
  })

  it("still refuses composition and a foreign dialog", () => {
    expect(modifierKeyBlock(event(target({ tag: "textarea" }), { isComposing: true }))).toBe(
      "composing",
    )
    expect(modifierKeyBlock(event(target({ ancestors: ["dialog[open]"] })))).toBe("dialog")
  })
})

describe("isVirtualKeyboardLikely", () => {
  it("is the coarse, hoverless pointer", () => {
    expect(isVirtualKeyboardLikely(() => ({ matches: true }))).toBe(true)
    expect(isVirtualKeyboardLikely(() => ({ matches: false }))).toBe(false)
  })
})
