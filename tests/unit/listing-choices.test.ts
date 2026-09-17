import { describe, expect, it } from "vitest"
import { choiceVisible, choicesKey, parseChoices } from "@/lib/channels/choices"
import { downloadName } from "@/lib/products/download-name"
import type { ListingChoiceSpec } from "@/lib/channels/types"

/**
 * The two small pieces of shared machinery B9 added, held to their contracts:
 * the parser that keeps a form from writing metadata an adapter never
 * declared, and the download rename that keeps a file's own extension.
 */

const specs: readonly ListingChoiceSpec[] = [
  {
    kind: "single",
    key: "mode",
    label: "Mode",
    options: [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ],
  },
  {
    kind: "text",
    key: "address",
    label: "Address",
    maxLength: 10,
    showWhen: { key: "mode", value: "b" },
  },
  {
    kind: "multiple",
    key: "fields",
    label: "Fields",
    max: 2,
    options: [
      { value: "x", label: "X" },
      { value: "y", label: "Y" },
      { value: "z", label: "Z" },
    ],
  },
]

function form(entries: [string, string][]): FormData {
  const data = new FormData()
  for (const [key, value] of entries) data.append(key, value)
  return data
}

describe("parseChoices", () => {
  it("reads only declared keys, one value for a single, a set for a multiple, a string for a text", () => {
    const parsed = parseChoices(
      specs,
      form([
        ["mode", "b"],
        ["address", "  gallery "],
        ["fields", "x"],
        ["fields", "y"],
        ["fields", "x"],
        ["extra", "no"],
      ]),
    )
    expect(parsed).toEqual({
      ok: true,
      values: { mode: "b", address: "gallery", fields: ["x", "y"] },
    })
  })

  it("refuses a value outside the options, and names the choice", () => {
    expect(parseChoices(specs, form([["mode", "c"]]))).toEqual({
      ok: false,
      message: "Mode: that is not one of the options.",
    })
    expect(parseChoices(specs, form([["fields", "q"]]))).toEqual({
      ok: false,
      message: "Fields: q is not one of the options.",
    })
    expect(
      parseChoices(
        specs,
        form([
          ["fields", "x"],
          ["fields", "y"],
          ["fields", "z"],
        ]),
      ),
    ).toEqual({ ok: false, message: "Fields: choose at most 2." })
    expect(parseChoices(specs, form([["address", "x".repeat(11)]]))).toEqual({
      ok: false,
      message: "Address: keep this under 10 characters.",
    })
  })

  it("stores nothing chosen as null and an empty set, never as undefined", () => {
    expect(parseChoices(specs, form([]))).toEqual({
      ok: true,
      values: { mode: null, address: null, fields: [] },
    })
  })

  it("shows a conditional choice only while its condition holds", () => {
    expect(choiceVisible(specs[1]!, { mode: "a" })).toBe(false)
    expect(choiceVisible(specs[1]!, { mode: "b" })).toBe(true)
    expect(choiceVisible(specs[0]!, {})).toBe(true)
  })

  it("keys on the current values in declaration order", () => {
    expect(choicesKey(specs, { fields: ["x"], mode: "a" })).toBe(
      choicesKey(specs, { mode: "a", fields: ["x"] }),
    )
    expect(choicesKey(specs, { mode: "a" })).not.toBe(choicesKey(specs, { mode: "b" }))
  })
})

describe("downloadName", () => {
  it("renames to what was asked for, keeping the row's own extension", () => {
    expect(downloadName("cover-1616x1264.jpg", "01-cover")).toBe("01-cover.jpg")
    expect(downloadName("aster.zip", "aster-grotesk-behance.zip")).toBe("aster-grotesk-behance.zip")
    expect(downloadName("aster.zip", "evil.exe")).toBe("evil.zip")
  })

  it("keeps the row's name when nothing usable was asked for", () => {
    expect(downloadName("aster.zip", null)).toBe("aster.zip")
    expect(downloadName("aster.zip", "   ")).toBe("aster.zip")
    expect(downloadName("aster.zip", "../../etc/passwd")).toBe("passwd.zip")
  })
})
