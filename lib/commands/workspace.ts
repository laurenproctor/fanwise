import type { ShortcutDefinition } from "./types"

/**
 * The ids and keys of the workspace's own commands, in one place so the
 * components that register them, the buttons that label them and the tests
 * that pin them cannot drift apart.
 *
 * Product deletion has no entry here and must not get one: a key that
 * deletes is a key that deletes by accident.
 */
export const WORKSPACE_COMMAND_IDS = {
  openPalette: "palette.open",
  shortcuts: "help.shortcuts",
  createProduct: "product.create",
  importProduct: "product.import",
  focusSearch: "catalog.search",
  dismiss: "ui.dismiss",
  accountSettings: "account.settings",
  subscription: "account.subscription",
  toggleTheme: "account.theme",
  signOut: "account.sign-out",
  openProduct: (slug: string) => `product.open:${slug}`,
} as const

export const EDITOR_COMMAND_IDS = {
  save: "editor.save",
  publish: "editor.publish",
  preview: "editor.preview",
  addMedia: "editor.add-media",
  compose: "editor.compose",
} as const

export const LIST_COMMAND_IDS = {
  next: "list.next",
  previous: "list.previous",
  open: "list.open",
  edit: "list.edit",
} as const

/** The element the product list's commands are scoped to. */
export const CATALOG_SCOPE = "catalog"

/** The element `/` focuses. */
export const PRODUCT_SEARCH_SELECTOR = '[data-command-target="product-search"]'
export const SIGN_OUT_FORM_SELECTOR = 'form[data-command-target="sign-out"]'

export const PALETTE_SHORTCUT: ShortcutDefinition = { key: "k", mod: true }
export const SHORTCUTS_SHORTCUT: ShortcutDefinition = { key: "?" }
export const CREATE_SHORTCUT: ShortcutDefinition = { key: "c" }
export const IMPORT_SHORTCUT: ShortcutDefinition = { key: "i" }
export const SEARCH_SHORTCUT: ShortcutDefinition = { key: "/" }
export const DISMISS_SHORTCUT: ShortcutDefinition = { key: "Escape" }

export const SAVE_SHORTCUT: ShortcutDefinition = { key: "s", mod: true }
export const PUBLISH_SHORTCUT: ShortcutDefinition = { key: "Enter", mod: true, shift: true }
export const PREVIEW_SHORTCUT: ShortcutDefinition = { key: "p" }
export const ADD_MEDIA_SHORTCUT: ShortcutDefinition = { key: "m" }
export const COMPOSE_SHORTCUT: ShortcutDefinition = { key: "a" }

export const LIST_NEXT_SHORTCUTS: readonly ShortcutDefinition[] = [
  { key: "j" },
  { key: "ArrowDown" },
]
export const LIST_PREVIOUS_SHORTCUTS: readonly ShortcutDefinition[] = [
  { key: "k" },
  { key: "ArrowUp" },
]
export const LIST_OPEN_SHORTCUT: ShortcutDefinition = { key: "Enter" }
export const LIST_EDIT_SHORTCUT: ShortcutDefinition = { key: "e" }
