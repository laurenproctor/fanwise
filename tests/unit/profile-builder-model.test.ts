import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { RESERVED_HANDLES, classifyHandle, normalizeHandleInput } from "@/lib/public/handles"
import {
  LINK_PARSERS,
  parseBehance,
  parseContact,
  parseInstagram,
  parseWebsite,
  resolvedLinks,
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
  website: "laurenproctor.com",
  instagram: "@laurenproctor",
  behance: "behance.net/laurenproctor",
  location: "",
  contact: "",
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
  it("accepts the forms people write and produces one canonical https URL", () => {
    expect(parseWebsite("laurenproctor.com")).toEqual({
      kind: "valid",
      url: "https://laurenproctor.com/",
      label: "laurenproctor.com",
    })
    expect(parseWebsite("https://www.studio.co.uk/work")).toMatchObject({
      kind: "valid",
      label: "studio.co.uk",
    })
    expect(parseInstagram("@laurenproctor")).toMatchObject({
      kind: "valid",
      url: "https://www.instagram.com/laurenproctor/",
    })
    expect(parseInstagram("https://instagram.com/laurenproctor/")).toMatchObject({ kind: "valid" })
    expect(parseBehance("behance.net/laurenproctor")).toMatchObject({
      kind: "valid",
      url: "https://www.behance.net/laurenproctor",
    })
    expect(parseBehance("laurenproctor")).toMatchObject({ kind: "valid" })
  })

  it("treats a blank field as absent, not invalid", () => {
    for (const parse of Object.values(LINK_PARSERS)) expect(parse("   ")).toEqual({ kind: "empty" })
  })

  it.each([
    ["http://studio.com"],
    ["javascript:alert(1)"],
    ["data:text/html,hi"],
    ["not a site"],
    ["localhost"],
    ["127.0.0.1"],
    ["https://studio.com:8443"],
  ])("refuses %s as a website", (value) => {
    expect(parseWebsite(value).kind).toBe("invalid")
  })

  it("refuses another site's URL in the Instagram and Behance fields", () => {
    expect(parseInstagram("twitter.com/laurenproctor").kind).toBe("invalid")
    expect(parseInstagram("http://instagram.com/laurenproctor").kind).toBe("invalid")
    expect(parseBehance("dribbble.com/laurenproctor").kind).toBe("invalid")
    expect(parseInstagram("lauren proctor").kind).toBe("invalid")
  })

  it("resolves only valid links, in a fixed order", () => {
    expect(
      resolvedLinks({ website: "nope nope", instagram: "@lp", behance: "" }).map((l) => l.kind),
    ).toEqual(["instagram"])
    expect(
      resolvedLinks({ behance: "lp", website: "lp.com", instagram: "@lp" }).map((l) => l.kind),
    ).toEqual(["website", "instagram", "behance"])
  })

  it("has no email or mailto link kind at all", () => {
    expect(Object.keys(LINK_PARSERS).sort()).toEqual(["behance", "instagram", "website"])
    expect(parseWebsite("mailto:hello@studio.com").kind).toBe("invalid")
  })
})

describe("the draft model", () => {
  it("stores what was typed, bounded only by length", () => {
    expect(draftFieldsSchema.safeParse({ ...FIELDS, website: "https://half-typ" }).success).toBe(
      true,
    )
    expect(
      draftFieldsSchema.safeParse({ ...FIELDS, shortBio: "x".repeat(DRAFT_LIMITS.shortBio + 1) })
        .success,
    ).toBe(false)
  })

  it("decides whether step 1 is complete with the same rules the preview uses", () => {
    expect(checkDetailsStep(FIELDS)).toEqual({})
    const errors = checkDetailsStep({
      ...FIELDS,
      handle: "settings",
      displayName: "  ",
      website: "http://x.com",
      instagram: "twitter.com/x",
    })
    expect(Object.keys(errors).sort()).toEqual(["displayName", "handle", "instagram", "website"])
    expect(errors.handle).toMatch(/reserved/i)
  })

  it("never blocks step 1 on an empty location or contact, only on a wrong one", () => {
    expect(checkDetailsStep({ ...FIELDS, location: "", contact: "" })).toEqual({})
    expect(
      checkDetailsStep({ ...FIELDS, location: "Brooklyn", contact: "hello@studio.com" }),
    ).toEqual({})
    const errors = checkDetailsStep({
      ...FIELDS,
      location: "x".repeat(DRAFT_LIMITS.location + 1),
      contact: "hello@",
    })
    expect(Object.keys(errors).sort()).toEqual(["contact", "location"])
  })

  it("seeds a never-saved draft from the live profile", () => {
    const draft = seedDraftFromProfile({
      id: "0f9f2d4e-1c3b-4a5e-9f7d-2b8c6a1e4d30",
      workspace_id: "w",
      handle: "northline",
      display_name: "Northline",
      short_bio: "x".repeat(280),
      location: "Brooklyn",
      avatar_path: "0f9f2d4e-1c3b-4a5e-9f7d-2b8c6a1e4d30/a.png",
      website_url: "https://northline.com",
      instagram_url: null,
      behance_url: null,
      contact_url: "mailto:hello@northline.com",
      status: "published",
      seo_title: null,
      seo_description: null,
      published_at: "2026-09-12T00:00:00Z",
      created_at: "",
      updated_at: "",
    })
    expect(draft.revision).toBe(0)
    expect(draft.fields.shortBio).toHaveLength(DRAFT_LIMITS.shortBio)
    expect(draft.fields.website).toBe("https://northline.com")
    // Both optional fields carry over, so a creator who set them before the
    // builder existed does not lose them on first publish. The field takes a
    // bare address, so the scheme is dropped on the way in.
    expect(draft.fields.location).toBe("Brooklyn")
    expect(draft.fields.contact).toBe("hello@northline.com")
  })

  it("seeds empty optional fields as empty, not as the word null", () => {
    const draft = seedDraftFromProfile({
      id: "0f9f2d4e-1c3b-4a5e-9f7d-2b8c6a1e4d30",
      workspace_id: "w",
      handle: "northline",
      display_name: "Northline",
      short_bio: null,
      location: null,
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
    })
    expect(draft.fields.location).toBe("")
    expect(draft.fields.contact).toBe("")
  })

  it("reads a draft row from before location and contact existed as both unset", () => {
    // What the builder sees in the minutes between deploying this code and
    // applying 20260913020000 to the same database.
    const legacyRow = {
      public_profile_id: "p",
      workspace_id: "w",
      handle: "h",
      display_name: "H",
      short_bio: "",
      website: "",
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
    expect(draft.fields.location).toBe("")
    expect(draft.fields.contact).toBe("")
    expect(checkDetailsStep({ ...draft.fields, displayName: "H", handle: "studio-h" })).toEqual({})
  })

  it("reads a stored draft and ignores a malformed product list rather than failing", () => {
    const draft = draftFromRow({
      public_profile_id: "p",
      workspace_id: "w",
      handle: "h",
      display_name: "",
      short_bio: "",
      website: "",
      instagram: "",
      behance: "",
      location: "Brooklyn",
      contact: "hello@h.example",
      avatar_path: null,
      products: [{ productId: "not-a-uuid", visible: "yes" }],
      revision: 4,
      updated_by: null,
      created_at: "",
      updated_at: "",
    })
    expect(draft.products).toEqual([])
    expect(draft.revision).toBe(4)
    expect(draft.fields).toMatchObject({ location: "Brooklyn", contact: "hello@h.example" })
  })
})

describe("the preview mapping", () => {
  it("reflects every field immediately, with icons only for valid links", () => {
    const presentation = presentationFromDraft(
      { ...FIELDS, behance: "dribbble.com/x" },
      { handle: "lauren-proctor", avatarUrl: "blob:local", products: [] },
    )
    expect(presentation).toMatchObject({
      handle: "lauren-proctor",
      displayName: "Lauren Proctor",
      initials: "LP",
      avatarUrl: "blob:local",
    })
    expect(presentation.links.map((l) => l.kind)).toEqual(["website", "instagram"])
  })

  it("names only public fields, whichever side it is built from", () => {
    const fromPublic = presentationFromPublicView(
      {
        id: "p",
        handle: "northline",
        displayName: "Northline",
        shortBio: null,
        location: "Brooklyn",
        hasAvatar: false,
        websiteUrl: "https://northline.com",
        instagramUrl: null,
        behanceUrl: null,
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
        "avatarUrl",
        "contact",
        "displayName",
        "handle",
        "initials",
        "links",
        "location",
        "products",
        "shortBio",
      ].sort(),
    )
    expect(fromPublic.avatarUrl).toBeNull()
    // Location and the contact address are fields the creator chose to publish,
    // so they arrive. The live row's own mailto: is labelled by its address.
    expect(fromPublic.location).toBe("Brooklyn")
    expect(fromPublic.contact).toEqual({
      url: "mailto:private@northline.com",
      label: "private@northline.com",
    })
  })

  it("shows no location and no Contact button when both are empty", () => {
    const presentation = presentationFromDraft(
      { ...FIELDS, location: "   ", contact: "" },
      { handle: "lauren-proctor", avatarUrl: null, products: [] },
    )
    expect(presentation.location).toBeNull()
    expect(presentation.contact).toBeNull()
  })

  it("shows a Contact button only for a contact publication would accept", () => {
    const valid = presentationFromDraft(
      { ...FIELDS, contact: "hello@laurenproctor.com", location: " Brooklyn " },
      { handle: "lauren-proctor", avatarUrl: null, products: [] },
    )
    expect(valid.contact).toEqual({
      url: "mailto:hello@laurenproctor.com",
      label: "hello@laurenproctor.com",
    })
    expect(valid.location).toBe("Brooklyn")

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
