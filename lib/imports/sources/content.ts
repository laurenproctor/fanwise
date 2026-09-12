import { ImportError } from "../errors"
import { hashEvidence, type EvidenceOrigin, type ProductSourceEvidence } from "../evidence"
import {
  HTML_LIMITS,
  metaValue,
  readAssets,
  readJsonLd,
  readLanguage,
  readMetaTags,
  readTitle,
  readVisibleFeatures,
  readVisibleText,
  sanitizeText,
  stripOpaqueElements,
} from "../retrieval/html"
import { isPlausibleDocumentTitle, readPdf } from "../retrieval/pdf"
import { TEXT_LIMITS, readPlainText } from "../retrieval/plain-text"
import type { ContentSourceKind } from "../types"
import { refuseEmpty } from "./importer"

/**
 * The importers for sources a creator hands over: pasted text, a PDF, an HTML
 * file.
 *
 * The counterpart of `SourceImporter`, and deliberately a different contract.
 * A link importer claims URLs and is chosen by looking at one; nothing claims a
 * file. The creator said what they were handing over when they chose the tab,
 * the row records it as the provider, and the importer is looked up by that
 * kind — a table, not a detection.
 *
 * Reading is still pure in the sense that matters: bytes in, evidence or an
 * `ImportError` out, no database and no network. The PDF reader is async only
 * because PDF.js is.
 */

export interface ContentSource {
  bytes: Uint8Array
  /** What the creator called the file, or null for a paste. Display only. */
  filename: string | null
}

export interface ContentImporter {
  readonly kind: ContentSourceKind
  read(source: ContentSource): Promise<ProductSourceEvidence>
}

function observedValue<T>(value: T, origin: EvidenceOrigin) {
  return { value, provenance: "observed" as const, origin }
}

/**
 * Bytes as text, refusing what is not text.
 *
 * `fatal: true`, so a binary file renamed `.html` fails here as unreadable
 * instead of arriving downstream as a page of replacement characters that
 * somebody's draft is then written from. A byte-order mark is dropped.
 */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)
  } catch {
    throw new ImportError("unreadable_file", { reason: "encoding" })
  }
}

function finish(
  kind: ContentSourceKind,
  source: ContentSource,
  fields: Omit<
    ProductSourceEvidence,
    "provider" | "retrievedAt" | "contentHash" | "publicDemoAvailable" | "sourceName"
  >,
): ProductSourceEvidence {
  const withoutHash = {
    provider: kind,
    ...(source.filename ? { sourceName: source.filename } : {}),
    ...fields,
    // A file somebody handed over is not a page a buyer can visit. True is
    // reserved for a read that succeeded anonymously over the public internet.
    publicDemoAvailable: false,
  }
  return {
    ...withoutHash,
    retrievedAt: new Date().toISOString(),
    contentHash: hashEvidence(withoutHash),
  }
}

/** Evidence from text lines, shared by a paste and a PDF's text layer. */
function fromText(
  raw: string,
  titleFallback: { value: string; origin: EvidenceOrigin } | null,
): Pick<ProductSourceEvidence, "title" | "summary" | "visibleFeatures" | "bodyText"> {
  const reading = readPlainText(raw)
  if (!reading.body) throw new ImportError("no_text")

  const title = titleFallback
    ? observedValue(titleFallback.value, titleFallback.origin)
    : reading.title
      ? observedValue(reading.title, "document")
      : null

  return {
    ...(title ? { title } : {}),
    ...(reading.summary ? { summary: observedValue(reading.summary, "document") } : {}),
    visibleFeatures: observedValue(reading.features, "document"),
    bodyText: observedValue(reading.body, "document"),
  }
}

export const pastedTextImporter: ContentImporter = {
  kind: "pasted_text",
  async read(source) {
    const text = decodeText(source.bytes)
    return finish("pasted_text", source, { ...fromText(text, null), previewAssets: [] })
  },
}

export const pdfDocumentImporter: ContentImporter = {
  kind: "pdf_document",
  async read(source) {
    const pdf = await readPdf(source.bytes)
    // The title property wins when it is a real title, because the author set
    // it on purpose; the first line of page one is the fallback, and is often
    // a running header, which is why it comes second.
    const property =
      pdf.metadataTitle && isPlausibleDocumentTitle(pdf.metadataTitle)
        ? sanitizeText(pdf.metadataTitle, HTML_LIMITS.maxTitleLength)
        : null
    const fields = fromText(pdf.text, property ? { value: property, origin: "properties" } : null)
    return finish("pdf_document", source, {
      ...fields,
      previewAssets: [],
      pageCount: pdf.pageCount,
    })
  },
}

export const htmlDocumentImporter: ContentImporter = {
  kind: "html_document",
  async read(source) {
    const html = decodeText(source.bytes)
    if (html.length > HTML_LIMITS.maxBytes) throw new ImportError("too_large")

    // The same reading a fetched page gets, in the same order of trust, minus
    // the address: relative image URLs have nothing to resolve against and are
    // dropped, so only an absolute one is carried to the asset fetcher.
    const jsonLd = readJsonLd(html)
    const body = stripOpaqueElements(html)
    const tags = readMetaTags(body)

    const ogTitle = metaValue(tags, "og:title")
    const documentTitle = readTitle(body)
    const title =
      (ogTitle && observedValue(sanitizeText(ogTitle, HTML_LIMITS.maxTitleLength), "og")) ||
      (jsonLd.name && observedValue(jsonLd.name, "jsonld")) ||
      (documentTitle && observedValue(documentTitle, "dom")) ||
      null

    const ogDescription = metaValue(tags, "og:description")
    const metaDescription = metaValue(tags, "description")
    const summary =
      (ogDescription &&
        observedValue(sanitizeText(ogDescription, HTML_LIMITS.maxSummaryLength), "og")) ||
      (metaDescription &&
        observedValue(sanitizeText(metaDescription, HTML_LIMITS.maxSummaryLength), "meta")) ||
      (jsonLd.description && observedValue(jsonLd.description, "jsonld")) ||
      null

    const features = readVisibleFeatures(body)
    const text = readVisibleText(html, TEXT_LIMITS.maxBodyLength)
    const language = readLanguage(html)

    /*
      A file that is all script and no markup — the common shape of an exported
      single-page app — has nothing here to read, and Fanwise will not run it to
      find out. That is the same refusal a JavaScript shell gets as a link, and
      the recovery offered with it is to paste what the page shows.
    */
    if (features.length === 0 && text.length === 0) refuseEmpty()

    return finish("html_document", source, {
      ...(title ? { title } : {}),
      ...(summary ? { summary } : {}),
      visibleFeatures: observedValue(features, "dom"),
      ...(text.length > 0 ? { bodyText: observedValue(text, "dom") } : {}),
      previewAssets: readAssets(body, tags, null).map((asset) => ({
        sourceUrl: asset.url,
        origin: asset.origin,
      })),
      ...(language ? { language } : {}),
    })
  },
}

export const CONTENT_IMPORTERS: Record<ContentSourceKind, ContentImporter> = {
  pasted_text: pastedTextImporter,
  pdf_document: pdfDocumentImporter,
  html_document: htmlDocumentImporter,
}
