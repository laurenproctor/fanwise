"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { usePathname } from "next/navigation"
import { recordCommandEvent } from "@/lib/commands/analytics"
import {
  isVirtualKeyboardLikely,
  modifierKeyBlock,
  singleKeyBlock,
} from "@/lib/commands/input-safety"
import { SEQUENCE_DESTINATIONS } from "@/lib/commands/navigation"
import {
  readSingleKeyPreference,
  subscribePreferences,
  writePaletteOpened,
} from "@/lib/commands/preferences"
import {
  createCommandRegistry,
  findShortcutCollisions,
  resolveShortcut,
  type CommandRegistry,
} from "@/lib/commands/registry"
import { createSequenceController, SEQUENCE_KEY } from "@/lib/commands/sequence"
import {
  detectPlatform,
  formatShortcut,
  matchesShortcut,
  type Platform,
} from "@/lib/commands/shortcuts"
import { PALETTE_SHORTCUT } from "@/lib/commands/workspace"
import type { FanwiseCommand, InvocationMethod } from "@/lib/commands/types"
import { CommandPalette } from "./command-palette"
import { FanwiseGuide } from "./fanwise-guide"
import { ShortcutReference } from "./shortcut-reference"

/**
 * The one keydown listener in the application, and everything it consults.
 *
 * Mounted once by the workspace layout, which a client-side navigation never
 * remounts, so there is exactly one listener however many pages register
 * commands underneath it. Pages register through `useRegisterCommands` and
 * unregister on unmount; the listener reads the registry at the moment of
 * the keystroke, never a copy.
 *
 * Order of decision for one key, all of it in `onKeyDown` below:
 *
 *   1. Something already claimed it (`defaultPrevented`), or the palette or
 *      reference is open and handling its own keys: nothing.
 *   2. Text composition, or a dialog that is not ours: nothing.
 *   3. The F guide is open: the key is the second half of a sequence.
 *   4. A command modifier is held: match a modifier shortcut, in a field or
 *      not, and prevent the browser's default only if one matched.
 *   5. Otherwise a single key: refused on a virtual keyboard, on a held key,
 *      and inside anything editable; `F` opens the guide; anything else is
 *      looked up. A match that is disabled says why in the status bar rather
 *      than doing nothing.
 */

export interface CommandCenter {
  registry: CommandRegistry
  /** Null until hydrated: the server does not know whose keyboard this is. */
  platform: Platform | null
  singleKeysEnabled: boolean
  paletteOpen: boolean
  openPalette: () => void
  closePalette: () => void
  referenceOpen: boolean
  openReference: () => void
  closeReference: () => void
  /** Runs a command the way a button would, with the same refusal for a disabled one. */
  run: (command: FanwiseCommand, method: InvocationMethod) => void
  /** A sentence in the status bar for a moment; also read by a screen reader. */
  announce: (message: string) => void
  /**
   * Focus an element once it exists — now if it is on the page, otherwise
   * after the next navigation lands. `/` uses it to reach a search box that
   * is one route away.
   */
  requestFocus: (selector: string) => boolean
}

const CommandContext = createContext<CommandCenter | null>(null)

const NO_SUBSCRIBE = () => () => {}

/** How long a navigation is given to grow the element `/` wants to focus. */
const PENDING_FOCUS_MS = 4000

/** How long a status message stays. Long enough to read a sentence. */
const ANNOUNCE_MS = 4000

function scopesOf(target: Element | null): Set<string> {
  const scopes = new Set<string>()
  let node: Element | null = target
  while (node) {
    const scope = node.getAttribute("data-command-scope")
    if (scope) scopes.add(scope)
    node = node.parentElement
  }
  return scopes
}

/** The dialogs this provider owns, so a key inside them is never a global command. */
const OWN_DIALOG = "[data-command-dialog]"

export function CommandProvider({
  workspaceSlug,
  children,
}: {
  workspaceSlug: string
  children: React.ReactNode
}) {
  const [registry] = useState(createCommandRegistry)
  const [sequence] = useState(() =>
    createSequenceController({ destinations: SEQUENCE_DESTINATIONS }),
  )
  const pathname = usePathname()

  const platform = useSyncExternalStore<Platform | null>(
    NO_SUBSCRIBE,
    () => detectPlatform(navigator),
    () => null,
  )
  const singleKeysEnabled = useSyncExternalStore(
    subscribePreferences,
    readSingleKeyPreference,
    () => true,
  )
  const commands = useSyncExternalStore(registry.subscribe, registry.list, registry.list)
  const guideOpen = useSyncExternalStore(sequence.subscribe, sequence.isOpen, () => false)

  const [paletteOpen, setPaletteOpen] = useState(false)
  const [referenceOpen, setReferenceOpen] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingFocus = useRef<string | null>(null)

  /*
   * A completed navigation closes everything. Adjusted during the render
   * that sees the new path, as components/ui/use-disclosure.ts does, so
   * nothing is painted open on the new page and then closed.
   */
  const [renderedPath, setRenderedPath] = useState(pathname)
  if (pathname !== renderedPath) {
    setRenderedPath(pathname)
    setPaletteOpen(false)
    setReferenceOpen(false)
  }
  useEffect(() => {
    sequence.close()
  }, [pathname, sequence])

  const announce = useCallback((text: string) => {
    if (messageTimer.current) clearTimeout(messageTimer.current)
    setMessage(text)
    messageTimer.current = setTimeout(() => setMessage(null), ANNOUNCE_MS)
  }, [])

  const run = useCallback(
    (command: FanwiseCommand, method: InvocationMethod) => {
      if (!command.enabled) {
        announce(`${command.label}: ${command.disabledReason ?? "not available right now."}`)
        return
      }
      recordCommandEvent({ type: "command_executed", id: command.id, method })
      try {
        const result = command.execute()
        if (result && typeof result.then === "function") {
          result.catch(() => announce(`${command.label} could not run. Try again.`))
        }
      } catch {
        announce(`${command.label} could not run. Try again.`)
      }
    },
    [announce],
  )

  const openPalette = useCallback(() => {
    sequence.close()
    setReferenceOpen(false)
    setPaletteOpen(true)
    writePaletteOpened()
    recordCommandEvent({ type: "command_palette_opened" })
  }, [sequence])
  const closePalette = useCallback(() => setPaletteOpen(false), [])
  const openReference = useCallback(() => {
    sequence.close()
    setPaletteOpen(false)
    setReferenceOpen(true)
  }, [sequence])
  const closeReference = useCallback(() => setReferenceOpen(false), [])

  const tryFocus = useCallback((selector: string): boolean => {
    const element = document.querySelector<HTMLElement>(selector)
    if (!element) return false
    element.focus()
    return true
  }, [])

  const requestFocus = useCallback(
    (selector: string): boolean => {
      if (tryFocus(selector)) return true
      pendingFocus.current = selector
      return false
    },
    [tryFocus],
  )

  /*
   * A focus owed from before the navigation. The path changes when the
   * navigation commits, which can be while the route's loading state is
   * still on screen, so the element is watched for rather than looked for
   * once. The watch gives up after a few seconds: a page that never grows
   * the element is not owed anything.
   */
  useEffect(() => {
    const selector = pendingFocus.current
    if (!selector) return
    pendingFocus.current = null
    if (tryFocus(selector)) return
    const observer = new MutationObserver(() => {
      if (tryFocus(selector)) stop()
    })
    const timer = setTimeout(stop, PENDING_FOCUS_MS)
    function stop() {
      observer.disconnect()
      clearTimeout(timer)
    }
    observer.observe(document.body, { childList: true, subtree: true })
    return stop
  }, [pathname, tryFocus])

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return
    const collisions = findShortcutCollisions(commands)
    for (const collision of collisions) {
      console.warn(
        `[commands] ${collision.commandIds.join(" and ")} both claim ${collision.shortcut}. The first registered wins; give one a different key.`,
      )
    }
  }, [commands])

  /*
   * The listener reads the newest of everything through one ref that each
   * render refreshes, so it is attached once and never re-bound.
   */
  const latest = useRef({
    platform,
    singleKeysEnabled,
    paletteOpen,
    referenceOpen,
    run,
    closePalette,
  })
  useEffect(() => {
    latest.current = { platform, singleKeysEnabled, paletteOpen, referenceOpen, run, closePalette }
  })

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const state = latest.current
      if (event.defaultPrevented) return
      // A held key is one keystroke, whatever it is.
      if (event.repeat) return

      const platform = state.platform ?? detectPlatform(navigator)
      const modifierHeld = event.metaKey || event.ctrlKey || event.altKey

      // The palette handles its own keys; ⌘K while it is open closes it.
      if (state.paletteOpen) {
        if (modifierHeld && matchesShortcut(event, PALETTE_SHORTCUT, platform)) {
          event.preventDefault()
          state.closePalette()
        }
        return
      }
      if (state.referenceOpen) return

      const target = event.target instanceof Element ? event.target : null
      const eventLike = { isComposing: event.isComposing, keyCode: event.keyCode, target }
      if (modifierKeyBlock(eventLike, { ownDialog: OWN_DIALOG })) return

      const liveCommands = registry.list()

      if (sequence.isOpen()) {
        if (event.key === "Escape") {
          sequence.close()
          event.preventDefault()
          return
        }
        // A chord while the guide is up was not meant for it. Close, and
        // let the chord be what it is.
        if (modifierHeld) {
          sequence.close()
        } else {
          const outcome = sequence.press(event.key)
          if (outcome.kind === "ignored") return
          event.preventDefault()
          if (outcome.kind === "navigate") {
            const command = registry.get(outcome.destination.commandId)
            if (command) state.run(command, "sequence")
          }
          return
        }
      }

      const activeScopes = scopesOf(target)

      if (modifierHeld) {
        const command = resolveShortcut(liveCommands, event, {
          platform,
          printableSingleKeys: false,
          singleKeysAllowed: false,
          activeScopes,
        })
        if (!command) return
        event.preventDefault()
        state.run(command, "shortcut")
        return
      }

      // Escape with nothing of ours open belongs to whatever else is
      // listening. The palette, the guide and the reference each close on
      // it themselves, above.
      if (event.key === "Escape") return
      if (isVirtualKeyboardLikely((query) => window.matchMedia(query))) return
      if (singleKeyBlock(eventLike, { ownDialog: OWN_DIALOG })) return

      const folded = event.key.length === 1 ? event.key.toLowerCase() : event.key
      if (state.singleKeysEnabled && folded === SEQUENCE_KEY) {
        sequence.press(event.key)
        event.preventDefault()
        return
      }

      const command = resolveShortcut(liveCommands, event, {
        platform,
        printableSingleKeys: state.singleKeysEnabled,
        singleKeysAllowed: true,
        activeScopes,
      })
      if (!command) return
      event.preventDefault()
      state.run(command, "shortcut")
    }

    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [registry, sequence])

  useEffect(() => () => sequence.dispose(), [sequence])
  useEffect(
    () => () => {
      if (messageTimer.current) clearTimeout(messageTimer.current)
    },
    [],
  )

  const center = useMemo<CommandCenter>(
    () => ({
      registry,
      platform,
      singleKeysEnabled,
      paletteOpen,
      openPalette,
      closePalette,
      referenceOpen,
      openReference,
      closeReference,
      run,
      announce,
      requestFocus,
    }),
    [
      registry,
      platform,
      singleKeysEnabled,
      paletteOpen,
      openPalette,
      closePalette,
      referenceOpen,
      openReference,
      closeReference,
      run,
      announce,
      requestFocus,
    ],
  )

  return (
    <CommandContext.Provider value={center}>
      {children}
      <CommandPalette
        open={paletteOpen}
        onClose={closePalette}
        commands={commands}
        platform={platform ?? "other"}
        run={run}
        workspaceSlug={workspaceSlug}
      />
      <ShortcutReference
        open={referenceOpen}
        onClose={closeReference}
        commands={commands}
        platform={platform ?? "other"}
        singleKeysEnabled={singleKeysEnabled}
      />
      <FanwiseGuide open={guideOpen} message={message} />
    </CommandContext.Provider>
  )
}

/** The command centre, or null outside a workspace (and in a static render). */
export function useCommandCenter(): CommandCenter | null {
  return useContext(CommandContext)
}

/**
 * The key a registration is compared by: everything but `execute`. A row is
 * re-registered only when one of these changes, and never merely because
 * the component rendered again and rebuilt its closures.
 */
function descriptorKey(command: FanwiseCommand): string {
  return JSON.stringify([
    command.id,
    command.label,
    command.description ?? "",
    command.group,
    command.keywords ?? [],
    command.shortcuts ?? [],
    command.scope,
    command.within ?? "",
    command.enabled,
    command.disabledReason ?? "",
    command.hidden ?? false,
  ])
}

/**
 * Registers commands for as long as the calling component is mounted.
 *
 * The registered rows execute through a ref to the latest `commands`, so a
 * closure from the most recent render runs whatever render registered the
 * row. That is what keeps one keystroke to one execution: registration does
 * not churn on every render, and the execution is never a stale closure.
 *
 * A no-op without a provider, so a component that registers commands still
 * renders in a static test.
 */
export function useRegisterCommands(commands: readonly FanwiseCommand[]): void {
  const registry = useCommandCenter()?.registry ?? null
  const latest = useRef(commands)
  useEffect(() => {
    latest.current = commands
  })

  const key = commands.map(descriptorKey).join("\n")
  useEffect(() => {
    if (!registry) return
    const rows = latest.current.map((command) => ({
      ...command,
      execute: () => latest.current.find((c) => c.id === command.id)?.execute(),
    }))
    return registry.register(rows)
    // `key` stands in for the descriptors; `commands` itself is a fresh
    // array every render and is read through the ref instead. The registry
    // is stable for the provider's life, so a palette opening does not
    // re-register every page's rows.
  }, [registry, key])
}

/**
 * The printed shortcut for a registered command, for a label beside the
 * button that does the same thing. Null until the platform is known, and
 * null for a command with no shortcut or no registration.
 */
export function useShortcut(commandId: string): {
  label: string
  platform: Platform
  shortcut: NonNullable<FanwiseCommand["shortcuts"]>[number]
} | null {
  const center = useCommandCenter()
  const commands = useSyncExternalStore(
    center?.registry.subscribe ?? NO_SUBSCRIBE,
    center?.registry.list ?? (() => []),
    center?.registry.list ?? (() => []),
  )
  if (!center || !center.platform) return null
  const shortcut = commands.find((c) => c.id === commandId)?.shortcuts?.[0]
  if (!shortcut) return null
  return { label: formatShortcut(shortcut, center.platform), platform: center.platform, shortcut }
}
