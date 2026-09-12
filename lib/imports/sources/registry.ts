import type { SourceKind } from "../types"

/**
 * Which real services each generic source kind means.
 *
 * **This file and `fixtures.ts` beside it are the only two in `lib/imports`
 * that name a service.** Everything else branches on `SourceKind`. That is the
 * same rule `lib/channels/registry.ts` holds for marketplaces and it exists for
 * the same reason: a name that leaks into the product domain is logic somewhere
 * branching on whose page it is reading, and the shape of the import stops
 * being general the moment it does.
 *
 * `tests/unit/import-source-boundaries.test.ts` reads the tree and fails on a
 * name written anywhere else.
 */

export interface SourceDescriptor {
  readonly kind: SourceKind
  /** What the UI calls it, on the evidence row under the preview. */
  readonly label: string
  /**
   * Hostnames this kind claims, matched on the registrable suffix so that a
   * subdomain is claimed and `claude.ai.example.com` is not.
   */
  readonly hosts: readonly string[]
  /**
   * Said on the recovery screen, when a link of this kind will not open. Null
   * where the generic advice is the only honest advice.
   */
  readonly publishHint: string | null
}

export const SOURCE_DESCRIPTORS: readonly SourceDescriptor[] = [
  {
    kind: "hosted_artifact",
    label: "Claude Artifact",
    hosts: ["claude.ai", "claude.site"],
    publishHint:
      "Open the artifact, use Share to publish it, and paste the public link it gives you.",
  },
  {
    // Claims everything the others did not, so a paste always resolves to a
    // kind and "nothing matched" is not a state the screen has to render.
    kind: "webpage",
    label: "Public webpage",
    hosts: [],
    publishHint: null,
  },
]

export const SOURCE_LABELS: Record<SourceKind, string> = {
  hosted_artifact: "Claude Artifact",
  webpage: "Public webpage",
}

function claims(descriptor: SourceDescriptor, hostname: string): boolean {
  if (descriptor.hosts.length === 0) return true
  return descriptor.hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))
}

/**
 * Which kind a URL belongs to. Total: `webpage` is last and claims the rest.
 *
 * Takes a parsed URL rather than a string so that the caller has already been
 * through `validateSourceUrl` and this cannot be the thing that decides whether
 * a link is safe to read.
 */
export function sourceKindFor(url: URL): SourceKind {
  const hostname = url.hostname.toLowerCase()
  const found = SOURCE_DESCRIPTORS.find((descriptor) => claims(descriptor, hostname))
  return found?.kind ?? "webpage"
}

export function descriptorFor(kind: SourceKind): SourceDescriptor {
  const found = SOURCE_DESCRIPTORS.find((descriptor) => descriptor.kind === kind)
  if (!found) throw new Error(`no descriptor for source kind ${kind}`)
  return found
}
