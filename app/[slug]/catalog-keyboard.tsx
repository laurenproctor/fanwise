"use client"

import { useRef } from "react"
import { useRegisterCommands } from "@/components/commands/command-provider"
import type { FanwiseCommand } from "@/lib/commands/types"
import {
  CATALOG_SCOPE,
  LIST_COMMAND_IDS,
  LIST_EDIT_SHORTCUT,
  LIST_NEXT_SHORTCUTS,
  LIST_OPEN_SHORTCUT,
  LIST_PREVIOUS_SHORTCUTS,
} from "@/lib/commands/workspace"

/**
 * The product list's keys, scoped to the list.
 *
 * Nothing here captures a key globally. The commands are registered with
 * `selection` scope and `within: "catalog"`, so the provider only resolves
 * them when the keystroke's target is inside this element — which, for a
 * list of links, means a row's link has keyboard focus. Tab into the list
 * and J and K walk it; Tab out and they are letters again.
 *
 * The rows stay a server component. This wrapper reads them from the DOM by
 * the two data attributes `catalog-list.tsx` puts on each row and its link,
 * and moves real focus between the links, so a screen reader announces each
 * product as the arrow keys reach it with no `aria-activedescendant` to
 * maintain.
 *
 * Enter is not handled: a focused link already opens on Enter, and a second
 * handler would open it twice. It is registered so the reference can list it.
 * E is the same destination, because in Fanwise the product's page is its
 * editor.
 */
export function CatalogKeyboard({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  function links(): HTMLElement[] {
    return Array.from(ref.current?.querySelectorAll<HTMLElement>("[data-catalog-link]") ?? [])
  }

  function currentIndex(all: HTMLElement[]): number {
    const active = document.activeElement
    return all.findIndex(
      (link) => link === active || link.closest("[data-catalog-row]")?.contains(active),
    )
  }

  function move(delta: 1 | -1) {
    const all = links()
    if (all.length === 0) return
    const index = currentIndex(all)
    const next =
      index < 0
        ? delta > 0
          ? 0
          : all.length - 1
        : Math.max(0, Math.min(all.length - 1, index + delta))
    const link = all[next]
    if (!link) return
    link.focus()
    link.scrollIntoView({ block: "nearest" })
  }

  function open() {
    const all = links()
    const index = currentIndex(all)
    if (index >= 0) all[index]?.click()
  }

  const commands: FanwiseCommand[] = [
    {
      id: LIST_COMMAND_IDS.next,
      label: "Next product",
      group: "page",
      scope: "selection",
      within: CATALOG_SCOPE,
      shortcuts: LIST_NEXT_SHORTCUTS,
      enabled: true,
      hidden: true,
      execute: () => move(1),
    },
    {
      id: LIST_COMMAND_IDS.previous,
      label: "Previous product",
      group: "page",
      scope: "selection",
      within: CATALOG_SCOPE,
      shortcuts: LIST_PREVIOUS_SHORTCUTS,
      enabled: true,
      hidden: true,
      execute: () => move(-1),
    },
    {
      id: LIST_COMMAND_IDS.open,
      label: "Open the focused product",
      group: "page",
      scope: "selection",
      within: CATALOG_SCOPE,
      // Listed, not handled: the link's own Enter does this.
      shortcuts: [LIST_OPEN_SHORTCUT],
      enabled: true,
      hidden: true,
      execute: () => open(),
    },
    {
      id: LIST_COMMAND_IDS.edit,
      label: "Edit the focused product",
      group: "page",
      scope: "selection",
      within: CATALOG_SCOPE,
      shortcuts: [LIST_EDIT_SHORTCUT],
      enabled: true,
      hidden: true,
      execute: () => open(),
    },
  ]
  useRegisterCommands(commands)

  return (
    <div ref={ref} data-command-scope={CATALOG_SCOPE}>
      {children}
    </div>
  )
}
