import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { RESERVED_HANDLES, classifyHandle, normalizeHandleInput } from "@/lib/public/handles"
import {
  MAX_PROFILE_LINKS,
  checkLinks,
  derivedLabel,
  parseContact,
  parseLinkUrl,
  platformOf,
  publishableLinks,
  resolveLinks,
} from "@/lib/public/profile-links"
import {
  presentationFromDraft,
  presentationFromPublicView,
} from "@/lib/public/profile-presentation"
import {
  DRAFT_LIMITS,
  checkDetailsStep,
  draftFieldsSchema,
  draftFromRow,
  seedDraftFromProfile,
  type ProfileDraftFields,
} from "@/lib/public/profile-draft"
import {
  checkLocalImage,
  createImagePreviewManager,
  fileIdentity,
} from "@/lib/public/image-preview"
import { MAX_AVATAR_BYTES } from "@/lib/public/avatar-rules"

/**
 * The profile builder's pure half: the address, the links, the draft model,
 * the preview mapping and the image-preview rule. The timing half is
 * profile-builder-controllers.test.ts; the rendered half is
 * profile-builder-ui.test.ts.
 */

const FIELDS: ProfileDraftFields = {
  handle: "lauren-proctor",
  displayName: "Lauren Proctor",
  shortBio: "Design tools, templates, and resources for thoughtful brands.",
  about: "",
  city: "",
  countryCode: "",
  location: "",
  links: [
    { url: "laurenproctor.com", label: "" },
    { url: "https://www.instagram.com/laurenproctor/", label: "" },
    { url: "behance.net/laurenproctor", label: "Portfolio" },
  ],
  contact: "",
}

/** A live profile row, with every column the generated type names. */
function liveRow(
  overrides: Partial<Parameters<typeof seedDraftFromProfile>[0]> = {},
): Parameters<typeof seedDraftFromProfile>[0] {
  return {
    id: "0f9f2d4e-1c3b-4a5e-9f7d-2b8c6a1e4d30",
    workspace_id: "w",
    handle: "northline",
    display_name: "Northline",
    short_bio: null,
    about: null,
    location: null,
    city: null,
    country_code: null,
    avatar_path: null,
    website_url: null,
    instagram_url: null,
    behance_url: null,
    contact_url: null,
    status: "draft",
    seo_title: null,
    seo_description: null,
    published_at: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  }
}

/** The live row's own check, `public_profiles_contact_url_scheme` in 20260912010000. */
const CONTACT_URL_CONSTRAINT = /^(https:\/\/[^\s<>"]+|mailto:[^\s<>"@]+@[^\s<>"@]+)$/

describe("studio address normalization", () => {
  it("folds what people type without meaning anything by it", () => {
    expect(normalizeHandleInput("Lauren Proctor")).toBe("lauren-proctor")
    expect(normalizeHandleInput("  @Lauren_Proctor ")).toBe("lauren-proctor")
    expect(normalizeHandleInput("lauren  proctor")).toBe("lauren-proctor")
  })

  it("repairs nothing else, so the shape check still names the problem", () => {
    expect(classifyHandle("lauren.proctor")).toMatchObject({ kind: "invalid" })
    expect(classifyHandle("lauren--proctor")).toMatchObject({ kind: "invalid" })
    expect(classifyHandle("-lauren")).toMatchObject({ kind: "invalid" })
    expect(classifyHandle("ab")).toMatchObject({ kind: "invalid" })
  })

  it("keeps an invisible character visible to the check instead of turning it into a hyphen", () => {
    const classified = classifyHandle("lauren﻿proctor")
    expect(classified.kind).toBe("invalid")
    expect(classified.kind === "invalid" && classified.message).toMatch(/invisible/i)
  })

  it("classifies empty, valid and reserved distinctly", () => {
    expect(classifyHandle("   ")).toEqual({ kind: "empty" })
    expect(classifyHandle("Lauren Proctor")).toEqual({ kind: "valid", value: "lauren-proctor" })
    expect(classifyHandle("Settings")).toMatchObject({ kind: "reserved", value: "settings" })
  })
})

describe("reserved addresses cover the application's routes", () => {
  const APP = join(__dirname, "..", "..", "app")

  it.each([
    "settings",
    "products",
    "channels",
    "api",
    "auth",
    "sign-in",
    "sign-up",
    "onboarding",
    "profile",
  ])("reserves %s", (word) => {
    expect(RESERVED_HANDLES.has(word)).toBe(true)
    expect(classifyHandle(word).kind).toBe("reserved")
  })

  it("reserves every workspace sub-route, so a future move of handles to the root stays safe", () => {
    const workspace = join(APP, "[slug]")
    const segments = readdirSync(workspace).filter(
      (entry) =>
        statSync(join(workspace, entry)).isDirectory() && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(entry),
    )
    expect(segments.length, "the workspace route tree should be found").toBeGreaterThan(2)
    expect(segments.filter((segment) => !RESERVED_HANDLES.has(segment))).toEqual([])
  })
})

describe("profile links", () => {
  it("accepts any site, typed the way people type it, as one canonical https URL", () => {
    expect(parseLinkUrl("laurenproctor.com")).toEqual({
      kind: "valid",
      url: "https://laurenproctor.com/",
      label: "laurenproctor.com",
    })
    expect(parseLinkUrl("https://www.studio.co.uk/work")).toMatchObject({
      kind: "valid",
      label: "studio.co.uk",
    })
    // Not a list of networks: an address nobody planned for is just as valid.
    expect(parseLinkUrl("are.na/lauren-proctor")).toMatchObject({
      kind: "valid",
      url: "https://are.na/lauren-proctor",
    })
    expect(parseLinkUrl("https://laurenproctor.substack.com")).toMatchObject({ kind: "valid" })
  })

  it("treats a blank address as absent, not invalid", () => {
    expect(parseLinkUrl("   ")).toEqual({ kind: "empty" })
    expect(checkLinks([{ url: "", label: "" }])).toEqual([])
  })

  it.each([
    ["javascript:alert(1)", "Use a web address, like studio.com."],
    ["JavaScript:alert(1)", "Use a web address, like studio.com."],
    ["data:text/html,hi", "Use a web address, like studio.com."],
    ["mailto:hello@studio.com", "Use a web address, like studio.com."],
    ["ftp://files.studio.com", "Use a web address, like studio.com."],
    ["http://studio.com", "Use an https:// address."],
  ])("refuses the unsafe scheme in %s, saying what to use instead", (value, message) => {
    expect(parseLinkUrl(value)).toEqual({ kind: "invalid", message })
  })

  it.each([
    ["not a site"],
    ["localhost"],
    ["127.0.0.1"],
    ["https://studio.com:8443"],
    ["https://user:pass@studio.com"],
    ["@laurenproctor"],
    ["https://"],
  ])("refuses the malformed address %s with a readable message", (value) => {
    const parsed = parseLinkUrl(value)
    expect(parsed.kind).toBe("invalid")
    expect(parsed.kind === "invalid" && parsed.message).toMatch(/^Use /)
  })

  it("never emits anything but https, whatever the input", () => {
    for (const value of ["studio.com", "HTTPS://Studio.com/A", "www.behance.net/x"]) {
      const parsed = parseLinkUrl(value)
      expect(parsed.kind === "valid" && parsed.url).toMatch(/^https:\/\//)
    }
  })

  it("draws a platform's glyph for a platform, and a globe for anything else", () => {
    expect(platformOf("https://www.instagram.com/lp/")).toBe("instagram")
    expect(platformOf("https://behance.net/lp")).toBe("behance")
    expect(platformOf("https://twitter.com/lp")).toBe("x")
    expect(platformOf("https://m.youtube.com/@lp")).toBe("youtube")
    // A creator's own site, and a lookalike host, are both just websites.
    expect(platformOf("https://laurenproctor.com/")).toBe("website")
    expect(platformOf("https://notinstagram.com/lp")).toBe("website")
    expect(platformOf("https://instagram.com.evil.example/lp")).toBe("website")
  })

  it("derives a label from the address when none was given, and keeps a given one", () => {
    expect(derivedLabel("https://www.instagram.com/lp/")).toBe("Instagram")
    expect(derivedLabel("https://www.laurenproctor.com/shop")).toBe("laurenproctor.com")
    expect(resolveLinks(FIELDS.links)).toEqual([
      { kind: "website", url: "https://laurenproctor.com/", label: "laurenproctor.com" },
      { kind: "instagram", url: "https://www.instagram.com/laurenproctor/", label: "Instagram" },
      { kind: "behance", url: "https://behance.net/laurenproctor", label: "Portfolio" },
    ])
  })

  it("keeps the creator's order and leaves out empty, invalid and repeated rows", () => {
    const links = [
      { url: "b.example.com", label: "" },
      { url: "", label: "" },
      { url: "javascript:alert(1)", label: "Click" },
      { url: "a.example.com", label: "" },
      { url: "https://b.example.com/", label: "Again" },
    ]
    expect(resolveLinks(links).map((link) => link.url)).toEqual([
      "https://b.example.com/",
      "https://a.example.com/",
    ])
  })

  it("publishes a label only when the creator gave one, so a derived label follows its address", () => {
    expect(
      publishableLinks([
        { url: "studio.com", label: "  " },
        { url: "dribbble.com/lp", label: " My shots " },
      ]),
    ).toEqual([
      { url: "https://studio.com/", label: "" },
      { url: "https://dribbble.com/lp", label: "My shots" },
    ])
  })

  it("reports each problem against its own row", () => {
    const issues = checkLinks([
      { url: "studio.com", label: "" },
      { url: "http://studio.com", label: "" },
      { url: "", label: "Shop" },
      { url: "studio.com", label: "x".repeat(41) },
    ])
    expect(issues).toEqual([
      { index: 1, field: "url", message: "Use an https:// address." },
      { index: 2, field: "url", message: "Add the address for this link, or remove it." },
      { index: 3, field: "url", message: "This link is already on your profile." },
      { index: 3, field: "label", message: "Keep the label under 40 characters." },
    ])
  })

  it("holds a profile to eight links", () => {
    const nine = Array.from({ length: MAX_PROFILE_LINKS + 1 }, (_, i) => ({
      url: `site${i}.example.com`,
      label: "",
    }))
    expect(MAX_PROFILE_LINKS).toBe(8)
    expect(checkLinks(nine)).toEqual([
      expect.objectContaining({
        index: 8,
        field: "url",
        message: expect.stringMatching(/up to 8/),
      }),
    ])
    expect(resolveLinks(nine)).toHaveLength(8)
    expect(draftFieldsSchema.safeParse({ ...FIELDS, links: nine }).success).toBe(false)
  })

  it("carries the Instagram and Behance addresses the old fixed fields produced", () => {
    // 20260913030000 turns a typed `@name` into these addresses for drafts, and
    // copies the live columns (already these exact URLs) into public_profile_links.
    expect(parseLinkUrl("https://www.instagram.com/laurenproctor/")).toMatchObject({
      kind: "valid",
      url: "https://www.instagram.com/laurenproctor/",
    })
    expect(parseLinkUrl("https://www.behance.net/laurenproctor")).toMatchObject({
      kind: "valid",
      url: "https://www.behance.net/laurenproctor",
    })
  })
})

describe("the draft model", () => {
  it("stores what was typed, bounded only by length", () => {
    expect(
      draftFieldsSchema.safeParse({ ...FIELDS, links: [{ url: "https://half-typ", label: "" }] })
        .success,
    ).toBe(true)
    expect(
      draftFieldsSchema.safeParse({ ...FIELDS, city: "Brookl", countryCode: "US" }).success,
    ).toBe(true)
    expect(
      draftFieldsSchema.safeParse({ ...FIELDS, shortBio: "x".repeat(DRAFT_LIMITS.shortBio + 1) })
        .success,
    ).toBe(false)
    expect(
      draftFieldsSchema.safeParse({ ...FIELDS, about: "x".repeat(DRAFT_LIMITS.about + 1) }).success,
    ).toBe(false)
  })

  it("refuses a save from a builder tab older than the new fields, rather than blanking them", () => {
    const old = {
      handle: FIELDS.handle,
      displayName: FIELDS.displayName,
      shortBio: FIELDS.shortBio,
      website: "studio.com",
      instagram: "",
      behance: "",
      location: "",
      contact: "",
    }
    expect(draftFieldsSchema.safeParse(old).success).toBe(false)
  })

  it("decides whether step 1 is complete with the same rules the preview uses", () => {
    expect(checkDetailsStep(FIELDS)).toEqual({})
    const errors = checkDetailsStep({
      ...FIELDS,
      handle: "settings",
      displayName: "  ",
      links: [{ url: "http://x.com", label: "" }],
    })
    expect(Object.keys(errors).sort()).toEqual(["displayName", "handle", "links"])
    expect(errors.handle).toMatch(/reserved/i)
    expect(errors.links).toEqual([{ index: 0, field: "url", message: "Use an https:// address." }])
  })

  it("never blocks step 1 on an empty location, About or contact, only on a wrong one", () => {
    expect(checkDetailsStep({ ...FIELDS, city: "", countryCode: "", contact: "" })).toEqual({})
    expect(
      checkDetailsStep({
        ...FIELDS,
        city: "Brooklyn",
        countryCode: "US",
        contact: "hello@studio.com",
      }),
    ).toEqual({})
    // A country alone is a complete location.
    expect(checkDetailsStep({ ...FIELDS, countryCode: "FR" })).toEqual({})
    const errors = checkDetailsStep({
      ...FIELDS,
      countryCode: "ZZ",
      about: "x".repeat(DRAFT_LIMITS.about + 1),
      contact: "hello@",
    })
    expect(Object.keys(errors).sort()).toEqual(["about", "contact", "countryCode"])
  })

  it("never accepts a city without the country it is in", () => {
    expect(checkDetailsStep({ ...FIELDS, city: "Paris", countryCode: "" }).city).toMatch(
      /country first/i,
    )
  })

  it("holds a legacy free-text location to the live column's length while it is still shown", () => {
    const long = "x".repeat(DRAFT_LIMITS.location + 1)
    expect(checkDetailsStep({ ...FIELDS, location: long }).location).toMatch(/80 characters/)
    // Choosing a country retires the old text, so its length no longer matters.
    expect(checkDetailsStep({ ...FIELDS, location: long, countryCode: "US" })).toEqual({})
  })

  it("seeds a never-saved draft from the live profile, links from their own table", () => {
    const draft = seedDraftFromProfile(
      liveRow({
        short_bio: "x".repeat(280),
        about: "A studio.",
        location: "Brooklyn, New York",
        city: "Brooklyn",
        country_code: "US",
        avatar_path: "0f9f2d4e-1c3b-4a5e-9f7d-2b8c6a1e4d30/a.png",
        contact_url: "mailto:hello@northline.com",
        status: "published",
        published_at: "2026-09-12T00:00:00Z",
      }),
      [
        { url: "https://northline.com/", label: null },
        { url: "https://www.instagram.com/northline/", label: "Studio feed" },
      ],
    )
    expect(draft.revision).toBe(0)
    expect(draft.fields.shortBio).toHaveLength(DRAFT_LIMITS.shortBio)
    expect(draft.fields.links).toEqual([
      { url: "https://northline.com/", label: "" },
      { url: "https://www.instagram.com/northline/", label: "Studio feed" },
    ])
    expect(draft.fields).toMatchObject({
      about: "A studio.",
      city: "Brooklyn",
      countryCode: "US",
      // Kept as it was: nothing parses the legacy text.
      location: "Brooklyn, New York",
      contact: "hello@northline.com",
    })
  })

  it("seeds empty optional fields as empty, not as the word null", () => {
    const draft = seedDraftFromProfile(liveRow())
    expect(draft.fields).toMatchObject({
      about: "",
      city: "",
      countryCode: "",
      location: "",
      links: [],
      contact: "",
    })
  })

  it("reads a draft row from before the storefront fields existed as all unset", () => {
    // What the builder sees in the minutes between deploying this code and
    // applying 20260913030000 to the same database.
    const legacyRow = {
      public_profile_id: "p",
      workspace_id: "w",
      handle: "h",
      display_name: "H",
      short_bio: "",
      website: "studio.com",
      instagram: "",
      behance: "",
      avatar_path: null,
      products: [],
      revision: 1,
      updated_by: null,
      created_at: "",
      updated_at: "",
    } as unknown as Parameters<typeof draftFromRow>[0]
    const draft = draftFromRow(legacyRow)
    expect(draft.fields).toMatchObject({ location: "", contact: "", city: "", links: [] })
    expect(checkDetailsStep({ ...draft.fields, displayName: "H", handle: "studio-h" })).toEqual({})
  })

  it("reads a stored draft and ignores a malformed product or link list rather than failing", () => {
    const draft = draftFromRow({
      public_profile_id: "p",
      workspace_id: "w",
      handle: "h",
      display_name: "",
      short_bio: "",
      about: "",
      website: "",
      instagram: "",
      behance: "",
      city: "",
      country_code: "",
      location: "Brooklyn",
      links: { not: "an array" },
      contact: "hello@h.example",
      avatar_path: null,
      products: [{ productId: "not-a-uuid", visible: "yes" }],
      revision: 4,
      updated_by: null,
      created_at: "",
      updated_at: "",
    })
    expect(draft.products).toEqual([])
    expect(draft.fields.links).toEqual([])
    expect(draft.revision).toBe(4)
    expect(draft.fields).toMatchObject({ location: "Brooklyn", contact: "hello@h.example" })
  })
})

describe("the preview mapping", () => {
  it("reflects every field immediately, with icons only for valid links", () => {
    const presentation = presentationFromDraft(
      { ...FIELDS, links: [...FIELDS.links, { url: "not a site", label: "" }] },
      { handle: "lauren-proctor", avatarUrl: "blob:local", products: [] },
    )
    expect(presentation).toMatchObject({
      handle: "lauren-proctor",
      displayName: "Lauren Proctor",
      initials: "LP",
      avatarUrl: "blob:local",
    })
    expect(presentation.links.map((l) => l.kind)).toEqual(["website", "instagram", "behance"])
  })

  it("names only public fields, whichever side it is built from", () => {
    const fromPublic = presentationFromPublicView(
      {
        id: "p",
        handle: "northline",
        displayName: "Northline",
        shortBio: null,
        about: "Type for expressive brands.",
        location: null,
        city: "Brooklyn",
        countryCode: "US",
        hasAvatar: false,
        links: [{ url: "https://northline.com/", label: "" }],
        contactUrl: "mailto:private@northline.com",
        seoTitle: null,
        seoDescription: null,
        updatedAt: "",
      },
      [],
      {
        avatarUrl: "/api/public/avatar/p",
        imageUrl: (id) => `/api/public/asset/${id}`,
        productHref: (slug) => `/@northline/${slug}`,
      },
    )
    expect(Object.keys(fromPublic).sort()).toEqual(
      [
        "about",
        "avatarUrl",
        "contact",
        "displayName",
        "handle",
        "initials",
        "links",
        "location",
        "products",
        "shortBio",
        "specialties",
      ].sort(),
    )
    expect(fromPublic.avatarUrl).toBeNull()
    // Location and the contact address are fields the creator chose to publish,
    // so they arrive. The live row's own mailto: is labelled by its address.
    expect(fromPublic.location).toBe("Brooklyn, United States")
    expect(fromPublic.contact).toEqual({
      url: "mailto:private@northline.com",
      label: "private@northline.com",
    })
  })

  it("shows the legacy location until a country is chosen, and nothing when both are empty", () => {
    const view = (fields: Partial<ProfileDraftFields>) =>
      presentationFromDraft(
        { ...FIELDS, ...fields },
        { handle: "lauren-proctor", avatarUrl: null, products: [] },
      ).location
    expect(view({ location: "Brooklyn, New York" })).toBe("Brooklyn, New York")
    expect(view({ location: "Brooklyn, New York", countryCode: "US", city: "Brooklyn" })).toBe(
      "Brooklyn, United States",
    )
    expect(view({ countryCode: "US" })).toBe("United States")
    expect(view({ location: "   " })).toBeNull()
  })

  it("shows no location and no Contact button when both are empty", () => {
    const presentation = presentationFromDraft(
      { ...FIELDS, location: "   ", contact: "" },
      { handle: "lauren-proctor", avatarUrl: null, products: [] },
    )
    expect(presentation.location).toBeNull()
    expect(presentation.contact).toBeNull()
  })

  it("derives specialties from the products shown, never from anything typed", () => {
    const presentation = presentationFromDraft(FIELDS, {
      handle: "lauren-proctor",
      avatarUrl: null,
      products: [
        { key: "a", title: "A", typeLabel: "Font", imageUrl: null, imageAlt: "" },
        { key: "b", title: "B", typeLabel: "Template", imageUrl: null, imageAlt: "" },
        { key: "c", title: "C", typeLabel: "Font", imageUrl: null, imageAlt: "" },
      ],
    })
    expect(presentation.specialties).toEqual(["Font", "Template"])
  })

  it("shows a Contact button only for a contact publication would accept", () => {
    const valid = presentationFromDraft(
      { ...FIELDS, contact: "hello@laurenproctor.com" },
      { handle: "lauren-proctor", avatarUrl: null, products: [] },
    )
    expect(valid.contact).toEqual({
      url: "mailto:hello@laurenproctor.com",
      label: "hello@laurenproctor.com",
    })

    const invalid = presentationFromDraft(
      { ...FIELDS, contact: "not an address" },
      { handle: "lauren-proctor", avatarUrl: null, products: [] },
    )
    expect(invalid.contact).toBeNull()
  })
})

describe("the contact button's address", () => {
  it("takes an email address, with or without mailto:", () => {
    for (const typed of [
      "hello@studio.com",
      "mailto:hello@studio.com",
      "  Hello.Team+x@studio.co.uk ",
    ]) {
      const parsed = parseContact(typed)
      expect(parsed.kind, typed).toBe("valid")
      if (parsed.kind === "valid") {
        expect(parsed.url).toMatch(/^mailto:/)
        expect(parsed.url, typed).toMatch(CONTACT_URL_CONSTRAINT)
      }
    }
    expect(parseContact("mailto:hello@studio.com")).toEqual({
      kind: "valid",
      url: "mailto:hello@studio.com",
      label: "hello@studio.com",
    })
  })

  it("takes a web page, with the same rules as the Website field", () => {
    const parsed = parseContact("studio.com/contact")
    expect(parsed).toMatchObject({ kind: "valid", url: "https://studio.com/contact" })
    if (parsed.kind === "valid") expect(parsed.url).toMatch(CONTACT_URL_CONSTRAINT)
    expect(parseContact("http://studio.com/contact")).toMatchObject({
      kind: "invalid",
      message: "Use an https:// address.",
    })
  })

  it("treats empty as no button, which is how a creator removes it", () => {
    expect(parseContact("")).toEqual({ kind: "empty" })
    expect(parseContact("   ")).toEqual({ kind: "empty" })
  })

  it("refuses anything that is not plainly an address", () => {
    for (const typed of [
      "hello@",
      "@studio.com",
      "hello@studio",
      "mailto:hello@studio.com?subject=hi&body=buy",
      "mailto:",
      "javascript:alert(1)",
      "hello world",
      "hello@studio.com/path",
    ]) {
      expect(parseContact(typed).kind, typed).toBe("invalid")
    }
  })
})

describe("image previews", () => {
  it("holds one object URL at a time and revokes the rest", () => {
    let n = 0
    const create = vi.fn(() => `blob:${++n}`)
    const revoke = vi.fn()
    const manager = createImagePreviewManager({ create, revoke })

    expect(manager.show(new Blob(["a"]))).toBe("blob:1")
    expect(manager.show(new Blob(["b"]))).toBe("blob:2")
    expect(revoke).toHaveBeenCalledWith("blob:1")

    manager.clear()
    expect(revoke).toHaveBeenCalledWith("blob:2")
    expect(manager.current()).toBeNull()

    manager.show(new Blob(["c"]))
    manager.dispose()
    expect(revoke).toHaveBeenCalledWith("blob:3")
    expect(revoke).toHaveBeenCalledTimes(3)
  })

  it("checks type and the 5 MB limit before anything is shown", () => {
    expect(checkLocalImage({ type: "image/webp", size: 1000 })).toEqual({ ok: true })
    expect(checkLocalImage({ type: "image/gif", size: 1000 }).ok).toBe(false)
    expect(checkLocalImage({ type: "image/png", size: MAX_AVATAR_BYTES + 1 })).toMatchObject({
      ok: false,
      message: expect.stringMatching(/5 MB/),
    })
    expect(MAX_AVATAR_BYTES).toBe(5 * 1024 * 1024)
  })

  it("identifies a re-picked file so it is not uploaded twice", () => {
    const file = { name: "lp.png", size: 10, lastModified: 1 }
    expect(fileIdentity(file)).toBe(fileIdentity({ ...file }))
    expect(fileIdentity(file)).not.toBe(fileIdentity({ ...file, lastModified: 2 }))
  })
})
