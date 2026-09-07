import { mockApiAdapter } from "./adapters/mock-api"
import { mockAssistedAdapter } from "./adapters/mock-assisted"
import { shopifyAdapter } from "./adapters/shopify"
import type { ChannelAdapter, ChannelKey } from "./types"

/**
 * The registry, and the source of truth for what a channel can do.
 *
 * Capabilities live here rather than in the channels table on purpose. A
 * capability stored in a row is a capability that can be edited, and an edited
 * capability is the UI offering an action the provider cannot perform. Code is
 * reviewed, deployed and reverted; a row is none of those things.
 *
 * The channels table carries identity only, and a unit test asserts the two
 * agree, so drift fails CI rather than production.
 */

const adapters: Record<ChannelKey, ChannelAdapter> = {
  mock_api: mockApiAdapter,
  mock_assisted: mockAssistedAdapter,
  shopify: shopifyAdapter,
}

export function listAdapters(): ChannelAdapter[] {
  return Object.values(adapters)
}

export function getAdapter(key: ChannelKey): ChannelAdapter {
  return adapters[key]
}

/**
 * Returns null rather than throwing for a key that is not registered, so a
 * stale channel row in the database degrades to "not offered" instead of
 * bringing down the page that lists channels.
 */
export function findAdapter(key: string): ChannelAdapter | null {
  return (adapters as Record<string, ChannelAdapter | undefined>)[key] ?? null
}

export function isChannelKey(key: string): key is ChannelKey {
  return key in adapters
}

/**
 * Every capability that is only meaningful if a method backs it.
 *
 * Used by the registry consistency test. A capability without its method is the
 * exact failure this project calls capability lying, and it is cheaper to catch
 * here than in a creator's support email.
 */
export const CAPABILITY_METHODS = [
  { capability: "automaticPublish", method: "publish" },
  { capability: "automaticUpdate", method: "update" },
] as const

/**
 * True when this channel can be authorized against rather than merely recorded.
 *
 * The UI reads this to decide whether Connect starts an authorization or simply
 * creates a row. It is a property of the adapter, not of the integration type:
 * an api channel with no oauth member is one Fanwise cannot connect to yet.
 */
export function supportsOAuth(adapter: ChannelAdapter): boolean {
  return adapter.oauth !== undefined
}
