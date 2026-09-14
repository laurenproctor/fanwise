import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Delete draft, as rendered markup.
 *
 * The unit suite runs in Node with no DOM, so this holds what a render can
 * decide: who sees a control, what the dialog is called and described as,
 * whether the final button starts disabled, what pending and a returned error
 * look like. What only a browser can answer — Escape and Cancel returning
 * focus to the trigger, typing the word enabling the button, the redirect to a
 * populated catalog — is tests/e2e/delete-product-draft.spec.ts.
 */

const ROOT = join(__dirname, "..", "..")

/*
  `useActionState` is the one hook whose state a static render cannot reach,
  so it alone is replaced: the pending and error cases are otherwise
  unrenderable without a browser. Every other hook is React's own.
*/
const action = vi.hoisted(() => ({
  state: { error: null as string | null },
  pending: false,
}))

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>()
  return {
    ...actual,
    useActionState: () => [action.state, () => {}, action.pending],
  }
})
vi.mock("@/lib/products/actions", () => ({
  deleteProductDraftAction: async () => ({ error: null }),
}))

import { DeleteProductDraft } from "@/app/[slug]/[productSlug]/delete-product-draft"
import { draftDeletionBlockedMessage } from "@/lib/products/draft-deletion"

function render(
  eligibility: Parameters<typeof DeleteProductDraft>[0]["eligibility"],
  productName = "Aster Grotesk",
): string {
  return renderToStaticMarkup(
    createElement(DeleteProductDraft, {
      workspaceSlug: "northbound-type",
      productId: "5b0f7a4e-2f4c-4d1b-9a53-0c7e3c1d2a10",
      productName,
      eligibility,
    }),
  )
}

function textOf(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&ldquo;/g, "“")
    .replace(/&rdquo;/g, "”")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
}

/** useId values carry punctuation; they are matched literally. */
function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Every <button>, with its text and whether it is disabled. */
function buttons(markup: string): Array<{ text: string; disabled: boolean }> {
  return [...markup.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((match) => ({
    text: textOf(match[2] ?? ""),
    disabled: /\sdisabled=""/.test(match[1] ?? ""),
  }))
}

beforeEach(() => {
  action.state = { error: null }
  action.pending = false
})

describe("an eligible draft, for its owner", () => {
  it("offers Delete draft in a Danger zone", () => {
    const markup = render({ kind: "eligible" })

    expect(textOf(markup)).toContain("Danger zone")
    expect(buttons(markup)[0]).toEqual({ text: "Delete draft", disabled: false })
  })

  it("names and describes the dialog by its own heading and copy", () => {
    const markup = render({ kind: "eligible" })

    const dialog = /<dialog([^>]*)>/.exec(markup)?.[1] ?? ""
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(dialog)?.[1]
    const describedBy = /aria-describedby="([^"]+)"/.exec(dialog)?.[1]
    expect(labelledBy).toBeTruthy()
    expect(describedBy).toBeTruthy()

    const heading = new RegExp(`<h2[^>]*id="${escape(labelledBy!)}"[^>]*>([\\s\\S]*?)</h2>`).exec(
      markup,
    )
    expect(textOf(heading?.[1] ?? "")).toBe("Delete “Aster Grotesk”?")

    const description = new RegExp(`id="${escape(describedBy!)}"[^>]*>([\\s\\S]*?)</p>`).exec(
      markup,
    )
    expect(textOf(description?.[1] ?? "")).toBe(
      "This permanently removes its product details, uploaded files, images, and unpublished channel drafts from Fanwise. Nothing has been published, so no marketplace listing will be affected.",
    )
  })

  it("starts closed, with the final button disabled until the word is typed", () => {
    const markup = render({ kind: "eligible" })

    expect(/<dialog[^>]*\sopen/.test(markup)).toBe(false)
    expect(textOf(markup)).toContain("Type DELETE to confirm")
    expect(buttons(markup).slice(1)).toEqual([
      { text: "Cancel", disabled: false },
      { text: "Delete draft", disabled: true },
    ])
    // The field is labelled, and is not the product's name.
    const inputId = /<input[^>]*id="([^"]+)"[^>]*name="confirmation"/.exec(markup)?.[1]
    expect(inputId).toBeTruthy()
    expect(markup).toContain(`for="${inputId}"`)
  })

  it("while deleting, says so and disables both buttons", () => {
    action.pending = true
    const markup = render({ kind: "eligible" })

    expect(buttons(markup).slice(1)).toEqual([
      { text: "Cancel", disabled: true },
      { text: "Deleting…", disabled: true },
    ])
    // Read-only rather than disabled, so the typed word still reaches the server.
    const input = /<input[^>]*name="confirmation"[^>]*>/.exec(markup)?.[0] ?? ""
    expect(input).toMatch(/\sreadonly=""/i)
    expect(input).not.toMatch(/\sdisabled=""/)
  })

  it("keeps a returned error visible inside the dialog, as an alert", () => {
    action.state = { error: "That draft could not be deleted. Nothing was removed. Try again." }
    const markup = render({ kind: "eligible" })

    const dialog = /<dialog[\s\S]*<\/dialog>/.exec(markup)?.[0] ?? ""
    expect(dialog).toContain('role="alert"')
    expect(textOf(dialog)).toContain(
      "That draft could not be deleted. Nothing was removed. Try again.",
    )
  })

  it("shows the product's name as text, never as markup", () => {
    const markup = render({ kind: "eligible" }, "<img src=x onerror=alert(1)>")
    expect(markup).not.toContain("<img")
  })
})

describe("an ineligible product", () => {
  it.each(["publication_history", "public_page", "upload_in_progress"] as const)(
    "offers no control for %s, only the reason",
    (blocker) => {
      const markup = render({ kind: "blocked", blocker })

      expect(buttons(markup)).toEqual([])
      expect(markup).not.toContain("<dialog")
      expect(markup).not.toContain("<form")
      expect(textOf(markup)).toContain(draftDeletionBlockedMessage(blocker))
    },
  )
})

describe("the product page", () => {
  const page = readFileSync(join(ROOT, "app", "[slug]", "[productSlug]", "page.tsx"), "utf8")

  it("renders nothing for a caller the database hid it from, which is every non-owner", () => {
    expect(page).toMatch(/deletion\.kind !== "hidden" \? \(\s*<DeleteProductDraft/)
  })

  it("puts it after Activity, outside the product form", () => {
    const activity = page.indexOf("<ActivityLog")
    const control = page.indexOf("<DeleteProductDraft")
    expect(activity).toBeGreaterThan(-1)
    expect(control).toBeGreaterThan(activity)

    const form = readFileSync(
      join(ROOT, "app", "[slug]", "[productSlug]", "product-form.tsx"),
      "utf8",
    )
    expect(form).not.toContain("DeleteProductDraft")
  })
})

describe("the destructive button", () => {
  const css = readFileSync(join(ROOT, "app", "globals.css"), "utf8")

  it("has its own tokens in both themes, rather than borrowing the status red", () => {
    const light = css.slice(css.indexOf("@theme"), css.indexOf(':root[data-theme="dark"]'))
    const dark = css.slice(css.indexOf(':root[data-theme="dark"]'))
    for (const token of ["--color-danger:", "--color-danger-hover:", "--color-on-danger:"]) {
      expect(light, `light ${token}`).toContain(token)
      expect(dark, `dark ${token}`).toContain(token)
    }
  })
})
