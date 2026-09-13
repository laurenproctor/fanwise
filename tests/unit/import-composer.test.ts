import { describe, expect, it } from "vitest"
import {
  PILL_STATUS_WORDS,
  checkFile,
  classifyInput,
  composerReducer,
  formatDuration,
  initialComposerState,
  linkLabel,
  pillTone,
  readiness,
  type ComposerEvent,
  type ComposerState,
} from "@/lib/imports/composer"
import { IMPORT_LIMITS } from "@/lib/imports/limits"

/**
 * The composer's rules: what counts as a link, which files it takes, how pills
 * move between states, and when "Create draft" may be pressed.
 */

function run(...events: ComposerEvent[]): ComposerState {
  return events.reduce(composerReducer, initialComposerState)
}

describe("what was typed", () => {
  it("reads a standalone https link as a link", () => {
    expect(classifyInput("  https://acme.co/canvas-tote  ")).toEqual({
      kind: "link",
      url: "https://acme.co/canvas-tote",
    })
  })

  it("reads ordinary product copy as text, untouched", () => {
    const copy = "A canvas tote, printed by hand.\nHolds a laptop."
    expect(classifyInput(copy)).toEqual({ kind: "text", text: copy })
  })

  it("keeps a paragraph that contains a URL as text, never as a link", () => {
    const copy = "See https://acme.co/canvas-tote for photos of the tote."
    expect(classifyInput(copy).kind).toBe("text")
  })

  it("does not read a bare word with a dot as a link", () => {
    // validateSourceUrl would prefix these with https://; the composer does not.
    expect(classifyInput("notes.txt").kind).toBe("text")
    expect(classifyInput("acme.co").kind).toBe("text")
  })

  it("refuses a standalone link the importer will not read, with its reason", () => {
    expect(classifyInput("http://acme.co/tote")).toEqual({
      kind: "refused_link",
      message: "Fanwise reads https links only. Paste the secure version of it.",
    })
  })

  it("reads whitespace as nothing", () => {
    expect(classifyInput(" \n\t ")).toEqual({ kind: "empty" })
  })

  it("labels a link by host and path", () => {
    expect(linkLabel("https://www.acme.co/canvas-tote/?utm_source=x")).toBe("acme.co/canvas-tote")
    expect(linkLabel("https://acme.co/")).toBe("acme.co")
  })
})

describe("files", () => {
  it("takes PDF and HTML by name, and refuses everything else", () => {
    expect(checkFile({ name: "brand-guidelines.pdf", size: 10 })).toEqual({ ok: true, type: "pdf" })
    expect(checkFile({ name: "Page.HTM", size: 10 })).toEqual({ ok: true, type: "html" })
    expect(checkFile({ name: "photo.png", size: 10 })).toMatchObject({ ok: false })
    expect(checkFile({ name: "archive.pdf.zip", size: 10 })).toMatchObject({ ok: false })
  })

  it("refuses an empty file and one over its limit", () => {
    expect(checkFile({ name: "a.pdf", size: 0 })).toMatchObject({ ok: false })
    expect(checkFile({ name: "a.pdf", size: IMPORT_LIMITS.maxPdfBytes + 1 })).toMatchObject({
      ok: false,
    })
    expect(checkFile({ name: "a.html", size: IMPORT_LIMITS.maxHtmlBytes + 1 })).toMatchObject({
      ok: false,
    })
    expect(checkFile({ name: "a.pdf", size: IMPORT_LIMITS.maxPdfBytes })).toMatchObject({
      ok: true,
    })
  })

  it("formats a recording's length as minutes and seconds", () => {
    expect(formatDuration(84_000)).toBe("01:24")
    expect(formatDuration(0)).toBe("00:00")
    expect(formatDuration(600_999)).toBe("10:00")
  })
})

describe("pills", () => {
  it("keeps sources in the order they were added", () => {
    const state = run(
      { type: "fileAdded", key: "a", fileType: "pdf", name: "brand-guidelines.pdf", byteSize: 10 },
      { type: "linkAdded", key: "b", url: "https://acme.co/canvas-tote" },
      { type: "recordingAdded", key: "c", label: "Product notes · 01:24", durationMs: 84_000 },
    )
    expect(state.sources.map((source) => source.key)).toEqual(["a", "b", "c"])
  })

  it("holds one link, replacing it in place", () => {
    const state = run(
      { type: "linkAdded", key: "a", url: "https://acme.co/one" },
      { type: "fileAdded", key: "f", fileType: "html", name: "page.html", byteSize: 10 },
      { type: "linkAdded", key: "b", url: "https://acme.co/two" },
    )
    expect(state.sources.map((source) => source.key)).toEqual(["b", "f"])
    expect(state.announcement).toBe("Link replaced with acme.co/two.")
  })

  it("moves a file through truthful states", () => {
    let state = run({ type: "fileAdded", key: "a", fileType: "pdf", name: "a.pdf", byteSize: 1 })
    expect(state.sources[0]!.status).toBe("uploading")
    state = composerReducer(state, { type: "staged", key: "a", sourceId: "s1" })
    expect(state.sources[0]).toMatchObject({ status: "ready", sourceId: "s1" })
  })

  it("never shows a recording as transcribed until the server said so", () => {
    let state = run({ type: "recordingAdded", key: "r", label: "Notes", durationMs: 1000 })
    expect(PILL_STATUS_WORDS[state.sources[0]!.status]).toBe("Recorded")
    state = composerReducer(state, { type: "uploadStarted", key: "r" })
    expect(PILL_STATUS_WORDS[state.sources[0]!.status]).toBe("Uploading")
    state = composerReducer(state, { type: "transcriptionStarted", key: "r", sourceId: "s" })
    expect(PILL_STATUS_WORDS[state.sources[0]!.status]).toBe("Transcribing")
    expect(readiness(state, { kind: "empty" }).canSubmit).toBe(false)
    state = composerReducer(state, { type: "transcribed", key: "r" })
    expect(PILL_STATUS_WORDS[state.sources[0]!.status]).toBe("Transcribed")
    expect(pillTone(state.sources[0]!.status)).toBe("ok")
  })

  it("removes only the pill it names, and ignores late news about a removed one", () => {
    let state = run(
      { type: "fileAdded", key: "a", fileType: "pdf", name: "a.pdf", byteSize: 1 },
      { type: "fileAdded", key: "b", fileType: "pdf", name: "b.pdf", byteSize: 1 },
      { type: "failed", key: "a", message: "The upload did not complete.", retryable: true },
      { type: "staged", key: "b", sourceId: "sb" },
      { type: "removed", key: "a" },
    )
    expect(state.sources.map((source) => source.key)).toEqual(["b"])
    // The upload that finishes after its pill is gone must not bring it back.
    state = composerReducer(state, { type: "staged", key: "a", sourceId: "late" })
    expect(state.sources.map((source) => source.key)).toEqual(["b"])
    expect(state.sources[0]).toMatchObject({ status: "ready" })
  })

  it("stops at the source limit and says so", () => {
    const events: ComposerEvent[] = Array.from(
      { length: IMPORT_LIMITS.maxSources },
      (_, index) => ({
        type: "fileAdded",
        key: `f${index}`,
        fileType: "pdf",
        name: `${index}.pdf`,
        byteSize: 1,
      }),
    )
    const full = run(...events)
    const over = composerReducer(full, {
      type: "fileAdded",
      key: "extra",
      fileType: "pdf",
      name: "extra.pdf",
      byteSize: 1,
    })
    expect(over.sources).toHaveLength(IMPORT_LIMITS.maxSources)
    expect(over.error).toBe(`An import takes up to ${IMPORT_LIMITS.maxSources} sources.`)
  })
})

describe("when Create draft can be pressed", () => {
  it("is shut with nothing added", () => {
    expect(readiness(initialComposerState, { kind: "empty" })).toMatchObject({ canSubmit: false })
  })

  it("opens for typed text alone, or a link alone", () => {
    expect(readiness(initialComposerState, { kind: "text", text: "A tote." }).canSubmit).toBe(true)
    const withLink = run({ type: "linkAdded", key: "l", url: "https://acme.co/tote" })
    expect(readiness(withLink, { kind: "empty" }).canSubmit).toBe(true)
  })

  it("waits for uploads rather than leaving them behind", () => {
    const state = run({ type: "fileAdded", key: "a", fileType: "pdf", name: "a.pdf", byteSize: 1 })
    expect(readiness(state, { kind: "text", text: "A tote." })).toEqual({
      canSubmit: false,
      reason: "Waiting for your sources to finish.",
    })
  })

  it("refuses to submit around a source that needs attention", () => {
    const state = run(
      { type: "fileAdded", key: "a", fileType: "pdf", name: "a.pdf", byteSize: 1 },
      { type: "failed", key: "a", message: "No.", retryable: false },
    )
    expect(readiness(state, { kind: "text", text: "A tote." })).toEqual({
      canSubmit: false,
      reason: "Remove the source that needs attention to continue.",
    })
  })

  it("counts typed text against the source limit, and bounds its length", () => {
    // One link replaces another, so fill with staged files instead.
    const files = run(
      ...Array.from({ length: IMPORT_LIMITS.maxSources }, (_, index): ComposerEvent[] => [
        { type: "fileAdded", key: `f${index}`, fileType: "pdf", name: `${index}.pdf`, byteSize: 1 },
        { type: "staged", key: `f${index}`, sourceId: `s${index}` },
      ]).flat(),
    )
    expect(readiness(files, { kind: "text", text: "one more" }).canSubmit).toBe(false)
    expect(
      readiness(initialComposerState, {
        kind: "text",
        text: "x".repeat(IMPORT_LIMITS.maxPasteCharacters + 1),
      }).canSubmit,
    ).toBe(false)
  })
})
