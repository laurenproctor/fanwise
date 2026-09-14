import { loadFontWorkspace } from "@/lib/fonts/queries"
import type { Product } from "@/lib/products/types"

/**
 * What stops a product reaching any channel, before any channel's own rules.
 *
 * Every action that sends a product somewhere asks this first — Publish,
 * Publish changes, a retry and Publish Everywhere — so a blocker cannot be
 * stepped around by pressing a different button. A button being disabled on
 * the screen is a courtesy; this is the rule.
 *
 * Only a font has checks of its own today: its workspace's readiness blockers
 * that stop all publishing (a buyer file, a price, the licences sold and their
 * terms). Every other product type goes straight to its channels' requirements,
 * exactly as before. Returns the sentence to show, or null.
 */
export async function productPublishBlocker(params: {
  workspaceId: string
  workspaceSlug: string
  product: Product
}): Promise<string | null> {
  if (params.product.product_type !== "font") return null

  const { readiness } = await loadFontWorkspace(params)
  const first = readiness.blockingAll[0]
  if (!first) return null
  return readiness.blockingAll.length === 1
    ? `Publishing is blocked: ${first.label.toLowerCase()}.`
    : `Publishing is blocked by ${readiness.blockingAll.length} issues, starting with: ${first.label.toLowerCase()}.`
}
