import { describe, expect, it } from "vitest"
import type { User } from "@supabase/supabase-js"
import { accountProfile, nameMetadata } from "@/lib/account/profile"
import { personalWorkspaceName } from "@/lib/workspaces/provision"

/**
 * The person, read out of an auth user.
 *
 * user_metadata is writable by the account itself, so everything read from it
 * is parsed rather than trusted. These are the shapes that reach it when
 * somebody tries.
 */

function user(overrides: Partial<User> = {}): User {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-09-01T00:00:00Z",
    email: "creator@example.com",
    ...overrides,
  } as User
}

describe("accountProfile", () => {
  it("reads the names out of metadata and the address off the account", () => {
    const profile = accountProfile(
      user({ user_metadata: { first_name: "Lauren", last_name: "Proctor" } }),
    )
    expect(profile).toMatchObject({
      firstName: "Lauren",
      lastName: "Proctor",
      email: "creator@example.com",
      pendingEmail: null,
    })
  })

  it("is empty rather than wrong when metadata holds something that is not a name", () => {
    const profile = accountProfile(
      user({ user_metadata: { first_name: { nested: true }, last_name: 42 } }),
    )
    expect(profile.firstName).toBe("")
    expect(profile.lastName).toBe("")
  })

  it("drops a name longer than the field would ever accept", () => {
    const profile = accountProfile(user({ user_metadata: { first_name: "a".repeat(300) } }))
    expect(profile.firstName).toBe("")
  })

  it("surfaces an address change the provider is still holding", () => {
    const profile = accountProfile(user({ new_email: "moved@example.com" }))
    expect(profile.pendingEmail).toBe("moved@example.com")
    // The account still signs in with the old one, and the page must say so.
    expect(profile.email).toBe("creator@example.com")
  })

  it("has no pending address when the provider holds none", () => {
    expect(accountProfile(user()).pendingEmail).toBe(null)
    expect(accountProfile(user({ new_email: "" })).pendingEmail).toBe(null)
  })

  it("survives an account with no address at all", () => {
    expect(accountProfile(user({ email: undefined })).email).toBe("")
  })
})

describe("nameMetadata", () => {
  it("writes the two parts and the whole", () => {
    expect(nameMetadata("Lauren", "Proctor")).toEqual({
      first_name: "Lauren",
      last_name: "Proctor",
      full_name: "Lauren Proctor",
    })
  })

  it("leaves no stray space when half the name is missing", () => {
    expect(nameMetadata("Lauren", "").full_name).toBe("Lauren")
    expect(nameMetadata("", "").full_name).toBe("")
  })

  /**
   * The reason full_name is written at all: provision.ts reads it to name a
   * workspace. If these two ever stop agreeing, a creator who filled in their
   * name still gets "My studio".
   */
  it("writes a full_name that workspace provisioning can actually read", () => {
    const metadata = nameMetadata("Lauren", "Proctor")
    expect(personalWorkspaceName(metadata)).toBe("Lauren’s studio")
  })
})
