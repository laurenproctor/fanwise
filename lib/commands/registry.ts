import {
  isPrintableSingleKey,
  isSingleKey,
  matchesShortcut,
  shortcutIdentity,
  type KeyLike,
  type Platform,
} from "./shortcuts"
import type { CommandScope, FanwiseCommand } from "./types"

/**
 * The registry: every command that is live right now, by id.
 *
 * Components register on mount and unregister on unmount, and a command
 * re-registered under the same id replaces the earlier row — that is how a
 * command whose availability follows product state stays current without
 * ever being present twice. The registry is not React; it is a Map with a
 * subscription, read through useSyncExternalStore.
 */

export interface CommandRegistry {
  /** Adds or replaces. Returns the matching removal, which removes only what this call added. */
  register(commands: readonly FanwiseCommand[]): () => void
  get(id: string): FanwiseCommand | undefined
  /** Every live command. The same array until something changes. */
  list(): readonly FanwiseCommand[]
  subscribe(listener: () => void): () => void
}

export function createCommandRegistry(): CommandRegistry {
  const rows = new Map<string, { command: FanwiseCommand; token: symbol }>()
  const listeners = new Set<() => void>()
  let snapshot: readonly FanwiseCommand[] = []
  let dirty = false

  function notify() {
    dirty = true
    for (const listener of listeners) listener()
  }

  return {
    register(commands) {
      const token = Symbol("registration")
      for (const command of commands) rows.set(command.id, { command, token })
      notify()
      return () => {
        let removed = false
        for (const command of commands) {
          const row = rows.get(command.id)
          if (row && row.token === token) {
            rows.delete(command.id)
            removed = true
          }
        }
        if (removed) notify()
      }
    },
    get(id) {
      return rows.get(id)?.command
    },
    list() {
      if (dirty) {
        snapshot = Array.from(rows.values(), (row) => row.command)
        dirty = false
      }
      return snapshot
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/**
 * The narrower scope wins when two commands answer one key. A product page's
 * `P` (preview this product) and a focused list row's `P` (preview that row)
 * never coexist, but if a page ever registers a letter the workspace also
 * uses, the page meant it.
 */
const SCOPE_PRIORITY: Record<CommandScope, number> = {
  selection: 3,
  page: 2,
  navigation: 1,
  global: 0,
}

export interface ResolveOptions {
  platform: Platform
  /** Whether plain printable keys are on (the creator's preference). */
  printableSingleKeys: boolean
  /** Whether the event is safe for single keys at all (not typing). */
  singleKeysAllowed: boolean
  /** The `data-command-scope` values focus is currently inside. */
  activeScopes: ReadonlySet<string>
}

/**
 * The command a keystroke means, or null.
 *
 * Disabled commands are returned too: a recognised shortcut on a command
 * that cannot run right now is the moment to say why, and the caller decides
 * how. What is never returned is a command whose scope is not active.
 */
export function resolveShortcut(
  commands: readonly FanwiseCommand[],
  event: KeyLike,
  options: ResolveOptions,
): FanwiseCommand | null {
  let best: FanwiseCommand | null = null
  for (const command of commands) {
    if (!command.shortcuts) continue
    if (
      command.scope === "selection" &&
      !(command.within && options.activeScopes.has(command.within))
    )
      continue
    for (const shortcut of command.shortcuts) {
      if (isSingleKey(shortcut)) {
        if (!options.singleKeysAllowed) continue
        if (isPrintableSingleKey(shortcut) && !options.printableSingleKeys) continue
      }
      if (!matchesShortcut(event, shortcut, options.platform)) continue
      if (!best || SCOPE_PRIORITY[command.scope] > SCOPE_PRIORITY[best.scope]) best = command
    }
  }
  return best
}

export interface ShortcutCollision {
  shortcut: string
  commandIds: string[]
}

/**
 * Two live commands in the same scope claiming one keystroke.
 *
 * Different scopes are not collisions — the priority above settles them and
 * the narrower one is the intent. Two `selection` commands are only in
 * conflict when they watch the same element.
 */
export function findShortcutCollisions(commands: readonly FanwiseCommand[]): ShortcutCollision[] {
  const claims = new Map<string, string[]>()
  for (const command of commands) {
    for (const shortcut of command.shortcuts ?? []) {
      const key = `${command.scope}:${command.within ?? ""}:${shortcutIdentity(shortcut)}`
      const ids = claims.get(key) ?? []
      if (!ids.includes(command.id)) ids.push(command.id)
      claims.set(key, ids)
    }
  }
  const collisions: ShortcutCollision[] = []
  for (const [key, ids] of claims) {
    if (ids.length > 1)
      collisions.push({ shortcut: key.split(":").slice(2).join(":"), commandIds: ids })
  }
  return collisions
}
