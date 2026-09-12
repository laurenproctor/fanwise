import { describe, expect, it } from "vitest"
import { renderEvidence } from "@/lib/imports/compose"
import { evidenceCorpus } from "@/lib/imports/claims"
import { IMPORT_ERROR_CODES, IMPORT_ERROR_RECOVERIES, ImportError } from "@/lib/imports/errors"
import { hashEvidence, productSourceEvidenceSchema } from "@/lib/imports/evidence"
import { isWholeHtmlDocument } from "@/lib/imports/paste"
import { readVisibleText } from "@/lib/imports/retrieval/html"
import { isPlausibleDocumentTitle, readPdf } from "@/lib/imports/retrieval/pdf"
import { isMostlyCode, looksLikeCode, readPlainText } from "@/lib/imports/retrieval/plain-text"
import {
  CONTENT_IMPORTERS,
  decodeText,
  htmlDocumentImporter,
  pastedTextImporter,
  pdfDocumentImporter,
} from "@/lib/imports/sources/content"
import { SOURCE_LABELS, descriptorFor } from "@/lib/imports/sources/registry"
import { isSourcePathFor, sourcePathFor } from "@/lib/imports/source-storage"
import { provisionalContentName } from "@/lib/imports/start"
import { CONTENT_SOURCE_KINDS, SOURCE_KINDS, isContentSourceKind } from "@/lib/imports/types"
import { recoveriesFor, sourceLabelFor, stateFor } from "@/lib/imports/view"
import type { ImportRecord } from "@/lib/imports/queries"
import { buildPdf } from "./import-pdf-fixture"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { SourcePanel } from "@/components/imports/source-panel"

/**
 * Importing from text, a PDF or an HTML file.
 *
 * Pure, like the rest of the import tests: bytes in, evidence or a coded refusal
 * out. The PDFs are real documents built in `import-pdf-fixture.ts` and read by
 * the same PDF.js build production uses.
 */

const bytes = (text: string) => new Uint8Array(Buffer.from(text, "utf8"))

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    if (error instanceof ImportError) return error.code
    throw error
  }
  throw new Error("expected a refusal")
}

describe("the kinds", () => {
  it("keeps link kinds and handed-over kinds apart, and labels every one", () => {
    for (const kind of CONTENT_SOURCE_KINDS) expect(isContentSourceKind(kind)).toBe(true)
    expect(isContentSourceKind("webpage")).toBe(false)
    expect(isContentSourceKind("hosted_artifact")).toBe(false)
    for (const kind of SOURCE_KINDS) {
      expect(SOURCE_LABELS[kind]).toBeTruthy()
      expect(descriptorFor(kind).kind).toBe(kind)
    }
  })

  it("has an importer for every handed-over kind", () => {
    for (const kind of CONTENT_SOURCE_KINDS) expect(CONTENT_IMPORTERS[kind].kind).toBe(kind)
  })
})

describe("reading plain text", () => {
  it("offers the first line as a title, the first paragraph as a summary, and bullets as lines", () => {
    const reading = readPlainText(
      [
        "# Aster Grotesk",
        "",
        "A six-weight grotesque for screens and editorial work.",
        "Drawn for long reading.",
        "",
        "- Variable weight axis",
        "* Extended Latin coverage",
        "1. Tabular figures included",
        "- Menu",
      ].join("\n"),
    )
    expect(reading.title).toBe("Aster Grotesk")
    expect(reading.summary).toBe(
      "A six-weight grotesque for screens and editorial work. Drawn for long reading.",
    )
    // One-word lines are navigation, not features, as on a page.
    expect(reading.features).toEqual([
      "Aster Grotesk",
      "Variable weight axis",
      "Extended Latin coverage",
      "Tabular figures included",
    ])
    expect(reading.body).toContain("Drawn for long reading.")
  })

  it("offers no title or summary for code, but keeps the body to draft from", () => {
    const code = [
      'import React from "react"',
      "",
      "export default function Scale() {",
      "  const ratio = 1.25;",
      "  return <h1>Type Scale Studio</h1>",
      "}",
    ].join("\n")
    expect(isMostlyCode(code.split("\n"))).toBe(true)
    const reading = readPlainText(code)
    expect(reading.title).toBeNull()
    expect(reading.summary).toBeNull()
    expect(reading.body).toContain("Type Scale Studio")
  })

  it("does not mistake prose for code", () => {
    expect(looksLikeCode("A calm, readable typeface for long documents")).toBe(false)
    expect(looksLikeCode("import React from 'react'")).toBe(true)
    expect(looksLikeCode("<!doctype html>")).toBe(true)
  })

  it("strips control and bidirectional characters before anything is kept", () => {
    const hidden = String.fromCharCode(0x202e)
    const nul = String.fromCharCode(0)
    const reading = readPlainText(
      `Aster${hidden} Grotesk${nul}\nA grotesque for screens and print.`,
    )
    expect(reading.title).toBe("Aster Grotesk")
    expect(reading.body).not.toContain(hidden)
    expect(reading.body).not.toContain(nul)
  })

  it("reads nothing from whitespace", () => {
    expect(readPlainText("  \n\n\t ").body).toBeNull()
  })
})

describe("a pasted text import", () => {
  it("produces evidence that validates, with no address and no public demo", async () => {
    const evidence = await pastedTextImporter.read({
      bytes: bytes("Aster Grotesk\nA six-weight grotesque for screens.\n- Variable weight axis"),
      filename: null,
    })
    expect(productSourceEvidenceSchema.safeParse(evidence).success).toBe(true)
    expect(evidence.provider).toBe("pasted_text")
    expect(evidence.originalUrl).toBeUndefined()
    expect(evidence.resolvedUrl).toBeUndefined()
    expect(evidence.publicDemoAvailable).toBe(false)
    expect(evidence.title).toMatchObject({ value: "Aster Grotesk", origin: "document" })
    expect(evidence.bodyText?.value).toContain("six-weight")
  })

  it("refuses an empty paste as having no text", async () => {
    expect(await refusal(pastedTextImporter.read({ bytes: bytes("   "), filename: null }))).toBe(
      "no_text",
    )
  })

  it("refuses bytes that are not text rather than reading replacement characters", () => {
    expect(() => decodeText(new Uint8Array([0xff, 0xfe, 0xfd, 0x00, 0xc3]))).toThrow(ImportError)
  })

  it("hashes the same text the same way twice", async () => {
    const a = await pastedTextImporter.read({ bytes: bytes("Aster\nSame words."), filename: null })
    const b = await pastedTextImporter.read({ bytes: bytes("Aster\nSame words."), filename: null })
    expect(a.contentHash).toBe(b.contentHash)
  })
})

describe("an HTML file import", () => {
  const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <title>Type Scale Studio</title>
    <meta name="description" content="Balanced type scales for modern products.">
    <script>document.body.innerHTML = "<h1>Injected</h1>"</script>
  </head>
  <body>
    <h1>Type Scale Studio</h1>
    <p>Generate modular type scales,
       preview them in real time.</p>
    <ul><li>Export to your stack</li><li>Base size and ratio</li></ul>
    <img src="/relative.png"><img src="https://cdn.example.com/cover.png">
  </body>
</html>`

  it("reads the same way a fetched page is read, without an address", async () => {
    const evidence = await htmlDocumentImporter.read({ bytes: bytes(PAGE), filename: "scale.html" })
    expect(productSourceEvidenceSchema.safeParse(evidence).success).toBe(true)
    expect(evidence.sourceName).toBe("scale.html")
    expect(evidence.title).toMatchObject({ value: "Type Scale Studio", origin: "dom" })
    expect(evidence.summary?.value).toBe("Balanced type scales for modern products.")
    expect(evidence.visibleFeatures.value).toContain("Export to your stack")
    expect(evidence.language).toBe("en")
  })

  it("never reads a script body as text", async () => {
    const evidence = await htmlDocumentImporter.read({ bytes: bytes(PAGE), filename: null })
    expect(evidence.bodyText?.value).not.toContain("Injected")
    expect(evidence.visibleFeatures.value).not.toContain("Injected")
  })

  it("keeps a wrapped paragraph as one line", () => {
    expect(readVisibleText(PAGE, 5000)).toContain(
      "Generate modular type scales, preview them in real time.",
    )
  })

  it("carries only absolute image URLs, since a file has nothing to resolve against", async () => {
    const evidence = await htmlDocumentImporter.read({ bytes: bytes(PAGE), filename: null })
    expect(evidence.previewAssets.map((asset) => asset.sourceUrl)).toEqual([
      "https://cdn.example.com/cover.png",
    ])
  })

  it("refuses a file that is all script, as a JavaScript shell link is refused", async () => {
    const shell = `<!doctype html><html><head><title>App</title></head><body><div id="root"></div><script src="app.js"></script></body></html>`
    expect(await refusal(htmlDocumentImporter.read({ bytes: bytes(shell), filename: null }))).toBe(
      "unsupported_source",
    )
  })
})

describe("a PDF import", () => {
  it("prefers a real title property, and reads the text layer", async () => {
    const pdf = buildPdf(
      [
        "Aster Grotesk specimen",
        "A six-weight grotesque for screens and print.",
        "- Variable weight axis",
      ],
      { title: "Aster Grotesk" },
    )
    const evidence = await pdfDocumentImporter.read({ bytes: pdf, filename: "aster.pdf" })
    expect(productSourceEvidenceSchema.safeParse(evidence).success).toBe(true)
    expect(evidence.title).toMatchObject({ value: "Aster Grotesk", origin: "properties" })
    expect(evidence.pageCount).toBe(1)
    expect(evidence.bodyText?.value).toContain("six-weight grotesque")
    expect(evidence.visibleFeatures.value).toContain("Variable weight axis")
  })

  it("falls back to the first line when the title property is the program's name", async () => {
    const pdf = buildPdf(["Aster Grotesk specimen", "Some body text for the draft."], {
      title: "Microsoft Word - aster_final_v3.docx",
    })
    const evidence = await pdfDocumentImporter.read({ bytes: pdf, filename: null })
    expect(evidence.title).toMatchObject({ value: "Aster Grotesk specimen", origin: "document" })
  })

  it("refuses a PDF with no text layer as having no text", async () => {
    expect(await refusal(pdfDocumentImporter.read({ bytes: buildPdf([]), filename: null }))).toBe(
      "no_text",
    )
  })

  it("refuses a file that is not a PDF, and a PDF that is broken, as unreadable", async () => {
    expect(await refusal(readPdf(bytes("<html>not a pdf</html>")))).toBe("unreadable_file")
    expect(await refusal(readPdf(bytes("%PDF-1.4 then nothing that parses")))).toBe(
      "unreadable_file",
    )
  })

  it("knows a title from a placeholder", () => {
    expect(isPlausibleDocumentTitle("Aster Grotesk")).toBe(true)
    expect(isPlausibleDocumentTitle("Untitled")).toBe(false)
    expect(isPlausibleDocumentTitle("brochure.pdf")).toBe(false)
    expect(isPlausibleDocumentTitle("Microsoft Word - notes")).toBe(false)
  })
})

describe("storage paths", () => {
  const WORKSPACE = "3f0c7a52-3a5f-4b5e-9f3c-2f9d6f1b7a10"
  const OTHER = "9b1d2c3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e"
  const UPLOAD = "11111111-1111-4111-8111-111111111111"

  it("builds a path under the workspace, and recognises only paths it could have built", () => {
    const path = sourcePathFor(WORKSPACE, UPLOAD, "pdf_document")
    expect(path).toBe(`${WORKSPACE}/import-sources/${UPLOAD}.pdf`)
    expect(isSourcePathFor(WORKSPACE, path)).toBe(true)
    // Another workspace's object is the one thing the job must never read.
    expect(isSourcePathFor(OTHER, path)).toBe(false)
    expect(isSourcePathFor(WORKSPACE, `${WORKSPACE}/import-sources/../${OTHER}/x.pdf`)).toBe(false)
    expect(isSourcePathFor(WORKSPACE, `${WORKSPACE}/some-product/${UPLOAD}.pdf`)).toBe(false)
  })

  it("refuses to build a path from anything but a uuid", () => {
    expect(() => sourcePathFor(WORKSPACE, "../../etc", "pasted_text")).toThrow()
  })
})

describe("pasted markup", () => {
  it("is re-read as HTML only when it declares itself a document", () => {
    expect(isWholeHtmlDocument("<!DOCTYPE html><html></html>")).toBe(true)
    expect(isWholeHtmlDocument("  <!-- saved -->\n<html lang=en>")).toBe(true)
    expect(isWholeHtmlDocument("Use the <b> tag for bold.")).toBe(false)
    expect(isWholeHtmlDocument("<!-- a --><!-- b -->\n<!doctype html>")).toBe(true)
    expect(isWholeHtmlDocument("<!-- never closed <html>")).toBe(false)
  })

  it("stays fast on a paste built to make a regular expression backtrack", () => {
    const hostile = "<!--" + "--><!--".repeat(50_000) + "x"
    const started = performance.now()
    expect(isWholeHtmlDocument(hostile)).toBe(false)
    expect(performance.now() - started).toBeLessThan(500)
  })
})

describe("naming the product before anything is read", () => {
  it("uses the file name, then a first line that reads like a name, then the kind", () => {
    expect(
      provisionalContentName({
        kind: "pdf_document",
        filename: "aster-grotesk_specimen.pdf",
        firstLine: null,
      }),
    ).toBe("Aster Grotesk Specimen")
    expect(
      provisionalContentName({
        kind: "pasted_text",
        filename: null,
        firstLine: "# Type Scale Studio",
      }),
    ).toBe("Type Scale Studio")
    expect(
      provisionalContentName({
        kind: "pasted_text",
        filename: null,
        firstLine: 'import React from "react"',
      }),
    ).toBe("Pasted text")
    expect(provisionalContentName({ kind: "html_document", filename: null, firstLine: null })).toBe(
      "Imported HTML",
    )
  })
})

describe("recoveries", () => {
  it("offers pasting the text for every way a handed-over file can be unreadable", () => {
    expect(IMPORT_ERROR_RECOVERIES.unreadable_file).toContain("paste_code")
    expect(IMPORT_ERROR_RECOVERIES.no_text).toContain("paste_code")
    expect(IMPORT_ERROR_RECOVERIES.unsupported_source).toContain("paste_code")
  })

  it("still ends every list with the recovery that cannot fail", () => {
    for (const code of IMPORT_ERROR_CODES) {
      expect(IMPORT_ERROR_RECOVERIES[code].at(-1)).toBe("continue_manually")
    }
  })

  function record(overrides: Partial<ImportRecord["row"]>, errorCode: ImportRecord["errorCode"]) {
    return {
      row: {
        provider: "pdf_document",
        status: "unavailable",
        source_url: null,
        source_filename: "aster.pdf",
        ...overrides,
      },
      errorCode,
      errorMessage: "message",
      evidence: null,
      draft: null,
      withheld: [],
      aiUnavailable: false,
      missingInformation: [],
    } as unknown as ImportRecord
  }

  it("never offers a file a link to replace or publish", () => {
    const actions = recoveriesFor(record({}, "unsupported_source")).map((option) => option.action)
    expect(actions).toEqual(["paste_code", "continue_manually"])
  })

  it("names a file by its file name and a paste by what it was", () => {
    expect(sourceLabelFor(record({}, null))).toBe("aster.pdf")
    expect(sourceLabelFor(record({ provider: "pasted_text", source_filename: null }, null))).toBe(
      "Pasted text",
    )
    expect(sourceLabelFor(record({ provider: "html_document", source_filename: null }, null))).toBe(
      "Pasted HTML",
    )
  })

  it("shows an unreadable file as unsupported, with its recoveries", () => {
    const state = stateFor(record({}, "unreadable_file"))
    expect(state.status).toBe("unsupported")
    expect(state.url).toBe("aster.pdf")
  })
})

describe("what the model and the claims check see", () => {
  it("tells the model what kind of source it was and gives it the running text", async () => {
    const evidence = await pdfDocumentImporter.read({
      bytes: buildPdf(["Aster Grotesk", "Royalty-free for commercial projects."]),
      filename: "aster.pdf",
    })
    const rendered = renderEvidence(evidence)
    expect(rendered).toContain("Source: a PDF document the creator uploaded")
    expect(rendered).toContain("Royalty-free for commercial projects.")
    // A claim the document itself makes is the document's, not an invention.
    expect(evidenceCorpus(evidence)).toContain("royalty-free")
  })

  it("leaves a link import's hash exactly as it was before these sources existed", () => {
    const link = {
      provider: "webpage" as const,
      originalUrl: "https://example.com/aster",
      resolvedUrl: "https://example.com/aster",
      title: { value: "Aster Grotesk", provenance: "observed" as const, origin: "og" as const },
      summary: {
        value: "A six-weight grotesque for screens.",
        provenance: "observed" as const,
        origin: "meta" as const,
      },
      visibleFeatures: {
        value: ["Variable weight axis", "Extended Latin coverage"],
        provenance: "observed" as const,
        origin: "dom" as const,
      },
      previewAssets: [],
      publicDemoAvailable: true,
    }
    // Pinned from the algorithm as it shipped in PR #78. A changed hash would
    // make every existing link import compose a fresh draft on its next read.
    expect(hashEvidence(link)).toBe(
      "02f64dfb82e47866b828a61b36ca5ab089c34becb6dc85c2ba161945a4a453cc",
    )
    expect(
      renderEvidence({
        ...link,
        retrievedAt: "2026-09-12T00:00:00.000Z",
        contentHash: "0".repeat(64),
      }),
    ).not.toContain("Source:")
  })
})

describe("the recovery a file is offered, on screen", () => {
  it("links pasting the text to the paste form, and offers no link to replace", () => {
    const record = {
      row: {
        provider: "html_document",
        status: "unavailable",
        source_url: null,
        source_filename: "artifact.html",
      },
      errorCode: "unsupported_source",
      errorMessage: "Fanwise could not read anything from that page.",
    } as unknown as ImportRecord
    const markup = renderToStaticMarkup(
      createElement(SourcePanel, {
        state: stateFor(record),
        mode: "content",
        handlers: {
          onReplaceLink: () => {},
          onRetry: () => {},
          manualHref: "/studio/manual",
          pasteHref: "/studio/new/link?from=text",
        },
      }),
    )
    expect(markup).toContain("Fanwise cannot read that")
    expect(markup).toContain('href="/studio/new/link?from=text"')
    expect(markup).toContain("Paste the text instead")
    expect(markup).not.toContain("Paste a different link")
    expect(markup).not.toContain("Not built yet")
  })
})
