import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

/**
 * The settings surface, rendered to markup.
 *
 * The browser half — dirty buttons, staged files, focus after a save — is
 * tests/e2e/journey-settings.spec.ts, because none of it is decidable from
 * static markup. This half is fast and pins what the page is made of: four
 * sections and no fifth, one save button per section with a name that says
 * which section it saves, and an address that is displayed rather than edited.
 *
 * The action modules are stubbed. They are "use server" files that reach for
 * Supabase and the environment at import time, and nothing here calls one: the
 * forms only need something to hand to useActionState.
 */

vi.mock("@/lib/workspaces/actions", () => ({
  saveStudioDetailsAction: vi.fn(),
  signOutAction: vi.fn(),
}))
vi.mock("@/lib/account/actions", () => ({
  saveAccountDetailsAction: vi.fn(),
  requestPasswordChangeAction: vi.fn(),
}))
vi.mock("@/lib/billing/actions", () => ({
  startCheckoutAction: vi.fn(),
  openBillingPortalAction: vi.fn(),
}))

const { StudioDetailsForm } = await import("@/app/[slug]/settings/studio-details-form")
const { AccountForm } = await import("@/app/[slug]/settings/account-form")
const { SettingsSection } = await import("@/app/[slug]/settings/settings-section")
const { BillingPanel } = await import("@/components/billing/billing-panel")
const { initialsOf } = await import("@/lib/workspaces/icons")

const SLUG = "laurens-studio-ab12"
const ORIGIN = "https://fanwise.example"

function render(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(element)
}

/**
 * The text a reader sees. Splits on tags and keeps what lies between them,
 * rather than deleting tags with a replace: the output is only ever compared in
 * these assertions, but a tag-stripping replace reads to code scanning as an
 * HTML sanitizer that misses nested cases, and it is not one.
 */
function textOf(markup: string): string {
  return markup
    .split(/<[^>]*>/)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
}

function buttons(markup: string): string[] {
  return [...markup.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map((m) => textOf(m[1] ?? ""))
}

function studio(overrides: Partial<Parameters<typeof StudioDetailsForm>[0]> = {}) {
  return render(
    createElement(StudioDetailsForm, {
      workspaceSlug: SLUG,
      appOrigin: ORIGIN,
      name: "Northbound Type",
      iconUrl: null,
      hasIcon: false,
      ...overrides,
    }),
  )
}

function account(overrides: Partial<Parameters<typeof AccountForm>[0]["profile"]> = {}) {
  return render(
    createElement(AccountForm, {
      workspaceSlug: SLUG,
      profile: {
        firstName: "Lauren",
        lastName: "Proctor",
        email: "creator@example.com",
        pendingEmail: null,
        ...overrides,
      },
    }),
  )
}

describe("the studio details section", () => {
  const markup = studio()

  it("shows the studio's existing name in an editable field", () => {
    expect(markup).toContain('value="Northbound Type"')
    expect(markup).toMatch(/<label[^>]*>Workspace name<\/label>/)
  })

  it("names its save button for the section it saves", () => {
    expect(buttons(markup)).toContain("Save studio details")
  })

  it("has no generic save button", () => {
    // The page is long and saves in sections. One "Save changes" among three
    // sections is a button whose effect nobody can predict.
    expect(buttons(markup)).not.toContain("Save changes")
    expect(markup).not.toContain("Save changes")
  })

  it("starts with the save button disabled, because nothing has changed", () => {
    const save = /<button[^>]*>Save studio details<\/button>/.exec(markup)?.[0] ?? ""
    expect(save).toContain("disabled")
  })

  it("states the icon rules the bucket actually enforces", () => {
    expect(textOf(markup)).toContain("PNG, JPG or WebP. Maximum 2 MB.")
  })

  it("accepts only the three formats it names", () => {
    expect(markup).toContain('accept="image/png,image/jpeg,image/webp"')
    expect(markup).toContain('type="file"')
  })

  it("offers no Remove until there is an icon to remove", () => {
    expect(buttons(markup)).not.toContain("Remove")
    expect(
      buttons(studio({ iconUrl: "https://signed.example/icon.png", hasIcon: true })),
    ).toContain("Remove")
  })

  it("falls back to initials rather than a broken image", () => {
    expect(textOf(markup)).toContain(initialsOf("Northbound Type"))
    expect(markup).not.toContain("<img")
  })

  it("renders the stored icon when there is one", () => {
    const withIcon = studio({ iconUrl: "https://signed.example/icon.png", hasIcon: true })
    expect(withIcon).toContain('src="https://signed.example/icon.png"')
    // Decorative: the workspace name is already beside it.
    expect(withIcon).toContain('alt=""')
  })

  it("shows the address, and does not offer it as a text field", () => {
    expect(textOf(markup)).toContain(`fanwise.example/${SLUG}`)
    expect(markup).not.toContain('name="slug"')
    // One text input in this form, and it is the name.
    expect([...markup.matchAll(/<input[^>]*type="text"/g)]).toHaveLength(1)
  })

  it("says why the address cannot be changed rather than leaving it unexplained", () => {
    const text = textOf(markup)
    expect(text).toContain("cannot be changed yet")
    expect(text).toContain("break links you have already shared")
  })

  it("describes the icon control for a screen reader", () => {
    expect(markup).toMatch(/aria-describedby="[^"]*"/)
    expect(markup).toContain("sr-only")
  })
})

describe("the account section", () => {
  const markup = account()

  it("shows the person's own details, separately from the studio's", () => {
    expect(markup).toContain('value="Lauren"')
    expect(markup).toContain('value="Proctor"')
    expect(markup).toContain('value="creator@example.com"')
  })

  it("names its save button for the section it saves", () => {
    expect(buttons(markup)).toContain("Save account details")
    expect(buttons(markup)).not.toContain("Save studio details")
  })

  it("starts with the save button disabled", () => {
    const save = /<button[^>]*>Save account details<\/button>/.exec(markup)?.[0] ?? ""
    expect(save).toContain("disabled")
  })

  it("keeps changing a password apart from saving a profile", () => {
    expect(buttons(markup)).toContain("Change password")
    // No password field on the page: the flow is an emailed link.
    expect(markup).not.toContain('type="password"')
  })

  it("says what changing the password will actually do", () => {
    expect(textOf(markup)).toContain("secure reset link to creator@example.com")
  })

  it("says an email change needs confirming, rather than reporting it as done", () => {
    const text = textOf(account({ pendingEmail: "moved@example.com" }))
    expect(text).toContain("moved@example.com")
    expect(text).toContain("waiting to be confirmed")
    expect(text).toContain("creator@example.com is still the address you sign in with")
  })

  it("does not claim a pending change when there is none", () => {
    expect(textOf(markup)).not.toContain("waiting to be confirmed")
  })
})

describe("the subscription section", () => {
  function panel(state: Parameters<typeof BillingPanel>[0]["state"], connections = 0) {
    return render(
      createElement(BillingPanel, {
        workspaceSlug: SLUG,
        state,
        billableConnections: connections,
        notice: null,
      }),
    )
  }

  it("has no save button, because none of it is a draft", () => {
    const markup = panel({ kind: "trialing", trialEndsAt: "2026-09-25T00:00:00Z", daysLeft: 12 })
    expect(buttons(markup).join(" ")).not.toContain("Save")
  })

  it("reports the trial from real numbers", () => {
    const text = textOf(panel({ kind: "trialing", trialEndsAt: "x", daysLeft: 12 }))
    expect(text).toContain("12 days left")
    expect(text).toContain("Trial active")
  })

  it("counts one day without saying '1 days'", () => {
    expect(textOf(panel({ kind: "trialing", trialEndsAt: "x", daysLeft: 1 }))).toContain(
      "One day left",
    )
  })

  it("prices the connected marketplaces, not an invented number", () => {
    const text = textOf(panel({ kind: "trialing", trialEndsAt: "x", daysLeft: 12 }, 2))
    // $9 base + 2 x $6.
    expect(text).toContain("$21")
    expect(text).toContain("Connected marketplaces")
  })

  it("names each checkout for the charge it makes", () => {
    const names = buttons(panel({ kind: "trial_ended" }))
    expect(names.some((n) => n.startsWith("Subscribe monthly"))).toBe(true)
    expect(names.some((n) => n.startsWith("Subscribe annually"))).toBe(true)
    expect(names).not.toContain("Choose a plan")
  })

  it("offers the portal, and no checkout, once there is a subscription", () => {
    const names = buttons(
      panel({
        kind: "subscribed",
        status: "active",
        interval: "month",
        channelQuantity: 1,
        currentPeriodEnd: "2026-10-11T00:00:00Z",
        cancelAtPeriodEnd: false,
      }),
    )
    expect(names).toContain("Manage subscription and invoices")
    expect(names.some((n) => n.startsWith("Subscribe"))).toBe(false)
  })

  it("says so plainly when the deployment has no billing at all", () => {
    const markup = panel({ kind: "not_configured" })
    expect(textOf(markup)).toContain("Billing is not configured on this deployment")
    expect(buttons(markup)).toHaveLength(0)
  })

  it("reports a state that needs attention as itself", () => {
    const text = textOf(
      panel({
        kind: "subscribed",
        status: "past_due",
        interval: "month",
        channelQuantity: 0,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      }),
    )
    expect(text).toContain("Payment past due")
  })

  it("does not communicate state through colour alone", () => {
    // The pill carries a word as well as a dot and a border.
    expect(textOf(panel({ kind: "trialing", trialEndsAt: "x", daysLeft: 3 }))).toContain(
      "Trial active",
    )
  })
})

describe("the page's sections", () => {
  it("labels each section as a region, under one heading", () => {
    const markup = render(
      createElement(
        SettingsSection,
        { id: "studio-details", heading: "Studio details", description: "Icon, name and address." },
        createElement("p", null, "the section's controls"),
      ),
    )
    expect(markup).toContain('aria-labelledby="studio-details-heading"')
    expect(markup).toContain('id="studio-details-heading"')
    expect(markup).toMatch(/<h2[^>]*>Studio details<\/h2>/)
  })
})

describe("the settings page", () => {
  const source = readFileSync(
    join(__dirname, "..", "..", "app", "[slug]", "settings", "page.tsx"),
    "utf8",
  )

  /**
   * The code, without the prose. The page's own comment explains at length what
   * the Access section was and why it is gone, and a check that read the
   * comments would be failed by the explanation of the thing it is checking for.
   */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")

  /**
   * Public profile is a summary and a link, not a form. Its fields describe a
   * page strangers read, and putting them in the same scroll as an email
   * address is how somebody edits one believing it is the other, so the
   * editing lives at app/[slug]/settings/public-profile. The section is here
   * because "is my profile live" is checked far more often than it is edited.
   */
  it("renders four sections, in order, and no fifth", () => {
    const headings = [...code.matchAll(/heading="([^"]+)"/g)].map((m) => m[1])
    expect(headings).toEqual(["Studio details", "Public profile", "Subscription", "Account"])
  })

  it("links to the public profile page rather than editing it here", () => {
    expect(code).toContain("routes.publicProfileSettings(workspace.slug)")
    // The identity fields belong to the other page. None of them appears here.
    for (const field of ["shortBio", "instagramUrl", "seoDescription"]) {
      expect(code, `${field} should not be edited on the settings page`).not.toContain(field)
    }
  })

  /**
   * The Access section is gone from the interface, not from the model. A members
   * table listing one row saying "you", with a role nothing can change, was a
   * section describing a feature that does not exist yet.
   */
  it("has no Access or Permissions interface", () => {
    expect(code).not.toContain("listWorkspaceMembers")
    expect(code).not.toMatch(/Members|Permissions|Access|Your role/)
  })

  it("leaves the ownership model alone", () => {
    // The query the section used is still exported, for the step that gives
    // membership a UI worth having.
    const queries = readFileSync(
      join(__dirname, "..", "..", "lib", "workspaces", "queries.ts"),
      "utf8",
    )
    expect(queries).toContain("export async function listWorkspaceMembers")
  })

  it("does not show workspace-created metadata", () => {
    expect(code).not.toContain("created_at")
  })

  it("is a server component that redirects an unauthenticated visitor", () => {
    expect(code).not.toContain('"use client"')
    expect(code).toContain('if (!user) redirect("/sign-in")')
  })

  it("does not hardcode a slug, a plan or a price", () => {
    expect(code).not.toMatch(/\$\d/)
    expect(code).toContain("workspace.slug")
  })
})
