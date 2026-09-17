/**
 * The command registry's vocabulary.
 *
 * One typed record per thing a keyboard can do, and the registry of them is
 * the single source of truth: the keydown handler, the command palette, the
 * shortcut reference and the labels beside buttons all read the same rows.
 * A command that is not here cannot be pressed, listed or explained, which is
 * the point — there is no second place a shortcut can be defined.
 */

/**
 * Where a command is live.
 *
 * - `global`: everywhere in the workspace.
 * - `navigation`: everywhere too, but reached through the `F` layer as well
 *   as the palette. Separate so the guide and the reference can list them.
 * - `page`: only while the component that registered it is mounted, which is
 *   how "only on the product editor" is enforced: the editor registers on
 *   mount and unregisters on unmount, and nothing else has to know the route.
 * - `selection`: only while keyboard focus is inside the element that owns
 *   the scope (`within`). The product list's J/K/Enter live here, so they
 *   never capture keys from the rest of the page.
 */
export type CommandScope = "global" | "navigation" | "page" | "selection"

/** The palette's sections, in the order they are shown. */
export type CommandGroup = "suggested" | "quick" | "page" | "products" | "navigation" | "account"

export const COMMAND_GROUP_LABELS: Record<CommandGroup, string> = {
  suggested: "Suggested",
  quick: "Quick actions",
  page: "Current page",
  products: "Products",
  navigation: "Navigation",
  account: "Account and settings",
}

export const COMMAND_GROUP_ORDER: readonly CommandGroup[] = [
  "suggested",
  "quick",
  "page",
  "products",
  "navigation",
  "account",
]

/**
 * One key combination.
 *
 * `key` is compared against `KeyboardEvent.key`, case-insensitively, so it
 * follows the keyboard layout: `?` is whatever key produces a question mark,
 * not "Shift and the slash key". `mod` is the platform's command modifier —
 * ⌘ on a Mac, Ctrl elsewhere — and a shortcut with `mod` never matches when
 * the other one is held, so ⌘K on a Mac is not Ctrl+K and Ctrl+⌘K is neither.
 *
 * A shortcut with no modifier is a "single key". Single keys are refused
 * inside anything editable, are subject to the creator's preference, and
 * ignore Shift so that a letter matches whether or not caps lock is on.
 */
export interface ShortcutDefinition {
  key: string
  mod?: boolean
  shift?: boolean
  alt?: boolean
}

/** How a command was invoked, for analytics. Never the keys themselves. */
export type InvocationMethod = "palette" | "shortcut" | "sequence" | "button"

export interface FanwiseCommand {
  /** Stable, dotted, and the analytics identifier: `nav.products`, `editor.save`. */
  id: string
  label: string
  /** One quieter line under the label in the palette. */
  description?: string
  group: CommandGroup
  /** Words a creator might type that are not in the label. */
  keywords?: readonly string[]
  shortcuts?: readonly ShortcutDefinition[]
  scope: CommandScope
  /**
   * For `selection` scope: the `data-command-scope` value of the element the
   * keyboard focus must be inside. Ignored for every other scope.
   */
  within?: string
  enabled: boolean
  /** Why it cannot run right now. Shown in the palette; required when disabled. */
  disabledReason?: string
  /**
   * Whether the command is listed when the palette has no search text. The
   * catalog's every product is searchable but not listed; the recent ones are
   * offered under Suggested instead.
   */
  hidden?: boolean
  execute: () => void | Promise<void>
}

/** The `F` layer's destinations: the key after `F`, and the command it runs. */
export interface SequenceDestination {
  key: string
  label: string
  commandId: string
}
