import { describe, expect, it } from "vitest"
import {
  buildIconPath,
  checkIcon,
  ICON_MIME_TYPES,
  initialsOf,
  MAX_ICON_BYTES,
} from "@/lib/workspaces/icons"

/**
 * The icon's validation, which is the half of the upload path that decides
 * whether bytes reach storage at all.
 *
 * The browser's own check is a convenience and is not tested here: it can be
 * skipped by anything that is not the browser, and these are the rules that
 * hold when it is.
 */

const WORKSPACE = "11111111-1111-1111-1111-111111111111"

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("WEBP"),
  Buffer.alloc(8),
])
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')

describe("checkIcon", () => {
  it("accepts the three formats the bucket allows", () => {
    expect(checkIcon(PNG, PNG.length)).toMatchObject({ ok: true, mimeType: "image/png" })
    expect(checkIcon(JPEG, JPEG.length)).toMatchObject({ ok: true, mimeType: "image/jpeg" })
    expect(checkIcon(WEBP, WEBP.length)).toMatchObject({ ok: true, mimeType: "image/webp" })
  })

  it("reads the format from the bytes, not from the name or the declared type", () => {
    // A zip renamed .png is the case the browser's accept attribute misses.
    const result = checkIcon(ZIP, ZIP.length)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain("not a PNG, JPG or WebP")
  })

  it("refuses svg, which the bucket does not allow and a browser will execute", () => {
    expect(checkIcon(SVG, SVG.length).ok).toBe(false)
  })

  it("refuses anything over 4 MB", () => {
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_ICON_BYTES)])
    const result = checkIcon(big, big.length)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain("4 MB")
  })

  it("accepts a file exactly at the limit", () => {
    const exact = Buffer.concat([PNG, Buffer.alloc(MAX_ICON_BYTES - PNG.length)])
    expect(exact.length).toBe(MAX_ICON_BYTES)
    expect(checkIcon(exact, exact.length).ok).toBe(true)
  })

  it("refuses an empty file rather than storing nothing", () => {
    expect(checkIcon(Buffer.alloc(0), 0).ok).toBe(false)
  })

  it("states the same limit the bucket enforces", () => {
    expect(MAX_ICON_BYTES).toBe(4 * 1024 * 1024)
    expect([...ICON_MIME_TYPES]).toEqual(["image/png", "image/jpeg", "image/webp"])
  })
})

describe("buildIconPath", () => {
  it("leads with the workspace id, which is what the storage policy reads", () => {
    const path = buildIconPath(WORKSPACE, "abc", "image/png")
    expect(path.startsWith(`${WORKSPACE}/`)).toBe(true)
    expect(path).toBe(`${WORKSPACE}/abc.png`)
  })

  it("takes its extension from the sniffed type, never from a supplied name", () => {
    expect(buildIconPath(WORKSPACE, "a", "image/jpeg")).toBe(`${WORKSPACE}/a.jpg`)
    expect(buildIconPath(WORKSPACE, "a", "image/webp")).toBe(`${WORKSPACE}/a.webp`)
  })
})

describe("initialsOf", () => {
  it("takes one letter from each of the first two words", () => {
    expect(initialsOf("Northbound Type")).toBe("NT")
    expect(initialsOf("Lauren’s studio")).toBe("LS")
  })

  it("takes two letters from a single word, so the circle is not half empty", () => {
    expect(initialsOf("Studio")).toBe("ST")
    expect(initialsOf("A")).toBe("A")
  })

  it("survives a name with no letters at all", () => {
    expect(initialsOf("   ")).toBe("")
    expect(initialsOf("!!!")).toBe("")
  })

  it("counts digits, so a name that is a number still shows something", () => {
    expect(initialsOf("24 Fonts")).toBe("2F")
  })
})
