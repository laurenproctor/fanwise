import { jobs } from "@/lib/jobs"
import { specHash } from "@/lib/products/derivatives"
import type { ProductAsset } from "@/lib/products/types"
import type { AdapterSubject, ChannelAdapter, HandoffRendition } from "./types"

/**
 * The renditions an assisted channel's handoff hands over: asked for when the
 * listing is built, found again when the handoff is shown.
 *
 * Server-side, because the match is by spec hash and the hash is computed the
 * way the derivative engine computes it. The adapter names shapes and never
 * touches the engine (architecture invariant 2); this is the seam between
 * them, and it names no channel.
 */

/**
 * Asks the engine for every rendition the channel wants. Cached on
 * (source, spec) by the engine, so asking again after a rebuild costs nothing
 * for the images that have not changed. Fire and forget: the handoff shows a
 * rendition once its row exists and says so until then.
 */
export async function prepareHandoffImages(
  adapter: Pick<ChannelAdapter, "handoffImages">,
  workspaceId: string,
  subject: AdapterSubject,
): Promise<void> {
  if (!adapter.handoffImages) return
  const seen = new Set<string>()
  for (const { source, spec } of adapter.handoffImages(subject)) {
    const hash = specHash(spec)
    const key = `${source.id}:${hash}`
    if (seen.has(key)) continue
    seen.add(key)
    await jobs.enqueue(
      "build_derivative",
      { workspaceId, sourceAssetId: source.id, spec },
      { idempotencyKey: `derivative:${key}` },
    )
  }
}

/** Pairs each wanted rendition with its row, where the engine has produced one. */
export function findHandoffRenditions(
  adapter: Pick<ChannelAdapter, "handoffImages">,
  subject: AdapterSubject,
  assets: readonly ProductAsset[],
): HandoffRendition[] {
  if (!adapter.handoffImages) return []
  return adapter.handoffImages(subject).map(({ source, spec, role, position }) => {
    const hash = specHash(spec)
    const asset =
      assets.find(
        (a) => a.derived_from === source.id && a.spec_hash === hash && a.asset_state === "ready",
      ) ?? null
    return { role, position, source, asset }
  })
}
