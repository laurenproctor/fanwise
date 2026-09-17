import { jobs } from "@/lib/jobs"
import { findPackage, packageSpecHash } from "@/lib/products/package"
import { packageSource, type PackageSpec } from "@/lib/products/package-spec"
import type { ProductAsset } from "@/lib/products/types"
import type { AdapterSubject, ChannelAdapter, HandoffPackage } from "./types"

/**
 * The package an assisted channel's handoff hands over: asked for when the
 * listing is built, found again when the handoff is shown.
 *
 * The seam between the adapter and the package build, as
 * handoff-renditions.ts is between the adapter and the derivative engine.
 * The adapter names the spec and never touches storage; this names no
 * channel.
 */

export async function prepareHandoffPackage(
  adapter: Pick<ChannelAdapter, "handoffPackage">,
  workspaceId: string,
  subject: AdapterSubject,
): Promise<void> {
  if (!adapter.handoffPackage) return
  const spec = adapter.handoffPackage(subject)
  const source = spec ? packageSource(spec) : null
  if (!spec || !source) return
  await jobs.enqueue(
    "build_package",
    { workspaceId, productId: subject.product.id, spec },
    { idempotencyKey: `package:${source}:${packageSpecHash(spec)}` },
  )
}

export function findHandoffPackage(
  adapter: Pick<ChannelAdapter, "handoffPackage">,
  subject: AdapterSubject,
  assets: readonly ProductAsset[],
): HandoffPackage | null {
  if (!adapter.handoffPackage) return null
  const spec = adapter.handoffPackage(subject)
  if (!spec) return null
  return { spec, asset: findPackage(spec, assets) }
}

export type { PackageSpec }
