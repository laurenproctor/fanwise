/**
 * When a keystroke is typing, not a command.
 *
 * Every single-key shortcut asks this before it fires, and the answer is a
 * reason rather than a boolean so a test can say which rule refused. The
 * rules are written against the DOM shapes Fanwise actually renders — native
 * fields, the rich-text editor's ProseMirror surface, the ARIA combobox, an
 * open <dialog>, an open menu — plus one opt-out any element can carry:
 *
 *   data-shortcuts="off"
 *
 * on an ancestor turns single keys off underneath it, for a control that is
 * neither a field nor a dialog but takes typing all the same.
 *
 * Modifier shortcuts (⌘K, ⌘S) are not held to the editable-target rules:
 * saving from inside a textarea is the whole point of ⌘S. They are held to
 * the composition and dialog rules, which are about the page's state rather
 * than the field's.
 */

export type ShortcutBlock =
  "composing" | "editable" | "select" | "file" | "combobox" | "menu" | "dialog" | "opted-out"

/** The subset of Element this module reads, so it can be driven without a DOM. */
export interface TargetLike {
  tagName: string
  isContentEditable?: boolean
  getAttribute(name: string): string | null
  closest(selector: string): TargetLike | null
}

export interface KeyEventLike {
  isComposing?: boolean
  keyCode?: number
  target: TargetLike | null
}

/** Input types that take no typing and so are safe to fire a single key from. */
const NON_TEXT_INPUT_TYPES = new Set(["button", "submit", "reset", "checkbox", "radio", "image"])

const EDITABLE_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton", "slider"])
const MENU_ROLES = new Set(["menu", "menubar", "menuitem", "menuitemcheckbox", "menuitemradio"])

/** Text composition: an IME, dictation, or a dead key mid-sequence. */
export function isComposing(event: KeyEventLike): boolean {
  return event.isComposing === true || event.keyCode === 229
}

/**
 * Why a single-key shortcut must not fire from this event, or null.
 *
 * `ownDialog` is the selector of a dialog whose own commands are allowed —
 * the palette and the reference handle their keys themselves, and a global
 * command inside them would be a second answer to one keystroke.
 */
export function singleKeyBlock(
  event: KeyEventLike,
  options: { ownDialog?: string } = {},
): ShortcutBlock | null {
  if (isComposing(event)) return "composing"
  const target = event.target
  if (!target) return null

  if (target.closest('[data-shortcuts="off"]')) return "opted-out"

  const tag = target.tagName.toLowerCase()
  if (tag === "input") {
    const type = (target.getAttribute("type") ?? "text").toLowerCase()
    if (type === "file") return "file"
    if (!NON_TEXT_INPUT_TYPES.has(type)) return "editable"
  }
  if (tag === "textarea") return "editable"
  if (tag === "select") return "select"

  if (target.isContentEditable) return "editable"
  const editable = target.getAttribute("contenteditable")
  if (editable !== null && editable !== "false") return "editable"
  // The rich-text editor's surface, whatever wraps it.
  if (target.closest(".ProseMirror")) return "editable"

  const role = (target.getAttribute("role") ?? "").toLowerCase()
  if (role === "combobox") return "combobox"
  if (EDITABLE_ROLES.has(role)) return "editable"
  if (MENU_ROLES.has(role) || target.closest('[role="menu"], [role="menubar"]')) return "menu"
  // A control whose popup is open owns the keyboard until it closes.
  if (target.getAttribute("aria-expanded") === "true") return "menu"

  return dialogBlock(target, options.ownDialog)
}

/**
 * Why a modifier shortcut must not fire, or null. Fewer rules on purpose;
 * see the file comment.
 */
export function modifierKeyBlock(
  event: KeyEventLike,
  options: { ownDialog?: string } = {},
): ShortcutBlock | null {
  if (isComposing(event)) return "composing"
  return event.target ? dialogBlock(event.target, options.ownDialog) : null
}

function dialogBlock(target: TargetLike, ownDialog: string | undefined): ShortcutBlock | null {
  const dialog = target.closest("dialog[open]")
  if (!dialog) return null
  if (ownDialog && dialog.closest(ownDialog)) return null
  return "dialog"
}

/**
 * A touch device with no pointer that hovers, which is where a keyboard is a
 * panel drawn over the page and only ever appears with a field focused. A
 * single key there is always typing, so the layer is off entirely.
 */
export function isVirtualKeyboardLikely(
  matchMedia: (query: string) => { matches: boolean },
): boolean {
  return matchMedia("(hover: none) and (pointer: coarse)").matches
}
