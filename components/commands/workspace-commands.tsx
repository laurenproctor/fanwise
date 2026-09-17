"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { SECTION_ROUTES, NAVIGATION_COMMAND_IDS } from "@/lib/commands/navigation"
import { rememberRecentProduct } from "@/lib/commands/preferences"
import type { FanwiseCommand } from "@/lib/commands/types"
import {
  CREATE_SHORTCUT,
  DISMISS_SHORTCUT,
  IMPORT_SHORTCUT,
  PALETTE_SHORTCUT,
  PRODUCT_SEARCH_SELECTOR,
  SEARCH_SHORTCUT,
  SHORTCUTS_SHORTCUT,
  SIGN_OUT_FORM_SELECTOR,
  WORKSPACE_COMMAND_IDS,
} from "@/lib/commands/workspace"
import { publicRoutes, routes } from "@/lib/routes"
import { PRODUCT_TYPE_LABELS, type ProductType } from "@/lib/products/types"
import { toggleTheme } from "@/components/ui/theme-toggle"
import { useCommandCenter, useRegisterCommands } from "./command-provider"

/**
 * The commands every workspace page has, registered once from the layout.
 *
 * Global actions, the four sections and the public-profile preview, the
 * catalog's products by name, and the account rows. Each one runs the same
 * thing the visible control runs: navigation goes through the router, sign
 * out submits the header's own form, the theme toggle calls the toggle's
 * own function. Nothing here has a second copy of any logic.
 */

export interface PaletteProduct {
  id: string
  name: string
  slug: string
  productType: ProductType
}

export interface PaletteProfile {
  handle: string
  status: "draft" | "published" | "archived"
}

export function WorkspaceCommands({
  workspaceSlug,
  products,
  profile,
}: {
  workspaceSlug: string
  products: readonly PaletteProduct[]
  profile: PaletteProfile | null
}) {
  const center = useCommandCenter()
  const router = useRouter()
  const pathname = usePathname()

  // A product just visited is a product likely wanted again. Slugs only.
  useEffect(() => {
    const [, workspace, productSlug, ...rest] = pathname.split("/")
    if (workspace !== workspaceSlug || !productSlug || rest.length > 0) return
    if (products.some((product) => product.slug === productSlug))
      rememberRecentProduct(workspaceSlug, productSlug)
  }, [pathname, workspaceSlug, products])

  const previewReason =
    profile === null
      ? "Create a public profile first."
      : profile.status !== "published"
        ? "Publish your profile first."
        : null

  const commands: FanwiseCommand[] = [
    {
      id: WORKSPACE_COMMAND_IDS.openPalette,
      label: "Open command palette",
      group: "quick",
      scope: "global",
      shortcuts: [PALETTE_SHORTCUT],
      enabled: true,
      hidden: true,
      execute: () => center?.openPalette(),
    },
    {
      id: WORKSPACE_COMMAND_IDS.shortcuts,
      label: "Keyboard shortcuts",
      description: "Every shortcut that works on this page.",
      group: "quick",
      scope: "global",
      keywords: ["help", "keys", "hotkeys", "reference"],
      shortcuts: [SHORTCUTS_SHORTCUT],
      enabled: true,
      execute: () => center?.openReference(),
    },
    {
      id: WORKSPACE_COMMAND_IDS.createProduct,
      label: "Create a product",
      description: "Name it and say what it is.",
      group: "quick",
      scope: "global",
      keywords: ["new", "add"],
      shortcuts: [CREATE_SHORTCUT],
      enabled: true,
      execute: () => router.push(routes.newProduct(workspaceSlug)),
    },
    {
      id: WORKSPACE_COMMAND_IDS.importProduct,
      label: "Import a product",
      description: "From a link, a PDF, an HTML file or pasted text.",
      group: "quick",
      scope: "global",
      keywords: ["link", "url", "paste", "pdf"],
      shortcuts: [IMPORT_SHORTCUT],
      enabled: true,
      execute: () => router.push(routes.importProduct(workspaceSlug)),
    },
    {
      id: WORKSPACE_COMMAND_IDS.focusSearch,
      label: "Search products",
      description: "Jump to the catalog's search box.",
      group: "quick",
      scope: "global",
      keywords: ["find", "filter", "catalog"],
      shortcuts: [SEARCH_SHORTCUT],
      enabled: true,
      execute: () => {
        if (!center) return
        if (!center.requestFocus(PRODUCT_SEARCH_SELECTOR))
          router.push(routes.workspace(workspaceSlug))
      },
    },
    {
      id: WORKSPACE_COMMAND_IDS.dismiss,
      label: "Close the palette, guide or dialog",
      group: "quick",
      scope: "global",
      shortcuts: [DISMISS_SHORTCUT],
      enabled: true,
      hidden: true,
      execute: () => {
        center?.closePalette()
        center?.closeReference()
      },
    },
    ...SECTION_ROUTES.map<FanwiseCommand>((section) => ({
      id: section.commandId,
      label: section.label,
      group: "navigation",
      scope: "navigation",
      keywords: section.keywords,
      enabled: true,
      execute: () => router.push(section.href(workspaceSlug)),
    })),
    {
      id: NAVIGATION_COMMAND_IDS.previewProfile,
      label: "Preview public profile",
      description: profile ? `Opens /@${profile.handle} in a new tab.` : undefined,
      group: "navigation",
      scope: "navigation",
      keywords: ["view", "public", "open", "handle"],
      enabled: previewReason === null,
      disabledReason: previewReason ?? undefined,
      execute: () => {
        if (profile) window.open(publicRoutes.profile(profile.handle), "_blank", "noopener")
      },
    },
    ...products.map<FanwiseCommand>((product) => ({
      id: WORKSPACE_COMMAND_IDS.openProduct(product.slug),
      label: product.name,
      description: PRODUCT_TYPE_LABELS[product.productType],
      group: "products",
      scope: "global",
      keywords: [product.slug, PRODUCT_TYPE_LABELS[product.productType]],
      enabled: true,
      hidden: true,
      execute: () => router.push(routes.product(workspaceSlug, product.slug)),
    })),
    {
      id: WORKSPACE_COMMAND_IDS.accountSettings,
      label: "Account",
      description: "Personal details and sign-in security.",
      group: "account",
      scope: "global",
      keywords: ["email", "password", "security", "settings"],
      enabled: true,
      execute: () => router.push(`${routes.settings(workspaceSlug)}#account`),
    },
    {
      id: WORKSPACE_COMMAND_IDS.subscription,
      label: "Subscription",
      description: "Plan, marketplaces and what they cost.",
      group: "account",
      scope: "global",
      keywords: ["billing", "plan", "invoice", "pricing"],
      enabled: true,
      execute: () => router.push(`${routes.settings(workspaceSlug)}#subscription`),
    },
    {
      id: WORKSPACE_COMMAND_IDS.toggleTheme,
      label: "Switch light or dark mode",
      group: "account",
      scope: "global",
      keywords: ["theme", "appearance", "dark", "light"],
      enabled: true,
      execute: () => toggleTheme(),
    },
    {
      id: WORKSPACE_COMMAND_IDS.signOut,
      label: "Sign out",
      group: "account",
      scope: "global",
      keywords: ["log out", "logout", "leave"],
      enabled: true,
      execute: () =>
        document.querySelector<HTMLFormElement>(SIGN_OUT_FORM_SELECTOR)?.requestSubmit(),
    },
  ]

  useRegisterCommands(commands)
  return null
}
