import { describe, expect, it } from "vitest"
import {
  ariaKeyShortcuts,
  detectPlatform,
  formatShortcut,
  isPrintableSingleKey,
  matchesShortcut,
  shortcutIdentity,
  shortcutParts,
  type KeyLike,
} from "@/lib/commands/shortcuts"

/**
 * Matching a keystroke to a shortcut, on both kinds of keyboard.
 *
 * Pure functions over the four fields of a KeyboardEvent, so this runs in
 * Node. What a real browser adds — composition, repeat, the target — is
 * lib/commands/input-safety.ts and the provider, tested separately and in
 * tests/e2e/keyboard-commands.spec.ts.
 */

function key(overrides: Partial<KeyLike> & { key: string }): KeyLike {
  return { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...overrides }
}

describe("detectPlatform", () => {
  it("reads a Mac from either platform field, and everything else as other", () => {
    expect(detectPlatform({ platform: "MacIntel" })).toBe("mac")
    expect(detectPlatform({ userAgentData: { platform: "macOS" } })).toBe("mac")
    expect(detectPlatform({ platform: "iPhone" })).toBe("mac")
    expect(detectPlatform({ platform: "Win32" })).toBe("other")
    expect(detectPlatform({ userAgentData: { platform: "Linux" }, platform: "MacIntel" })).toBe(
      "other",
    )
    expect(detectPlatform({})).toBe("other")
  })
})

describe("matchesShortcut", () => {
  const paletteShortcut = { key: "k", mod: true }

  it("opens on ⌘K on a Mac and Ctrl K elsewhere, and not the other way round", () => {
    expect(matchesShortcut(key({ key: "k", metaKey: true }), paletteShortcut, "mac")).toBe(true)
    expect(matchesShortcut(key({ key: "k", ctrlKey: true }), paletteShortcut, "mac")).toBe(false)
    expect(matchesShortcut(key({ key: "k", ctrlKey: true }), paletteShortcut, "other")).toBe(true)
    expect(matchesShortcut(key({ key: "k", metaKey: true }), paletteShortcut, "other")).toBe(false)
  })

  it("refuses a modifier shortcut with an extra modifier held", () => {
    expect(
      matchesShortcut(key({ key: "k", metaKey: true, ctrlKey: true }), paletteShortcut, "mac"),
    ).toBe(false)
    expect(
      matchesShortcut(key({ key: "k", metaKey: true, shiftKey: true }), paletteShortcut, "mac"),
    ).toBe(false)
    expect(
      matchesShortcut(key({ key: "k", metaKey: true, altKey: true }), paletteShortcut, "mac"),
    ).toBe(false)
  })

  it("keeps ⌘Enter and ⌘Shift Enter apart", () => {
    const next = { key: "Enter", mod: true }
    const publish = { key: "Enter", mod: true, shift: true }
    const plain = key({ key: "Enter", metaKey: true })
    const shifted = key({ key: "Enter", metaKey: true, shiftKey: true })
    expect(matchesShortcut(plain, next, "mac")).toBe(true)
    expect(matchesShortcut(plain, publish, "mac")).toBe(false)
    expect(matchesShortcut(shifted, next, "mac")).toBe(false)
    expect(matchesShortcut(shifted, publish, "mac")).toBe(true)
  })

  it("matches a single letter in either case and never with a command modifier", () => {
    const create = { key: "c" }
    expect(matchesShortcut(key({ key: "c" }), create, "mac")).toBe(true)
    expect(matchesShortcut(key({ key: "C", shiftKey: true }), create, "mac")).toBe(true)
    expect(matchesShortcut(key({ key: "c", metaKey: true }), create, "mac")).toBe(false)
    expect(matchesShortcut(key({ key: "c", ctrlKey: true }), create, "other")).toBe(false)
    expect(matchesShortcut(key({ key: "c", altKey: true }), create, "other")).toBe(false)
  })

  it("matches ? by the character the layout produced", () => {
    expect(matchesShortcut(key({ key: "?", shiftKey: true }), { key: "?" }, "other")).toBe(true)
    expect(matchesShortcut(key({ key: "/", shiftKey: true }), { key: "?" }, "other")).toBe(false)
  })

  it("matches named keys exactly", () => {
    expect(matchesShortcut(key({ key: "ArrowDown" }), { key: "ArrowDown" }, "mac")).toBe(true)
    expect(matchesShortcut(key({ key: "Down" }), { key: "ArrowDown" }, "mac")).toBe(false)
  })
})

describe("writing a shortcut down", () => {
  it("prints the platform's modifier", () => {
    expect(formatShortcut({ key: "k", mod: true }, "mac")).toBe("⌘K")
    expect(formatShortcut({ key: "k", mod: true }, "other")).toBe("Ctrl K")
    expect(formatShortcut({ key: "Enter", mod: true, shift: true }, "mac")).toBe("⌘Shift Enter")
    expect(formatShortcut({ key: "Enter", mod: true, shift: true }, "other")).toBe(
      "Ctrl Shift Enter",
    )
    expect(formatShortcut({ key: "c" }, "mac")).toBe("C")
    expect(formatShortcut({ key: "?" }, "other")).toBe("?")
    expect(formatShortcut({ key: "ArrowDown" }, "mac")).toBe("↓")
  })

  it("splits into keycaps", () => {
    expect(shortcutParts({ key: "Enter", mod: true, shift: true }, "other")).toEqual([
      "Ctrl",
      "Shift",
      "Enter",
    ])
    expect(shortcutParts({ key: "s", mod: true }, "mac")).toEqual(["⌘", "S"])
  })

  it("writes aria-keyshortcuts as the attribute spells modifiers", () => {
    expect(ariaKeyShortcuts({ key: "k", mod: true }, "mac")).toBe("Meta+K")
    expect(ariaKeyShortcuts({ key: "Enter", mod: true, shift: true }, "other")).toBe(
      "Control+Shift+Enter",
    )
    expect(ariaKeyShortcuts({ key: "p" }, "mac")).toBe("P")
  })

  it("identifies a shortcut without regard to case or platform", () => {
    expect(shortcutIdentity({ key: "K", mod: true })).toBe(
      shortcutIdentity({ key: "k", mod: true }),
    )
    expect(shortcutIdentity({ key: "k", mod: true })).not.toBe(shortcutIdentity({ key: "k" }))
  })

  it("knows which single keys the preference governs", () => {
    expect(isPrintableSingleKey({ key: "c" })).toBe(true)
    expect(isPrintableSingleKey({ key: "/" })).toBe(true)
    expect(isPrintableSingleKey({ key: "ArrowDown" })).toBe(false)
    expect(isPrintableSingleKey({ key: "Escape" })).toBe(false)
    expect(isPrintableSingleKey({ key: "s", mod: true })).toBe(false)
  })
})
