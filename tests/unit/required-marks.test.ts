import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { Field } from "@/components/ui/field"

vi.mock("@/lib/products/actions", () => ({ createProductAction: async () => ({ error: null }) }))

import { NewProductForm } from "@/app/[slug]/new/new-product-form"
import { CredentialsForm } from "@/app/(auth)/credentials-form"

/**
 * Required fields carry a mark, and optional ones do not.
 *
 * This was a browser test that signed up to read four labels. A label's text is
 * decided entirely by the markup, so it is read here from the forms themselves:
 * the sign-up form, the new-product form, and the shared field every other form
 * is built from.
 *
 * The mark is aria-hidden. The input's own `required` is what a screen reader
 * announces, on the control, so the asterisk must never become part of the name.
 */

function labelOf(markup: string, name: string) {
  // A label span that contains a nested mark span closes twice, so it is read
  // by its opening text and whatever follows up to the control.
  const at = markup.indexOf(`<span class="label-mono">${name}`)
  expect(at, `no label ${name}`).toBeGreaterThanOrEqual(0)
  const control = markup.slice(at).search(/<(input|select|textarea)\b/)
  const label = markup.slice(at, at + control)
  return { marked: label.includes("*"), hiddenMark: /aria-hidden="true"[^>]*>\*/.test(label) }
}

describe("required marks", () => {
  it("marks a required field, hidden from assistive technology", () => {
    const markup = renderToStaticMarkup(
      createElement(Field, { label: "Product name", name: "name", required: true }),
    )

    expect(labelOf(markup, "Product name")).toEqual({ marked: true, hiddenMark: true })
    expect(markup).toMatch(/<input[^>]*\brequired=""/)
  })

  it("leaves an optional field unmarked, or the mark stops carrying information", () => {
    const markup = renderToStaticMarkup(
      createElement(Field, { label: "Brand name", name: "brandName" }),
    )

    expect(labelOf(markup, "Brand name")).toEqual({ marked: false, hiddenMark: false })

    // And the product form's own Brand name is that optional field. The form is
    // too wide to render here without its whole page, so its declaration is read.
    const form = readFileSync(
      join(__dirname, "..", "..", "app", "[slug]", "[productSlug]", "product-form.tsx"),
      "utf8",
    )
    const brand = form.slice(form.indexOf('label="Brand name"'))
    const declaration = brand.slice(0, brand.indexOf("/>"))
    expect(declaration).toContain('name="brandName"')
    expect(declaration).not.toMatch(/\brequired\b/)
  })

  it("marks both of the sign-up form's fields", () => {
    const markup = renderToStaticMarkup(
      createElement(CredentialsForm, {
        action: async () => ({ error: null }),
        submitLabel: "Create account",
        passwordAutoComplete: "new-password",
      }),
    )

    expect(labelOf(markup, "Email")).toEqual({ marked: true, hiddenMark: true })
    expect(labelOf(markup, "Password")).toEqual({ marked: true, hiddenMark: true })
  })

  it("marks both of the new-product form's fields, including the hand-built select", () => {
    const markup = renderToStaticMarkup(
      createElement(NewProductForm, { workspaceSlug: "northbound-type" }),
    )

    expect(labelOf(markup, "Product name")).toEqual({ marked: true, hiddenMark: true })
    // Product type is a <select>, which Field does not wrap, so its mark is added
    // by hand. That is the one place a required field could go unmarked.
    expect(labelOf(markup, "Product type")).toEqual({ marked: true, hiddenMark: true })
    expect(markup).toMatch(/<select[^>]*\brequired=""/)
  })
})
