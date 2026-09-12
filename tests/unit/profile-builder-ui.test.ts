import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { ProfileDraftFields } from "@/lib/public/profile-draft"
import { presentationFromDraft } from "@/lib/public/profile-presentation"

/**
 * The profile builder, rendered to markup.
 *
 * What static markup can decide: that the preview is the shared component and
 * shows exactly what the fields say, that desktop is the default and the
 * mobile layout is a different layout, that every field has a label, and that
 * no email field or email icon exists anywhere. Typing into a field is a
 * browser event, so the per-keystroke half is the pure mapping these renders
 * are fed from, tested in profile-builder-model.test.ts.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
}))
vi.mock("@/lib/public/draft-actions", () => ({
  saveProfileDraftAction: vi.fn(),
  uploadProfileDraftAvatarAction: vi.fn(),
  continueProfileDetailsAction: vi.fn(),
  saveProfileProductsAction: vi.fn(),
}))

const { PublicProfile } = await import("@/components/public/public-profile")
const { ProfilePreview } =
  await import("@/app/[slug]/settings/public-profile/builder/profile-preview")
const { ProfileDetailsStep } =
  await import("@/app/[slug]/settings/public-profile/builder/profile-details-step")
const { BuilderSteps } = await import("@/app/[slug]/settings/public-profile/builder/builder-header")
const { ManageProductsStep } =
  await import("@/app/[slug]/settings/public-profile/builder/manage-products-step")
const { arrange } = await import("@/lib/public/product-arrangement")

const FIELDS: ProfileDraftFields = {
  handle: "lauren-proctor",
  displayName: "Lauren Proctor",
  shortBio: "Design tools, templates, and resources for thoughtful brands.",
  website: "laurenproctor.com",
  instagram: "@laurenproctor",
  behance: "behance.net/laurenproctor",
}

function present(fields: Partial<ProfileDraftFields> = {}, avatarUrl: string | null = null) {
  const merged = { ...FIELDS, ...fields }
  return presentationFromDraft(merged, { handle: merged.handle, avatarUrl, products: [] })
}

const textOf = (markup: string) =>
  markup
    .split(/<[^>]*>/)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()

function renderPreview(fields: Partial<ProfileDraftFields> = {}, mode?: "desktop" | "mobile") {
  return renderToStaticMarkup(
    createElement(ProfilePreview, {
      heading: "Live preview",
      subheading: "Updates as you type",
      origin: "https://fanwise.com",
      presentation: present(fields),
      published: false,
      emptyProductsMessage: "Products you choose in the next step appear here.",
      initialMode: mode,
    }),
  )
}

describe("the live preview", () => {
  it("shows the fields as they are, including the normalized address", () => {
    const markup = renderPreview()
    const text = textOf(markup)
    expect(text).toContain("fanwise.com/@lauren-proctor")
    expect(text).toContain("Lauren Proctor")
    expect(text).toContain("Design tools, templates, and resources for thoughtful brands.")
    expect(text).toContain("Products")
    expect(text).toContain("About")
    expect(text).toContain("Share")
    expect(text).toContain("Updates as you type")
  })

  it("changes when a field changes, with nothing else in between", () => {
    const before = renderPreview()
    const after = renderPreview({
      displayName: "Northline Studio",
      shortBio: "Type.",
      handle: "northline",
    })
    expect(textOf(after)).toContain("Northline Studio")
    expect(textOf(after)).toContain("fanwise.com/@northline")
    expect(textOf(after)).not.toContain("Lauren Proctor")
    expect(before).not.toEqual(after)
  })

  it("draws an icon for each valid link and none for an invalid or empty one", () => {
    const all = renderPreview()
    expect(all).toContain('data-link="website"')
    expect(all).toContain('data-link="instagram"')
    expect(all).toContain('data-link="behance"')

    const some = renderPreview({ website: "http://insecure.com", behance: "" })
    expect(some).not.toContain('data-link="website"')
    expect(some).toContain('data-link="instagram"')
    expect(some).not.toContain('data-link="behance"')
  })

  it("defaults to desktop, and mobile is a different layout rather than a narrower box", () => {
    const desktop = renderPreview()
    expect(desktop).toContain('data-mode="desktop"')
    expect(desktop).toContain('data-layout="desktop"')
    expect(desktop).toMatch(/aria-pressed="true"[^>]*aria-label="Desktop preview"/)
    expect(desktop).toMatch(/aria-pressed="false"[^>]*aria-label="Mobile preview"/)

    const mobile = renderPreview({}, "mobile")
    expect(mobile).toContain('data-mode="mobile"')
    expect(mobile).toContain('data-layout="mobile"')
    expect(mobile).toMatch(/aria-pressed="true"[^>]*aria-label="Mobile preview"/)
  })

  it("renders device controls as real buttons, operable from the keyboard", () => {
    const markup = renderPreview()
    expect(markup.match(/<button[^>]*aria-label="(Desktop|Mobile) preview"/g)).toHaveLength(2)
  })

  it("keeps the preview inert: no links a creator could leave the builder through", () => {
    const markup = renderPreview()
    const article = markup.slice(markup.indexOf("<article"), markup.indexOf("</article>"))
    expect(article).not.toContain("<a ")
  })

  it("stands in for empty fields in the builder, and not on the public page", () => {
    const empty = present({
      displayName: "",
      shortBio: "",
      website: "",
      instagram: "",
      behance: "",
    })
    const builder = textOf(
      renderToStaticMarkup(
        createElement(PublicProfile, { profile: empty, layout: "desktop", placeholders: true }),
      ),
    )
    expect(builder).toContain("Your studio name")
    const publicPage = textOf(
      renderToStaticMarkup(createElement(PublicProfile, { profile: empty, layout: "responsive" })),
    )
    expect(publicPage).not.toContain("Your studio name")
  })
})

describe("no email anywhere in the builder", () => {
  it("renders no email field, mailto link or email icon", () => {
    const step = renderToStaticMarkup(
      createElement(ProfileDetailsStep, {
        workspaceSlug: "laurens-studio",
        origin: "https://fanwise.com",
        liveHandle: "lauren-proctor",
        published: false,
        initial: { fields: FIELDS, revision: 0, avatarUrl: null, stored: true },
      }),
    )
    expect(step).not.toMatch(/type="email"/)
    expect(step).not.toMatch(/mailto:/i)
    expect(step).not.toMatch(/data-link="email"/)
    expect(textOf(step)).not.toMatch(/\bemail\b/i)
  })

  it("has no email glyph in the shared component's source", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "components", "public", "public-profile.tsx"),
      "utf8",
    )
    expect(source).not.toMatch(/case "email"|mailto/)
  })
})

describe("step 1, profile details", () => {
  const markup = renderToStaticMarkup(
    createElement(ProfileDetailsStep, {
      workspaceSlug: "laurens-studio",
      origin: "https://fanwise.com",
      liveHandle: "lauren-proctor",
      published: false,
      initial: { fields: FIELDS, revision: 2, avatarUrl: null, stored: true },
    }),
  )

  it("labels every field programmatically", () => {
    const inputIds = [...markup.matchAll(/<(?:input|textarea)[^>]*\sid="([^"]+)"/g)].map(
      (m) => m[1]!,
    )
    expect(inputIds.length).toBe(7)
    for (const id of inputIds) {
      expect(markup, `label for ${id}`).toContain(`for="${id}"`)
    }
    for (const label of [
      "Profile image",
      "Studio address",
      "Studio name",
      "Short introduction",
      "Website",
      "Instagram",
      "Behance",
    ]) {
      expect(textOf(markup)).toContain(label)
    }
  })

  it("shows the address prefix, the counter, the file rules and the actions", () => {
    const text = textOf(markup)
    expect(text).toContain("fanwise.com/@")
    expect(text).toContain(`${FIELDS.shortBio.length} / 160`)
    expect(text).toContain("JPG, PNG or WebP · 5 MB max")
    expect(text).toContain("Change image")
    expect(text).toContain("Continue")
    expect(text).toContain("View an example")
    expect(text).toContain("Draft saved")
    expect(markup).toContain('maxLength="160"')
  })

  it("announces save status politely", () => {
    expect(markup).toMatch(/role="status"[^>]*aria-live="polite"/)
  })

  it("has no product selection or ordering on this step", () => {
    expect(markup).not.toMatch(/type="checkbox"|role="switch"|draggable/)
  })

  it("marks the first of three steps current", () => {
    const steps = renderToStaticMarkup(createElement(BuilderSteps, { current: 1 }))
    expect(steps.match(/<li/g)).toHaveLength(3)
    expect(steps).toMatch(/aria-current="step"[^>]*>[\s\S]*?Profile details/)
    expect(textOf(steps)).toMatch(/Manage products[\s\S]*Preview and publish/)
  })
})

describe("step 2, manage products", () => {
  const pid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
  const product = (
    n: number,
    title: string,
    overrides: Partial<import("@/lib/public/product-arrangement").ProductCandidate> = {},
  ) => ({
    id: pid(n),
    title,
    typeLabel: "Templates",
    imageUrl: `/laurens-studio/assets/a${n}/preview`,
    eligibility: { eligible: true } as const,
    existingOrder: null,
    ...overrides,
  })

  const CANDIDATES = [
    product(1, "Editorial Type System"),
    product(2, "Campaign Template Collection", { imageUrl: null }),
    product(3, "Brand Strategy Workbook"),
    product(4, "Minimal Portfolio Template", {
      eligibility: { eligible: false, reason: "not_live" },
    }),
  ]

  function renderStep(
    draft: Array<{ productId: string; visible: boolean }>,
    candidates = CANDIDATES,
    unlistedCount = 0,
  ) {
    const rows = arrange(draft, candidates)
    return renderToStaticMarkup(
      createElement(ManageProductsStep, {
        workspaceSlug: "laurens-studio",
        origin: "https://fanwise.com",
        published: false,
        identity: present(),
        initial: { rows, revision: 3, stored: true, arranged: draft.length > 0 },
        unlistedCount,
      }),
    )
  }

  const previewOf = (markup: string) =>
    markup.slice(markup.indexOf("<article"), markup.indexOf("</article>"))

  const ARRANGED = [
    { productId: pid(3), visible: true },
    { productId: pid(1), visible: false },
    { productId: pid(2), visible: true },
    { productId: pid(4), visible: true },
  ]

  it("has the heading, count, select-all, helper text and actions", () => {
    const text = textOf(renderStep(ARRANGED))
    expect(text).toContain("Choose what customers see")
    expect(text).toContain("2 of 3 selected")
    expect(text).toContain("Select all")
    expect(text).toContain(
      "Drag products to reorder them. Hidden products stay published in their connected shops.",
    )
    expect(text).toContain("Continue")
    expect(text).toContain("Back")
    expect(text).toContain("Draft saved")
    expect(text).toContain("Updates as you edit")
  })

  it("previews only shown products, in the stored order, with the step 1 identity intact", () => {
    const preview = textOf(previewOf(renderStep(ARRANGED)))
    expect(preview).toContain("Lauren Proctor")
    expect(preview).toContain("Design tools, templates, and resources for thoughtful brands.")
    const order = ["Brand Strategy Workbook", "Campaign Template Collection"].map((t) =>
      preview.indexOf(t),
    )
    expect(order.every((i) => i >= 0)).toBe(true)
    expect(order[0]!).toBeLessThan(order[1]!)
    expect(preview).not.toContain("Editorial Type System")
    // Ineligible, even though its stored flag says shown.
    expect(preview).not.toContain("Minimal Portfolio Template")
  })

  it("renders a switch per product whose state matches the preview", () => {
    const markup = renderStep(ARRANGED)
    const switches = [
      ...markup.matchAll(
        /role="switch" aria-checked="(true|false)"[^>]*aria-label="Show ([^"]+) on your profile"/g,
      ),
    ].map((m) => [m[2], m[1]])
    expect(switches).toEqual([
      ["Brand Strategy Workbook", "true"],
      ["Editorial Type System", "false"],
      ["Campaign Template Collection", "true"],
      ["Minimal Portfolio Template", "false"],
    ])
  })

  it("gives every row a keyboard-operable drag handle that states its position", () => {
    const markup = renderStep(ARRANGED)
    const handles = [
      ...markup.matchAll(/<button[^>]*aria-label="Reorder ([^"]+), position (\d) of (\d)"/g),
    ]
    expect(handles.map((m) => [m[1], m[2], m[3]])).toEqual([
      ["Brand Strategy Workbook", "1", "4"],
      ["Editorial Type System", "2", "4"],
      ["Campaign Template Collection", "3", "4"],
      ["Minimal Portfolio Template", "4", "4"],
    ])
    expect(markup).toContain('aria-describedby="reorder-instructions"')
    expect(textOf(markup)).toMatch(/up or down arrow keys/)
  })

  it("explains an ineligible product and disables its switch", () => {
    const markup = renderStep(ARRANGED)
    expect(textOf(markup)).toContain("Not live in a connected shop right now")
    expect(markup).toMatch(
      /role="switch"[^>]*aria-label="Show Minimal Portfolio Template on your profile"[^>]*disabled=""/,
    )
  })

  it("shows an intentional placeholder for a product with no image, in the row and the preview", () => {
    const markup = renderStep(ARRANGED)
    expect(markup).toContain("Campaign Template Collection has no image yet")
    expect(previewOf(markup)).toContain("data-missing-image")
  })

  it("handles an empty selection in the list and the preview", () => {
    const markup = renderStep(ARRANGED.map((entry) => ({ ...entry, visible: false })))
    const text = textOf(markup)
    expect(text).toContain("0 of 3 selected")
    expect(text).toContain("No products are selected")
    expect(textOf(previewOf(markup))).toContain("No products selected yet")
  })

  it("explains a workspace with nothing live yet, and why products are missing", () => {
    const text = textOf(renderStep([], [], 2))
    expect(text).toContain("No products are live in a connected shop yet.")
    expect(text).toMatch(
      /2 products aren(?:'|&#x27;)t listed because they aren(?:'|&#x27;)t live in a connected shop\./,
    )
  })

  it("never offers email and never names a listing action", () => {
    const markup = renderStep(ARRANGED)
    expect(markup).not.toMatch(/mailto:|type="email"|data-link="email"/)
    expect(textOf(markup)).not.toMatch(/\bunpublish|\bdelist/i)
  })

  it("marks step 1 complete and step 2 current", () => {
    const steps = renderToStaticMarkup(createElement(BuilderSteps, { current: 2 }))
    expect(textOf(steps)).toMatch(/Profile details , complete/)
    expect(steps).toMatch(/aria-current="step"[^>]*>[\s\S]*?Manage products/)
    expect(steps.match(/aria-current="step"/g)).toHaveLength(1)
  })
})
