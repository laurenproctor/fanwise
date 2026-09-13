import type { SourceKind } from "../types"
import { genericWebImporter } from "./generic-web"
import { claimsHost, hostedArtifactImporter } from "./hosted-artifact"
import type { SourceImporter } from "./importer"

/**
 * Which real services each generic source kind means, and who reads each one.
 *
 * **This directory is the only place in the tree that names a service.**
 * Everything else branches on `SourceKind`. That is the same rule
 * `lib/channels/registry.ts` holds for marketplaces and it exists for the same
 * reason: a name that leaks into the product domain is logic somewhere
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
   *
   * Descriptive. The authority is the importer's own `claims`, and a unit test
   * holds this table and that function to the same answer, so the two cannot
   * drift into a UI that names one source and a reader that picks another.
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

/**
 * The sources a creator hands over. No hosts, because nothing is fetched, and
 * no publish hint, because there is nothing to publish.
 *
 * Kept out of `SOURCE_DESCRIPTORS`, whose order is the order links are claimed
 * in and whose last entry is the catch-all. A file is never claimed by looking
 * at a URL, so putting one in that list would only make its tail lie.
 */
export const CONTENT_SOURCE_DESCRIPTORS: readonly SourceDescriptor[] = [
  { kind: "pasted_text", label: "Pasted text", hosts: [], publishHint: null },
  { kind: "pdf_document", label: "PDF document", hosts: [], publishHint: null },
  { kind: "html_document", label: "HTML file", hosts: [], publishHint: null },
  { kind: "audio_recording", label: "Recording", hosts: [], publishHint: null },
]

export const SOURCE_LABELS: Record<SourceKind, string> = {
  hosted_artifact: "Claude Artifact",
  webpage: "Public webpage",
  pasted_text: "Pasted text",
  pdf_document: "PDF document",
  html_document: "HTML file",
  audio_recording: "Recording",
}

/**
 * The importers, in the order they are consulted.
 *
 * Order is the whole of provider detection: the first that claims a URL owns
 * it, and the generic one claims everything, so it is last and the list is
 * total. A unit test asserts both the order and the totality, because an
 * importer inserted after the catch-all would never be reached and nothing
 * else in the system would notice.
 */
export const SOURCE_IMPORTERS: readonly SourceImporter[] = [
  hostedArtifactImporter,
  genericWebImporter,
]

/**
 * Which importer reads a URL. Never null: the last one claims everything.
 *
 * Takes a parsed URL rather than a string so that the caller has already been
 * through `validateSourceUrl`, and this cannot be the thing that decides
 * whether a link is safe to open.
 */
export function importerFor(url: URL): SourceImporter {
  const found = SOURCE_IMPORTERS.find((importer) => importer.claims(url))
  // The catch-all guarantees this, and the totality test keeps the guarantee.
  // The fallback is here so the return type needs no assertion.
  return found ?? genericWebImporter
}

/** Which kind a URL belongs to. Deterministic, pure, no network. */
export function sourceKindFor(url: URL): SourceKind {
  return importerFor(url).kind
}

export function descriptorFor(kind: SourceKind): SourceDescriptor {
  const found = [...SOURCE_DESCRIPTORS, ...CONTENT_SOURCE_DESCRIPTORS].find(
    (descriptor) => descriptor.kind === kind,
  )
  if (!found) throw new Error(`no descriptor for source kind ${kind}`)
  return found
}

/** Exported so the descriptor table's test can hold it to the adapter's answer. */
export { claimsHost }
