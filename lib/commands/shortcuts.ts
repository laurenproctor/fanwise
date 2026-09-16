import type { ShortcutDefinition } from "./types"

/**
 * Matching a key event to a shortcut, and writing a shortcut down.
 *
 * Pure: takes the four fields of a KeyboardEvent it needs and a platform, so
 * the unit suite can drive it from plain objects in Node.
 */

export type Platform = "mac" | "other"

/** The subset of KeyboardEvent this module reads. */
export interface KeyLike {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/**
 * Which command modifier this machine uses.
 *
 * `navigator.userAgentData.platform` where the browser has it, the deprecated
 * `navigator.platform` otherwise; both name a Mac as "macOS" or "MacIntel".
 * iPhones and iPads are included because a hardware keyboard on one uses ⌘.
 */
export function detectPlatform(nav: {
  platform?: string
  userAgentData?: { platform?: string }
}): Platform {
  const platform = nav.userAgentData?.platform ?? nav.platform ?? ""
  return /mac|iphone|ipad|ipod/i.test(platform) ? "mac" : "other"
}

/** Case-folded, so `event.key` of "K" (caps lock, or Shift) matches "k". */
function fold(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key
}

export function isSingleKey(shortcut: ShortcutDefinition): boolean {
  return !shortcut.mod && !shortcut.alt
}

/**
 * A printable single key, as opposed to a named one.
 *
 * The creator's preference switches off the printable ones — letters, `/`,
 * `?` — because those are the keys that collide with typing. Arrow keys,
 * Enter and Escape inside a focused list are a widget's ordinary behaviour
 * and stay on either way.
 */
export function isPrintableSingleKey(shortcut: ShortcutDefinition): boolean {
  return isSingleKey(shortcut) && shortcut.key.length === 1
}

export function matchesShortcut(
  event: KeyLike,
  shortcut: ShortcutDefinition,
  platform: Platform,
): boolean {
  if (fold(event.key) !== fold(shortcut.key)) return false

  const modHeld = platform === "mac" ? event.metaKey : event.ctrlKey
  const otherModHeld = platform === "mac" ? event.ctrlKey : event.metaKey

  if (shortcut.mod) {
    if (!modHeld || otherModHeld) return false
    if (event.altKey !== Boolean(shortcut.alt)) return false
    // ⌘Enter is not ⌘Shift Enter, and the other way round.
    return event.shiftKey === Boolean(shortcut.shift)
  }

  // A single key: no command modifier at all, from either platform.
  if (event.metaKey || event.ctrlKey) return false
  if (event.altKey !== Boolean(shortcut.alt)) return false
  if (shortcut.shift) return event.shiftKey
  // Shift is ignored for a plain key. A letter is the same command in either
  // case, and `?` already arrives as `?` whatever produced it.
  return true
}

const MAC_MOD = "⌘"
const OTHER_MOD = "Ctrl"

const KEY_LABELS: Record<string, string> = {
  Enter: "Enter",
  Escape: "Esc",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  " ": "Space",
}

export function keyLabel(key: string): string {
  return KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : key)
}

/**
 * The parts of a shortcut, each one a keycap: `["⌘", "Shift", "Enter"]`.
 *
 * The Mac form uses the symbol, because that is what is printed on the key;
 * everywhere else the word, because nothing on the key says ⌃. Shift and Alt
 * are written as words on both, matching the spec's own "⌘Shift Enter".
 */
export function shortcutParts(shortcut: ShortcutDefinition, platform: Platform): string[] {
  const parts: string[] = []
  if (shortcut.mod) parts.push(platform === "mac" ? MAC_MOD : OTHER_MOD)
  if (shortcut.alt) parts.push(platform === "mac" ? "Option" : "Alt")
  if (shortcut.shift) parts.push("Shift")
  parts.push(keyLabel(shortcut.key))
  return parts
}

/**
 * One string for a title attribute or a sentence: "⌘K", "Ctrl K",
 * "⌘Shift Enter". The Mac symbol joins its key without a space, the word
 * form takes one, and that asymmetry is what reads naturally in each.
 */
export function formatShortcut(shortcut: ShortcutDefinition, platform: Platform): string {
  const parts = shortcutParts(shortcut, platform)
  if (platform === "mac" && shortcut.mod) {
    const [mod, ...rest] = parts
    return `${mod}${rest.join(" ")}`
  }
  return parts.join(" ")
}

/**
 * A layout-independent identity for a shortcut, for collision detection:
 * two definitions that would answer the same keystroke get the same string.
 */
export function shortcutIdentity(shortcut: ShortcutDefinition): string {
  return [
    shortcut.mod ? "mod" : "",
    shortcut.alt ? "alt" : "",
    shortcut.shift ? "shift" : "",
    fold(shortcut.key),
  ].join("+")
}

/**
 * The `aria-keyshortcuts` value for a button that a shortcut also presses:
 * "Meta+K", "Control+Shift+Enter". Modifier names as the attribute's spec
 * writes them, never the printed symbol.
 */
export function ariaKeyShortcuts(shortcut: ShortcutDefinition, platform: Platform): string {
  const parts: string[] = []
  if (shortcut.mod) parts.push(platform === "mac" ? "Meta" : "Control")
  if (shortcut.alt) parts.push("Alt")
  if (shortcut.shift) parts.push("Shift")
  parts.push(shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key)
  return parts.join("+")
}
