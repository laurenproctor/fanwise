import { ImportError } from "../errors"
import {
  hashEvidence,
  type EvidenceOrigin,
  type ProductSourceEvidence,
  type SourceAsset,
} from "../evidence"
import type { SourceKind } from "../types"
import {
  HTML_LIMITS,
  metaValue,
  readAssets,
  readJsonLd,
  readLanguage,
  readMetaTags,
  readTitle,
  readVisibleFeatures,
  sanitizeText,
  stripOpaqueElements,
} from "../retrieval/html"
import type { FetchedPage } from "../retrieval/fetch-page"

/**
 * The importer contract: one kind of link, read into one evidence shape.
 *
 * Deliberately not a `ChannelAdapter`. A source has no connection, no
 * credential, no capability to publish and no billing consequence, and putting
 * one behind the adapter contract would put a provider that can never publish
 * into a registry whose entire purpose is publishing.
 *
 * Two methods, and the split is the whole design:
 *
 *   - `claims` is **pure and total**. Given a URL it answers yes or no with no
 *     network, no clock and no configuration, so provider detection is a table
 *     a test can enumerate rather than a behaviour a test has to observe.
 *   - `read` is **pure** too. It takes bytes that were already fetched and
 *     returns evidence or throws an `ImportError`. Every adapter is therefore
 *     testable against a recorded page with no server, and the fetching — the
 *     part with the security boundary in it — lives in exactly one place.
 */
export interface SourceImporter {
  readonly kind: SourceKind
  /** Pure, total, no network. The first importer that claims a URL owns it. */
  claims(url: URL): boolean
  /** Pure. Bytes to evidence, or an `ImportError` saying why not. */
  read(page: FetchedPage, originalUrl: string): ProductSourceEvidence
}

function observedValue<T>(value: T, origin: EvidenceOrigin) {
  return { value, provenance: "observed" as const, origin }
}

/**
 * The reading every page gets, before any adapter adds what it knows.
 *
 * Order matters and encodes how much an author meant a value. Open Graph and
 * Twitter cards were written to be read by a machine; JSON-LD likewise; a
 * `<title>` is a page's name and often the site's too; the DOM is a guess. The
 * first that answers wins, and `origin` records which did, so the screen can
 * tell a creator where a value came from rather than asking them to trust it.
 */
export function readCommonEvidence(
  page: FetchedPage,
  originalUrl: string,
  kind: SourceKind,
): ProductSourceEvidence {
  // JSON-LD lives inside a <script>, so it is read before scripts are cut.
  const jsonLd = readJsonLd(page.html)
  const body = stripOpaqueElements(page.html)
  const tags = readMetaTags(body)

  const ogTitle = metaValue(tags, "og:title")
  const twitterTitle = metaValue(tags, "twitter:title")
  const documentTitle = readTitle(body)

  const title =
    (ogTitle && observedValue(sanitizeText(ogTitle, HTML_LIMITS.maxTitleLength), "og")) ||
    (twitterTitle &&
      observedValue(sanitizeText(twitterTitle, HTML_LIMITS.maxTitleLength), "twitter")) ||
    (jsonLd.name && observedValue(jsonLd.name, "jsonld")) ||
    (documentTitle && observedValue(documentTitle, "dom")) ||
    null

  const ogDescription = metaValue(tags, "og:description")
  const metaDescription = metaValue(tags, "description")
  const twitterDescription = metaValue(tags, "twitter:description")

  const summary =
    (ogDescription &&
      observedValue(sanitizeText(ogDescription, HTML_LIMITS.maxSummaryLength), "og")) ||
    (metaDescription &&
      observedValue(sanitizeText(metaDescription, HTML_LIMITS.maxSummaryLength), "meta")) ||
    (twitterDescription &&
      observedValue(sanitizeText(twitterDescription, HTML_LIMITS.maxSummaryLength), "twitter")) ||
    (jsonLd.description && observedValue(jsonLd.description, "jsonld")) ||
    null

  const features = readVisibleFeatures(body)
  const language = readLanguage(page.html)

  const assets: SourceAsset[] = readAssets(body, tags, page.resolvedUrl).map((asset) => ({
    sourceUrl: asset.url,
    origin: asset.origin,
  }))

  const withoutHash = {
    provider: kind,
    originalUrl,
    resolvedUrl: page.resolvedUrl,
    ...(title ? { title } : {}),
    ...(summary ? { summary } : {}),
    visibleFeatures: observedValue(features, "dom"),
    previewAssets: assets,
    // The read was anonymous, and it succeeded, so a stranger can see this too.
    publicDemoAvailable: true,
    ...(language ? { language } : {}),
  }

  return {
    ...withoutHash,
    retrievedAt: new Date().toISOString(),
    contentHash: hashEvidence(withoutHash),
  }
}

/** True when a read produced nothing a draft could be written from. */
export function isEmptyEvidence(evidence: ProductSourceEvidence): boolean {
  return !evidence.title && !evidence.summary && evidence.visibleFeatures.value.length === 0
}

/**
 * The refusal for a page that answered but said nothing.
 *
 * Almost always one of two things: a shell that renders with JavaScript, or a
 * wall whose markers this adapter does not recognise. Fanwise cannot tell them
 * apart from outside and does not pretend to — the code says the link could not
 * be read, which is true of both, and the recoveries fit both.
 */
export function refuseEmpty(): never {
  throw new ImportError("unsupported_source")
}
