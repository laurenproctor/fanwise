"use client"

import { useRegisterCommands } from "@/components/commands/command-provider"
import type { FanwiseCommand } from "@/lib/commands/types"
import { EDITOR_COMMAND_IDS, PREVIEW_SHORTCUT } from "@/lib/commands/workspace"
import { publicRoutes } from "@/lib/routes"

/**
 * Preview, on the product page: the product's public page, in a new tab.
 *
 * The same link the Public page section shows as "View public page", and
 * available under exactly the same condition — the page and the profile
 * are both published, because a draft of either is invisible to the public
 * read that renders it. Every other state names the one thing to do next.
 */
export function ProductPageCommands({
  handle,
  pageSlug,
  pageStatus,
  profileStatus,
}: {
  handle: string | null
  pageSlug: string | null
  pageStatus: "draft" | "published" | "archived" | null
  profileStatus: "draft" | "published" | "archived" | null
}) {
  const reason =
    handle === null
      ? "Set up a public profile first."
      : pageSlug === null
        ? "Create a public page for this product first."
        : profileStatus !== "published"
          ? "Publish your profile first."
          : pageStatus !== "published"
            ? "Show this product on your profile first, from the profile builder."
            : null

  const commands: FanwiseCommand[] = [
    {
      id: EDITOR_COMMAND_IDS.preview,
      label: "Preview public page",
      description: handle && pageSlug ? `Opens /@${handle}/${pageSlug} in a new tab.` : undefined,
      group: "page",
      scope: "page",
      keywords: ["view", "public", "open", "storefront"],
      shortcuts: [PREVIEW_SHORTCUT],
      enabled: reason === null,
      disabledReason: reason ?? undefined,
      execute: () => {
        if (handle && pageSlug)
          window.open(publicRoutes.product(handle, pageSlug), "_blank", "noopener")
      },
    },
  ]
  useRegisterCommands(commands)
  return null
}
