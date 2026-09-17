import { describe, expect, it, vi } from "vitest"
import {
  createCommandRegistry,
  findShortcutCollisions,
  resolveShortcut,
  type ResolveOptions,
} from "@/lib/commands/registry"
import type { FanwiseCommand } from "@/lib/commands/types"
import {
  ADD_MEDIA_SHORTCUT,
  COMPOSE_SHORTCUT,
  CREATE_SHORTCUT,
  DISMISS_SHORTCUT,
  EDITOR_COMMAND_IDS,
  IMPORT_SHORTCUT,
  LIST_COMMAND_IDS,
  LIST_EDIT_SHORTCUT,
  LIST_NEXT_SHORTCUTS,
  LIST_OPEN_SHORTCUT,
  LIST_PREVIOUS_SHORTCUTS,
  PALETTE_SHORTCUT,
  PREVIEW_SHORTCUT,
  PUBLISH_SHORTCUT,
  SAVE_SHORTCUT,
  SEARCH_SHORTCUT,
  SHORTCUTS_SHORTCUT,
  WORKSPACE_COMMAND_IDS,
} from "@/lib/commands/workspace"
import { SEQUENCE_KEY } from "@/lib/commands/sequence"

function command(overrides: Partial<FanwiseCommand> & { id: string }): FanwiseCommand {
  return {
    label: overrides.id,
    group: "quick",
    scope: "global",
    enabled: true,
    execute: () => {},
    ...overrides,
  }
}

const OPTIONS: ResolveOptions = {
  platform: "mac",
  printableSingleKeys: true,
  singleKeysAllowed: true,
  activeScopes: new Set(),
}

function press(key: string, mods: Partial<{ meta: boolean; ctrl: boolean; shift: boolean }> = {}) {
  return {
    key,
    metaKey: mods.meta ?? false,
    ctrlKey: mods.ctrl ?? false,
    altKey: false,
    shiftKey: mods.shift ?? false,
  }
}

describe("the registry", () => {
  it("lists what is registered, replaces by id, and removes only its own rows", () => {
    const registry = createCommandRegistry()
    const changes = vi.fn()
    registry.subscribe(changes)

    const first = registry.register([command({ id: "a", label: "A one" })])
    expect(registry.list().map((c) => c.label)).toEqual(["A one"])

    // A second registration of the same id is the newer state of the same
    // command, not a duplicate.
    const second = registry.register([command({ id: "a", label: "A two" }), command({ id: "b" })])
    expect(registry.list().map((c) => c.label)).toEqual(["A two", "b"])
    expect(registry.list()).toHaveLength(2)

    // The first registration's cleanup must not remove the row the second
    // now owns — that is the unmount-after-remount race.
    first()
    expect(registry.list().map((c) => c.id)).toEqual(["a", "b"])
    second()
    expect(registry.list()).toEqual([])
    // Two registrations, one removal that removed something. The stale
    // cleanup that removed nothing said nothing.
    expect(changes).toHaveBeenCalledTimes(3)
  })

  it("hands back the same array until something changes", () => {
    const registry = createCommandRegistry()
    registry.register([command({ id: "a" })])
    const snapshot = registry.list()
    expect(registry.list()).toBe(snapshot)
    registry.register([command({ id: "b" })])
    expect(registry.list()).not.toBe(snapshot)
  })
})

describe("resolveShortcut", () => {
  const commands = [
    command({ id: "create", shortcuts: [CREATE_SHORTCUT] }),
    command({ id: "palette", shortcuts: [PALETTE_SHORTCUT] }),
    command({ id: "off", shortcuts: [{ key: "x" }], enabled: false, disabledReason: "Not now." }),
    command({
      id: "list.next",
      scope: "selection",
      within: "catalog",
      shortcuts: [{ key: "j" }, { key: "ArrowDown" }],
    }),
    command({ id: "page.p", scope: "page", shortcuts: [{ key: "p" }] }),
    command({ id: "global.p", scope: "global", shortcuts: [{ key: "p" }] }),
  ]

  it("finds a single key and a modifier key", () => {
    expect(resolveShortcut(commands, press("c"), OPTIONS)?.id).toBe("create")
    expect(resolveShortcut(commands, press("k", { meta: true }), OPTIONS)?.id).toBe("palette")
    expect(resolveShortcut(commands, press("k", { ctrl: true }), OPTIONS)).toBeNull()
    expect(
      resolveShortcut(commands, press("k", { ctrl: true }), { ...OPTIONS, platform: "other" })?.id,
    ).toBe("palette")
  })

  it("returns a disabled command so the caller can say why", () => {
    expect(resolveShortcut(commands, press("x"), OPTIONS)?.disabledReason).toBe("Not now.")
  })

  it("refuses every single key when single keys are not allowed", () => {
    const opts = { ...OPTIONS, singleKeysAllowed: false }
    expect(resolveShortcut(commands, press("c"), opts)).toBeNull()
    expect(resolveShortcut(commands, press("k", { meta: true }), opts)?.id).toBe("palette")
  })

  it("refuses printable single keys under the preference but keeps named keys", () => {
    const opts = { ...OPTIONS, printableSingleKeys: false, activeScopes: new Set(["catalog"]) }
    expect(resolveShortcut(commands, press("c"), opts)).toBeNull()
    expect(resolveShortcut(commands, press("j"), opts)).toBeNull()
    expect(resolveShortcut(commands, press("ArrowDown"), opts)?.id).toBe("list.next")
  })

  it("resolves a selection command only inside its element", () => {
    expect(resolveShortcut(commands, press("j"), OPTIONS)).toBeNull()
    expect(
      resolveShortcut(commands, press("j"), { ...OPTIONS, activeScopes: new Set(["catalog"]) })?.id,
    ).toBe("list.next")
  })

  it("lets the narrower scope win a shared key", () => {
    expect(resolveShortcut(commands, press("p"), OPTIONS)?.id).toBe("page.p")
  })
})

describe("collisions", () => {
  it("are two commands in one scope on one key, and nothing across scopes", () => {
    expect(
      findShortcutCollisions([
        command({ id: "a", shortcuts: [{ key: "c" }] }),
        command({ id: "b", shortcuts: [{ key: "C" }] }),
        command({ id: "c", scope: "page", shortcuts: [{ key: "c" }] }),
      ]),
    ).toEqual([{ shortcut: "+++c", commandIds: ["a", "b"] }])
    expect(
      findShortcutCollisions([
        command({ id: "a", shortcuts: [{ key: "k", mod: true }] }),
        command({ id: "b", shortcuts: [{ key: "k" }] }),
      ]),
    ).toEqual([])
  })

  it("are absent from the workspace's own shortcut set", () => {
    const set: FanwiseCommand[] = [
      command({ id: WORKSPACE_COMMAND_IDS.openPalette, shortcuts: [PALETTE_SHORTCUT] }),
      command({ id: WORKSPACE_COMMAND_IDS.shortcuts, shortcuts: [SHORTCUTS_SHORTCUT] }),
      command({ id: WORKSPACE_COMMAND_IDS.createProduct, shortcuts: [CREATE_SHORTCUT] }),
      command({ id: WORKSPACE_COMMAND_IDS.importProduct, shortcuts: [IMPORT_SHORTCUT] }),
      command({ id: WORKSPACE_COMMAND_IDS.focusSearch, shortcuts: [SEARCH_SHORTCUT] }),
      command({ id: WORKSPACE_COMMAND_IDS.dismiss, shortcuts: [DISMISS_SHORTCUT] }),
      command({ id: EDITOR_COMMAND_IDS.save, scope: "page", shortcuts: [SAVE_SHORTCUT] }),
      command({ id: EDITOR_COMMAND_IDS.publish, scope: "page", shortcuts: [PUBLISH_SHORTCUT] }),
      command({ id: EDITOR_COMMAND_IDS.preview, scope: "page", shortcuts: [PREVIEW_SHORTCUT] }),
      command({ id: EDITOR_COMMAND_IDS.addMedia, scope: "page", shortcuts: [ADD_MEDIA_SHORTCUT] }),
      command({ id: EDITOR_COMMAND_IDS.compose, scope: "page", shortcuts: [COMPOSE_SHORTCUT] }),
      command({
        id: LIST_COMMAND_IDS.next,
        scope: "selection",
        within: "catalog",
        shortcuts: LIST_NEXT_SHORTCUTS,
      }),
      command({
        id: LIST_COMMAND_IDS.previous,
        scope: "selection",
        within: "catalog",
        shortcuts: LIST_PREVIOUS_SHORTCUTS,
      }),
      command({
        id: LIST_COMMAND_IDS.open,
        scope: "selection",
        within: "catalog",
        shortcuts: [LIST_OPEN_SHORTCUT],
      }),
      command({
        id: LIST_COMMAND_IDS.edit,
        scope: "selection",
        within: "catalog",
        shortcuts: [LIST_EDIT_SHORTCUT],
      }),
    ]
    expect(findShortcutCollisions(set)).toEqual([])

    // The global and page single keys must also leave F alone, since F is
    // taken before the registry is consulted.
    for (const c of set) {
      for (const s of c.shortcuts ?? []) {
        if (!s.mod) expect(s.key.toLowerCase()).not.toBe(SEQUENCE_KEY)
      }
    }
  })

  it("never give deletion a key", () => {
    const ids = [
      ...Object.values(WORKSPACE_COMMAND_IDS).flatMap((v) => (typeof v === "string" ? [v] : [])),
      ...Object.values(EDITOR_COMMAND_IDS),
      ...Object.values(LIST_COMMAND_IDS),
    ]
    for (const id of ids) expect(id).not.toMatch(/delete|remove|destroy/)
  })
})
