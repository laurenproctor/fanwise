import { routes } from "@/lib/routes"
import type { SequenceDestination } from "./types"

/**
 * The `F` layer's destinations, and the commands behind them.
 *
 * `F` is for Fanwise. After it, one letter: the workspace's four sections,
 * and V for a look at the public profile. The letters are the command ids'
 * only physical form, so the guide, the palette, the reference and the tests
 * all read this list rather than each keeping their own.
 *
 * There is no D for a dashboard because there is no dashboard: the
 * workspace's home is its catalog, which P already reaches. Channels is
 * here because it is one of the four sections in the header, and a
 * navigation layer that skipped one of them would be a puzzle.
 */

export const NAVIGATION_COMMAND_IDS = {
  products: "nav.products",
  channels: "nav.channels",
  profile: "nav.profile",
  settings: "nav.settings",
  previewProfile: "nav.preview-profile",
} as const

export const SEQUENCE_DESTINATIONS: readonly SequenceDestination[] = [
  { key: "p", label: "Products", commandId: NAVIGATION_COMMAND_IDS.products },
  { key: "c", label: "Channels", commandId: NAVIGATION_COMMAND_IDS.channels },
  { key: "r", label: "Profile", commandId: NAVIGATION_COMMAND_IDS.profile },
  { key: "s", label: "Settings", commandId: NAVIGATION_COMMAND_IDS.settings },
  { key: "v", label: "Preview", commandId: NAVIGATION_COMMAND_IDS.previewProfile },
]

/** Where each section command goes, from the workspace slug. */
export const SECTION_ROUTES: ReadonlyArray<{
  commandId: string
  label: string
  href: (workspace: string) => string
  keywords: readonly string[]
}> = [
  {
    commandId: NAVIGATION_COMMAND_IDS.products,
    label: "Go to Products",
    href: routes.workspace,
    keywords: ["catalog", "home", "dashboard", "list"],
  },
  {
    commandId: NAVIGATION_COMMAND_IDS.channels,
    label: "Go to Channels",
    href: routes.channels,
    keywords: ["marketplaces", "connections", "shops", "stores"],
  },
  {
    commandId: NAVIGATION_COMMAND_IDS.profile,
    label: "Go to Profile",
    href: routes.profile,
    keywords: ["public", "handle", "portfolio", "builder"],
  },
  {
    commandId: NAVIGATION_COMMAND_IDS.settings,
    label: "Go to Settings",
    href: routes.settings,
    keywords: ["studio", "account", "billing", "subscription", "preferences"],
  },
]
