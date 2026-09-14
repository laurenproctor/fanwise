import { describe, expect, it } from "vitest"
import { renderEvidence } from "@/lib/imports/compose"
import { evidenceCorpus } from "@/lib/imports/claims"
import { IMPORT_ERROR_CODES, IMPORT_ERROR_RECOVERIES, ImportError } from "@/lib/imports/errors"
import { hashEvidence, productSourceEvidenceSchema } from "@/lib/imports/evidence"
import { isWholeHtmlDocument } from "@/lib/imports/paste"
import {
  HTML_LIMITS,
  readAssets,
  readMetaTags,
  readSummaryParagraph,
  readVisibleFeatures,
  readVisibleText,
} from "@/lib/imports/retrieval/html"
import { IMPORT_LIMITS, megabytes } from "@/lib/imports/limits"
import {
  collapseLetterSpacing,
  isPlausibleDocumentTitle,
  readPdf,
  withoutRunningLines,
} from "@/lib/imports/retrieval/pdf"
import {
  isMostlyCode,
  isProseLine,
  looksLikeCode,
  readPlainText,
} from "@/lib/imports/retrieval/plain-text"
import {
  CONTENT_IMPORTERS,
  decodeText,
  htmlDocumentImporter,
  pastedTextImporter,
  pdfDocumentImporter,
} from "@/lib/imports/sources/content"
import { SOURCE_LABELS, descriptorFor } from "@/lib/imports/sources/registry"
import { isSourcePathFor, maxBytesFor, sourcePathFor } from "@/lib/imports/source-storage"
import { provisionalContentName } from "@/lib/imports/start"
import { CONTENT_SOURCE_KINDS, SOURCE_KINDS, isContentSourceKind } from "@/lib/imports/types"
import {
  draftFor,
  fitDescription,
  htmlSourcesWithoutPictures,
  recoveriesFor,
  sourceLabelFor,
  stateFor,
} from "@/lib/imports/view"
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

  it("does not overwrite a description the file wrote with a paragraph it shows", async () => {
    const evidence = await htmlDocumentImporter.read({ bytes: bytes(PAGE), filename: null })
    expect(evidence.summary).toMatchObject({
      value: "Balanced type scales for modern products.",
      origin: "meta",
    })
  })

  it("refuses a file that is all script, as a JavaScript shell link is refused", async () => {
    const shell = `<!doctype html><html><head><title>App</title></head><body><div id="root"></div><script src="app.js"></script></body></html>`
    expect(await refusal(htmlDocumentImporter.read({ bytes: bytes(shell), filename: null }))).toBe(
      "unsupported_source",
    )
  })
})

describe("an HTML specimen that describes itself nowhere", () => {
  /*
    The shape of a real type specimen: no <html>, <head> or <body>, a title, an
    embedded font as base64 inside CSS, an editable tester, hint paragraphs,
    one-word section headings, glyph grids a script fills in, and no <img>.
  */
  const FONT = `data:font/woff2;base64,${"d09GMgABAAAAA".repeat(400)}`
  const SPECIMEN = `<title>Blimp Display</title>
<meta charset="utf-8">
<style>@font-face { font-family: "Blimp"; src: url(${FONT}) format("woff2"); }
.hero p { background: url(data:image/png;base64,iVBORw0KGgo=); }</style>
<nav><p>Home, specimens, fonts in progress and the rest of the studio's catalogue.</p></nav>
<header><span>Blimp Display <span class="tag">/ v0.7 specimen</span></span></header>
<div class="hero">
  <p class="sub">A bubble-letter display family built from inflated strokes: a fat white fill with a thick black contour. Upper and lowercase Latin and Cyrillic, Japanese kana, plus a tilted throw-up cut.</p>
</div>
<section>
  <h2>Try it</h2>
  <p contenteditable>HELLO NEW YORK, the quick brown fox jumps over the lazy dog</p>
  <label for="size">Size <input type="range" id="size"></label>
  <button type="button">Throwie</button>
  <p class="hint">Click the text to type. Upper and lowercase, Latin with accents, Cyrillic and kana.</p>
</section>
<section><h2>Throwie</h2><p>The graffiti throw-up cut: every letter tilts and bounces a little.</p></section>
<section><h2>Kerning</h2><div class="glyphs" id="kern"></div></section>
<section><h2>Kana</h2><div class="glyphs" id="kana"></div></section>
<section><h2>Cyrillic</h2><div class="glyphs" id="cyr"></div></section>
<section><h2>Specs</h2><dl><dt>Format</dt><dd>TrueType</dd></dl></section>
<ul><li>Menu</li><li>Home</li><li>Solid and Outline layered</li></ul>
<script>
  document.getElementById("kana").innerHTML = "<p>A generated paragraph that no reader of the file ever sees as markup.</p><img src='https://cdn.example.com/drawn.png'>"
</script>`

  it("summarises from the first substantial paragraph it shows, as observed DOM text", async () => {
    const evidence = await htmlDocumentImporter.read({
      bytes: bytes(SPECIMEN),
      filename: "blimp-display-specimen.html",
    })
    expect(productSourceEvidenceSchema.safeParse(evidence).success).toBe(true)
    expect(evidence.title).toMatchObject({ value: "Blimp Display", origin: "dom" })
    expect(evidence.summary?.provenance).toBe("observed")
    expect(evidence.summary?.origin).toBe("dom")
    expect(
      evidence.summary?.value.startsWith(
        "A bubble-letter display family built from inflated strokes",
      ),
    ).toBe(true)
  })

  it("skips navigation, editable samples, control labels and hints when choosing it", () => {
    // Without the lead paragraph, every earlier candidate is one that must be
    // passed over: a paragraph in <nav>, an editable sample, and a hint.
    const withoutLead = SPECIMEN.replace(/<div class="hero">[\s\S]*?<\/div>/, "")
    expect(readSummaryParagraph(withoutLead)).toBe(
      "The graffiti throw-up cut: every letter tilts and bounces a little.",
    )
    expect(readSummaryParagraph(`<p>Click here to start typing.</p><p>Size</p>`)).toBeNull()
    expect(
      readSummaryParagraph(
        `<p hidden>A hidden paragraph that nobody reading the page can see.</p>`,
      ),
    ).toBeNull()
  })

  it("never chooses a paragraph from script, template, noscript, svg or iframe contents", () => {
    const long = "A paragraph long enough to be chosen as the summary of this whole page."
    for (const tag of ["script", "template", "noscript", "svg", "iframe", "object", "canvas"]) {
      const markup = `<${tag}><p>${long} (${tag})</p></${tag}><p>The visible lead paragraph, which is the one a reader actually sees.</p>`
      expect(readSummaryParagraph(markup), tag).toBe(
        "The visible lead paragraph, which is the one a reader actually sees.",
      )
    }
  })

  it("cuts a long first paragraph at a sentence rather than mid-word, within the cap", () => {
    const sentence = "This sentence describes the product in plain and ordinary words. "
    const summary = readSummaryParagraph(`<p>${sentence.repeat(20)}</p>`)
    expect(summary).not.toBeNull()
    expect(summary!.length).toBeLessThanOrEqual(600)
    expect(summary!.endsWith(".")).toBe(true)
  })

  it("stays fast on a file built of unclosed paragraphs", () => {
    const hostile = "<p>unclosed words ".repeat(50_000)
    const started = performance.now()
    expect(readSummaryParagraph(hostile)).toBeNull()
    expect(performance.now() - started).toBeLessThan(500)
  })

  it("keeps one-word section headings, and still drops one-word list items", async () => {
    const evidence = await htmlDocumentImporter.read({ bytes: bytes(SPECIMEN), filename: null })
    const features = evidence.visibleFeatures.value
    for (const heading of ["Throwie", "Kerning", "Kana", "Cyrillic", "Specs", "Try it"]) {
      expect(features, heading).toContain(heading)
    }
    expect(features).toContain("Solid and Outline layered")
    expect(features).not.toContain("Menu")
    expect(features).not.toContain("Home")
    // A one-word heading still has to be a word of three letters or more.
    expect(readVisibleFeatures("<h2>Go</h2><h2>2026</h2><h3>→→→</h3><h1>Menu</h1>")).toEqual([])
  })

  it("imports no picture from an embedded font, a CSS data URI or a script's markup", async () => {
    const evidence = await htmlDocumentImporter.read({ bytes: bytes(SPECIMEN), filename: null })
    expect(evidence.previewAssets).toEqual([])
    // Nothing the file embeds reaches evidence at all, so nothing downstream can
    // mistake a font for a picture or for a file a buyer receives.
    const stored = JSON.stringify(evidence)
    expect(stored).not.toContain("data:font")
    expect(stored).not.toContain("base64")
    expect(stored).not.toContain("drawn.png")
    expect(evidence.bodyText?.value).not.toContain("generated paragraph")
    expect(readAssets(`<img src="${FONT}">`, readMetaTags(""), null)).toEqual([])
  })

  it("prefers every description the file wrote over a paragraph, in the documented order", async () => {
    const paragraph = "<p>The visible lead paragraph, which is the one a reader actually sees.</p>"
    const jsonLd = `<script type="application/ld+json">{"@type":"Product","description":"From JSON-LD."}</script>`
    const meta = `<meta name="description" content="From the meta description.">`
    const og = `<meta property="og:description" content="From Open Graph.">`
    const read = async (head: string) =>
      (await htmlDocumentImporter.read({ bytes: bytes(`${head}${paragraph}`), filename: null }))
        .summary

    expect(await read(`${og}${meta}${jsonLd}`)).toMatchObject({
      value: "From Open Graph.",
      origin: "og",
    })
    expect(await read(`${meta}${jsonLd}`)).toMatchObject({
      value: "From the meta description.",
      origin: "meta",
    })
    expect(await read(jsonLd)).toMatchObject({ value: "From JSON-LD.", origin: "jsonld" })
    expect(await read("")).toMatchObject({
      value: "The visible lead paragraph, which is the one a reader actually sees.",
      origin: "dom",
    })
  })

  it("counts a JSON-LD image as importable, and says so when there is no picture at all", async () => {
    const withJsonLdImage = await htmlDocumentImporter.read({
      bytes: bytes(
        `<script type="application/ld+json">{"image":"https://cdn.example.com/cover.png"}</script><h1>Aster Grotesk</h1>`,
      ),
      filename: null,
    })
    expect(withJsonLdImage.previewAssets).toEqual([
      { sourceUrl: "https://cdn.example.com/cover.png", origin: "jsonld" },
    ])

    const specimen = await htmlDocumentImporter.read({ bytes: bytes(SPECIMEN), filename: null })
    const record = (evidence: typeof specimen, provider: string) =>
      ({
        row: { provider, source_url: null, source_filename: "blimp-display-specimen.html" },
        evidence,
        sources: [],
      }) as unknown as ImportRecord

    expect(htmlSourcesWithoutPictures(record(specimen, "html_document"))).toEqual([
      "blimp-display-specimen.html",
    ])
    expect(htmlSourcesWithoutPictures(record(withJsonLdImage, "html_document"))).toEqual([])
    // A paste or a PDF never had pictures to find, so it is not told otherwise.
    const paste = await pastedTextImporter.read({ bytes: bytes("Aster\nWords."), filename: null })
    expect(htmlSourcesWithoutPictures(record(paste, "pasted_text"))).toEqual([])
  })
})

describe("a PDF printed from a web page", () => {
  /*
    The text layer of a type specimen saved with the browser's "Save as PDF":
    tracked-out navigation and labels, the lead paragraph wrapped over four
    visual lines, figures as labels, and the browser's date, title, address and
    page number on every page.
  */
  const header = (page: number) => [
    `9/13/26, 8:46 PM Facette`,
    `file:///Users/me/Desktop/Facette.html ${page}/9`,
  ]
  const FIRST_PAGE = [
    "F A C E T T E",
    "· T H I N",
    "T O",
    "B L A C K ·",
    "V 0 . 5",
    "T E S T E R W E I G H T S I D E A A N AT O M Y",
    "A wide display face that lives between two worlds: octagonal,",
    "machined curves and stems cut like a stone inscription. One",
    "45 degree angle, repeated at every scale, now in caps and",
    "lowercase.",
    "G LY P H S",
    "287",
    "W ORD M AR K STORE FRONT LABE L LO W ERCAS E F IGURE S ACCENTS",
    "The quick",
    ...header(1),
  ]
  const pages = [
    FIRST_PAGE,
    ["brown fox", "Click the line and type. Caps, lowercase and figures are drawn.", ...header(2)],
    ["Most gothics pick one construction and apply it everywhere.", ...header(3)],
  ]

  it("joins tracked-out letters, and leaves ordinary words alone", () => {
    expect(collapseLetterSpacing("F A C E T T E")).toBe("FACETTE")
    expect(collapseLetterSpacing("V 0 . 5")).toBe("V0.5")
    expect(collapseLetterSpacing("B L A C K ·")).toBe("BLACK·")
    expect(collapseLetterSpacing("T O")).toBe("T O")
    expect(collapseLetterSpacing("A wide display face, like B, D, P and R.")).toBe(
      "A wide display face, like B, D, P and R.",
    )
    expect(collapseLetterSpacing("Version 2.5 of a font")).toBe("Version 2.5 of a font")
  })

  it("drops the browser's running header and footer from every page, and nothing else", () => {
    const cleaned = withoutRunningLines(pages.map((lines) => lines.map(collapseLetterSpacing)))
    const text = cleaned.flat().join("\n")
    expect(text).not.toContain("8:46 PM")
    expect(text).not.toContain("file:///")
    expect(text).toContain("FACETTE")
    expect(text).toContain("Most gothics pick one construction")
    // One page has no running matter to find: nothing repeats.
    expect(withoutRunningLines([FIRST_PAGE])).toEqual([FIRST_PAGE])
  })

  it("keeps a heading that repeats mid-page", () => {
    const body = (n: number) => ["Intro", "one", "two", "three", "Specs", "four", "five", `${n}`]
    const cleaned = withoutRunningLines([body(1), body(2), body(3)])
    expect(cleaned.every((lines) => lines.includes("Specs"))).toBe(true)
  })

  it("summarises from the lead paragraph, not from the labels around it", () => {
    const text = withoutRunningLines(pages.map((lines) => lines.map(collapseLetterSpacing)))
      .map((lines) => lines.join("\n"))
      .join("\n\n")
    const reading = readPlainText(text)
    expect(reading.title).toBe("FACETTE")
    expect(reading.summary).toBe(
      "A wide display face that lives between two worlds: octagonal, machined curves and stems cut like a stone inscription. One 45 degree angle, repeated at every scale, now in caps and lowercase.",
    )
  })

  it("tells a label from a line of prose", () => {
    for (const label of ["GLYPHS", "THIN · 100", "OTF TTF VF", "TESTERWEIGHTSIDEAAN AT OMY"]) {
      expect(isProseLine(label), label).toBe(false)
    }
    expect(isProseLine("W ORD M AR K STORE FRONT LABE L LO W ERCAS E F IGURE S ACCENTS")).toBe(
      false,
    )
    expect(isProseLine("machined curves and stems cut like a stone inscription. One")).toBe(true)
  })
})

describe("a description Fanwise fills in", () => {
  const sentence = "Each stem is heavier than the last, so the family climbs one scale. "

  it("fits the field, cut at a sentence end", () => {
    const fitted = fitDescription(sentence.repeat(40))
    expect(fitted.length).toBeLessThanOrEqual(IMPORT_LIMITS.maxListingDescription)
    expect(fitted.endsWith("one scale.")).toBe(true)
    expect(fitDescription("Short and whole.")).toBe("Short and whole.")
  })

  it("cuts at a word and says so when no sentence ends near the limit", () => {
    const fitted = fitDescription("word ".repeat(400))
    expect(fitted.length).toBeLessThanOrEqual(IMPORT_LIMITS.maxListingDescription)
    expect(fitted.endsWith("word…")).toBe(true)
  })

  function record(canonicalDescription: string | null, summary: string) {
    return {
      row: { accepted: {}, provider: "pdf_document", source_url: null },
      product: {
        name: "Facette",
        canonical_title: null,
        canonical_description: canonicalDescription,
        base_price: null,
        currency: "USD",
        product_type: "other",
      },
      evidence: {
        summary: { value: summary, provenance: "observed", origin: "document" },
        visibleFeatures: { value: [], provenance: "observed", origin: "document" },
      },
      draft: null,
      sources: [],
    } as unknown as ImportRecord
  }

  it("never opens the listing over the description limit from what a source said", () => {
    const description = draftFor(record(null, sentence.repeat(60))).description
    expect(description.value.length).toBeLessThanOrEqual(IMPORT_LIMITS.maxListingDescription)
    expect(description.origin).toEqual({ kind: "observed", from: "document" })
  })

  it("leaves a description the creator saved exactly as they saved it", () => {
    const saved = sentence.repeat(30)
    expect(draftFor(record(saved, "A summary.")).description.value).toBe(saved.trim())
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

describe("upload limits", () => {
  const LIMIT = Math.floor(4.8 * 1024 * 1024)

  it("takes a PDF or an HTML file up to 4.8 MB, and says so", () => {
    expect(IMPORT_LIMITS.maxPdfBytes).toBe(LIMIT)
    expect(IMPORT_LIMITS.maxHtmlBytes).toBe(LIMIT)
    expect(maxBytesFor("pdf_document")).toBe(LIMIT)
    expect(maxBytesFor("html_document")).toBe(LIMIT)
    expect(megabytes(LIMIT)).toBe("4.8 MB")
    expect(megabytes(10 * 1024 * 1024)).toBe("10 MB")
  })

  it("keeps a fetched page at its own, smaller limit", () => {
    expect(HTML_LIMITS.maxBytes).toBe(2 * 1024 * 1024)
  })

  it("reads an uploaded HTML file larger than a fetched page may be", async () => {
    const page = `<!doctype html><html><head><title>Type Scale Studio</title></head><body><h1>Type Scale Studio</h1><p>Generate modular type scales for modern products.</p>${" ".repeat(3 * 1024 * 1024)}</body></html>`
    const evidence = await htmlDocumentImporter.read({ bytes: bytes(page), filename: null })
    expect(evidence.title?.value).toBe("Type Scale Studio")
  })

  it("refuses an uploaded HTML file over 4.8 MB", async () => {
    const page = `<html>${" ".repeat(LIMIT)}</html>`
    expect(await refusal(htmlDocumentImporter.read({ bytes: bytes(page), filename: null }))).toBe(
      "too_large",
    )
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
  it("uses the file name, then a first line that reads like a name, then a fallback", () => {
    expect(
      provisionalContentName({
        filename: "aster-grotesk_specimen.pdf",
        firstLine: null,
      }),
    ).toBe("Aster Grotesk Specimen")
    expect(
      provisionalContentName({
        filename: null,
        firstLine: "# Type Scale Studio",
      }),
    ).toBe("Type Scale Studio")
    expect(
      provisionalContentName({
        filename: null,
        firstLine: 'import React from "react"',
        fallback: "Pasted text",
      }),
    ).toBe("Pasted text")
    expect(provisionalContentName({ filename: null, firstLine: null })).toBe("Imported product")
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
