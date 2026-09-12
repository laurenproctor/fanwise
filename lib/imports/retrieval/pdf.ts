import { getDocumentProxy } from "unpdf"
import { ImportError } from "../errors"

/**
 * Reading the text layer of a PDF a creator uploaded.
 *
 * **Text and two metadata properties, and nothing else.** No page is rendered,
 * no image is decoded, no annotation, form, attachment or embedded script is
 * looked at. PDF.js is a viewer and can do all of those; this asks it for the
 * one thing an import needs, which is the words, in order, from a bounded
 * number of pages.
 *
 * The PDF.js build is the serverless one `unpdf` ships, at a version past the
 * font-program fix for CVE-2024-4367, and it is only ever handed bytes that
 * were already stored and measured. It runs inside the background job, never
 * in an interactive request and never in a browser.
 */

export const PDF_LIMITS = {
  /** The largest PDF an import will read. Checked at upload and again here. */
  maxBytes: Math.floor(4.8 * 1024 * 1024),
  /** Pages read for text. A draft needs the opening, not chapter nine. */
  maxPages: 40,
  /** Characters kept across all pages. Matches the evidence body limit with room. */
  maxCharacters: 40_000,
} as const

export interface PdfReading {
  pageCount: number
  /** The document's own title property, when it set one. Unvetted here. */
  metadataTitle: string | null
  /** The text layer, one visual line per line, pages separated by blank lines. */
  text: string
}

interface TextItemLike {
  str?: unknown
  hasEOL?: unknown
}

/** The names PDF.js gives the refusals that mean "this is not a readable PDF". */
const UNREADABLE = new Set([
  "PasswordException",
  "InvalidPDFException",
  "FormatError",
  "UnknownErrorException",
  "ResponseException",
])

export async function readPdf(bytes: Uint8Array): Promise<PdfReading> {
  if (bytes.byteLength > PDF_LIMITS.maxBytes) throw new ImportError("too_large")
  // The signature is checked before PDF.js is asked anything, so a renamed
  // file is refused for what it is rather than for whatever the parser says.
  if (!startsWithPdfSignature(bytes))
    throw new ImportError("unreadable_file", { reason: "signature" })

  let document: Awaited<ReturnType<typeof getDocumentProxy>>
  try {
    // A copy, because PDF.js transfers the buffer it is given and the caller's
    // bytes should still be the caller's afterwards.
    // Verbosity 0: PDF.js warns on stdout about malformed files, and a server log
    // full of a stranger's parser warnings is noise that hides real faults.
    document = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 })
  } catch (error) {
    const name = error instanceof Error ? error.name : "unknown"
    throw new ImportError(UNREADABLE.has(name) ? "unreadable_file" : "internal", { name })
  }

  try {
    const pageCount = document.numPages
    let metadataTitle: string | null = null
    try {
      const meta = await document.getMetadata()
      const info = meta.info as Record<string, unknown> | undefined
      if (info && typeof info.Title === "string") metadataTitle = info.Title
    } catch {
      // A PDF with broken metadata still has pages worth reading.
    }

    const pages: string[] = []
    let total = 0
    for (let number = 1; number <= Math.min(pageCount, PDF_LIMITS.maxPages); number += 1) {
      if (total >= PDF_LIMITS.maxCharacters) break
      const page = await document.getPage(number)
      const content = await page.getTextContent()
      let line = ""
      const lines: string[] = []
      for (const item of content.items as TextItemLike[]) {
        if (typeof item.str === "string") line += item.str
        if (item.hasEOL === true) {
          lines.push(line)
          line = ""
        }
      }
      if (line.length > 0) lines.push(line)
      const text = lines.join("\n")
      pages.push(text)
      total += text.length
      page.cleanup()
    }

    return { pageCount, metadataTitle, text: pages.join("\n\n").slice(0, PDF_LIMITS.maxCharacters) }
  } catch (error) {
    if (error instanceof ImportError) throw error
    const name = error instanceof Error ? error.name : "unknown"
    throw new ImportError(UNREADABLE.has(name) ? "unreadable_file" : "internal", { name })
  } finally {
    await document.loadingTask.destroy().catch(() => undefined)
  }
}

/** `%PDF-` within the first kilobyte, which is where the specification allows it. */
export function startsWithPdfSignature(bytes: Uint8Array): boolean {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024))
  return head.includes("%PDF-")
}

/**
 * Whether a PDF's title property is a title, or the name of the program that
 * wrote it.
 *
 * Office suites fill the property with the file name, the application or
 * "Untitled", and a listing named "Microsoft Word - final_v3.docx" is the kind
 * of observed value that makes a creator distrust every other one.
 */
export function isPlausibleDocumentTitle(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length < 3 || trimmed.length > 150) return false
  if (/^(untitled|document\d*|slide\s*\d*|presentation\d*|title)$/i.test(trimmed)) return false
  if (/\.(docx?|pdf|pages|key|pptx?|indd|txt|rtf|odt)$/i.test(trimmed)) return false
  if (/^(microsoft (word|powerpoint)|adobe|canva)\b/i.test(trimmed)) return false
  return /[a-z]/i.test(trimmed)
}
