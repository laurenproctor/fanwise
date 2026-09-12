import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The builder's server actions against a recording Supabase client.
 *
 * Three properties, each asserted on the calls actually made:
 *
 *   1. Editing never publishes. No action here writes `public_profiles`, calls
 *      `release_public_handle`, or sets a status.
 *   2. The workspace boundary is the caller's own client. When RLS hides the
 *      workspace, the action stops before writing anything.
 *   3. Autosave is optimistic: a save that matches no revision is a conflict.
 *
 * Row-level isolation itself is proven against a real database in
 * tests/db/profile-drafts-tenancy.test.ts; this file proves the actions lean on
 * it rather than around it.
 */

type Row = Record<string, unknown>
type Result = { data: unknown; error: { code?: string; message: string } | null }
interface Call {
  table: string
  op: "select" | "insert" | "upsert" | "update" | "delete"
  payload?: unknown
  filters: Array<[string, unknown]>
  client: "user" | "admin"
}

const calls: Call[] = []
const rpcs: string[] = []
let resolver: (call: Call) => Result = () => ({ data: null, error: null })
let user: { id: string } | null = { id: "user-1" }

interface Builder extends PromiseLike<Result> {
  select: (...args: unknown[]) => Builder
  insert: (payload: unknown) => Builder
  upsert: (payload: unknown, options?: unknown) => Builder
  update: (payload: unknown) => Builder
  delete: () => Builder
  eq: (column: string, value: unknown) => Builder
  neq: (column: string, value: unknown) => Builder
  limit: (n: number) => Builder
  maybeSingle: () => Promise<Result>
  single: () => Promise<Result>
}

function makeClient(kind: "user" | "admin") {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    rpc: async (name: string) => {
      rpcs.push(name)
      return { data: null, error: null }
    },
    from(table: string): Builder {
      const call: Call = { table, op: "select", filters: [], client: kind }
      let recorded = false
      const run = () => {
        if (!recorded) {
          calls.push(call)
          recorded = true
        }
        return resolver(call)
      }
      const builder: Builder = {
        select: () => builder,
        insert: (payload) => ((call.op = "insert"), (call.payload = payload), builder),
        upsert: (payload) => ((call.op = "upsert"), (call.payload = payload), builder),
        update: (payload) => ((call.op = "update"), (call.payload = payload), builder),
        delete: () => ((call.op = "delete"), builder),
        eq: (column, value) => (call.filters.push([column, value]), builder),
        neq: (column, value) => (call.filters.push([`!${column}`, value]), builder),
        limit: () => builder,
        maybeSingle: async () => {
          const result = run()
          return {
            ...result,
            data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data,
          }
        },
        single: async () => builder.maybeSingle(),
        then: (onFulfilled, onRejected) => Promise.resolve(run()).then(onFulfilled, onRejected),
      }
      return builder
    },
  }
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => makeClient("user") }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => makeClient("admin") }))
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`)
  },
}))
const uploadAvatar = vi.fn(async () => {})
const removeAvatars = vi.fn(async () => {})
vi.mock("@/lib/public/avatars", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/public/avatars")>()),
  uploadAvatar: (...args: unknown[]) => uploadAvatar(...(args as [])),
  removeAvatars: (...args: unknown[]) => removeAvatars(...(args as [])),
}))

const { saveProfileDraftAction, continueProfileDetailsAction, uploadProfileDraftAvatarAction } =
  await import("@/lib/public/draft-actions")

const PROFILE_ID = "0f9f2d4e-1c3b-4a5e-9f7d-2b8c6a1e4d30"
const LIVE_AVATAR = `${PROFILE_ID}/live.png`

const PROFILE: Row = {
  id: PROFILE_ID,
  workspace_id: "ws-1",
  handle: "lauren-proctor",
  display_name: "Lauren Proctor",
  short_bio: null,
  avatar_path: LIVE_AVATAR,
  website_url: null,
  instagram_url: null,
  behance_url: null,
  status: "published",
}

const FIELDS = {
  handle: "lauren-proctor",
  displayName: "Lauren Proctor",
  shortBio: "Design tools.",
  website: "laurenproctor.com",
  instagram: "@laurenproctor",
  behance: "",
}

interface World {
  workspaceVisible: boolean
  draftRevision: number
  draftAvatar: string | null
  takenHandles: string[]
}

function world(overrides: Partial<World> = {}): World {
  const w: World = {
    workspaceVisible: true,
    draftRevision: 0,
    draftAvatar: LIVE_AVATAR,
    takenHandles: [],
    ...overrides,
  }
  resolver = (call) => {
    const filter = (column: string) => call.filters.find(([c]) => c === column)?.[1]
    switch (call.table) {
      case "workspaces":
        return { data: w.workspaceVisible ? { id: "ws-1" } : null, error: null }
      case "public_profiles":
        if (call.client === "admin") {
          return {
            data: w.takenHandles.includes(String(filter("handle"))) ? [{ id: "other" }] : [],
            error: null,
          }
        }
        return { data: PROFILE, error: null }
      case "public_handle_history":
        return { data: [], error: null }
      case "public_profile_drafts":
        if (call.op === "update") {
          const payload = call.payload as Row
          if ("revision" in payload) {
            if (filter("revision") !== w.draftRevision) return { data: [], error: null }
            w.draftRevision = payload.revision as number
            return { data: [{ revision: w.draftRevision }], error: null }
          }
          w.draftAvatar = payload.avatar_path as string | null
          return { data: null, error: null }
        }
        if (call.op === "select") return { data: { avatar_path: w.draftAvatar }, error: null }
        return { data: null, error: null }
      default:
        return { data: null, error: null }
    }
  }
  return w
}

function publicationWrites() {
  return calls.filter(
    (c) =>
      (c.table === "public_profiles" && c.op !== "select") ||
      (c.table === "public_product_pages" && c.op !== "select") ||
      JSON.stringify(c.payload ?? {}).includes('"status"'),
  )
}

beforeEach(() => {
  calls.length = 0
  rpcs.length = 0
  user = { id: "user-1" }
  uploadAvatar.mockClear()
  removeAvatars.mockClear()
})

describe("autosave", () => {
  it("writes the draft table and nothing that publishes", async () => {
    world()
    const result = await saveProfileDraftAction("laurens-studio", { fields: FIELDS, revision: 0 })
    expect(result).toEqual({ ok: true, revision: 1 })

    const draftWrites = calls.filter(
      (c) => c.table === "public_profile_drafts" && c.op !== "select",
    )
    expect(draftWrites.map((c) => c.op)).toEqual(["upsert", "update"])
    expect(draftWrites[1]!.filters).toContainEqual(["revision", 0])
    expect(publicationWrites()).toEqual([])
    expect(rpcs).toEqual([])
  })

  it("reports a stale revision as a conflict instead of overwriting", async () => {
    world({ draftRevision: 5 })
    await expect(
      saveProfileDraftAction("laurens-studio", { fields: FIELDS, revision: 4 }),
    ).resolves.toEqual({
      ok: false,
      reason: "conflict",
    })
  })

  it("stops before writing when the workspace is not the caller's", async () => {
    world({ workspaceVisible: false })
    const result = await saveProfileDraftAction("someone-elses-studio", {
      fields: FIELDS,
      revision: 0,
    })
    expect(result).toEqual({ ok: false, reason: "failed" })
    expect(calls.filter((c) => c.op !== "select")).toEqual([])
  })

  it("stops before reading anything when nobody is signed in", async () => {
    world()
    user = null
    await expect(
      saveProfileDraftAction("laurens-studio", { fields: FIELDS, revision: 0 }),
    ).resolves.toEqual({
      ok: false,
      reason: "failed",
    })
    expect(calls).toEqual([])
  })

  it("refuses input over the stored bounds without touching the database", async () => {
    world()
    const result = await saveProfileDraftAction("laurens-studio", {
      fields: { ...FIELDS, shortBio: "x".repeat(161) },
      revision: 0,
    })
    expect(result).toEqual({ ok: false, reason: "failed" })
    expect(calls).toEqual([])
  })
})

describe("continue from step 1", () => {
  it("saves, validates and moves to step 2 without publishing", async () => {
    world()
    const result = await continueProfileDetailsAction("laurens-studio", {
      fields: FIELDS,
      revision: 0,
    })
    expect(result).toEqual({
      ok: true,
      revision: 1,
      next: "/laurens-studio/settings/public-profile/builder/products",
    })
    expect(publicationWrites()).toEqual([])
    expect(rpcs).toEqual([])
  })

  it("refuses an address another profile holds, checked server-side", async () => {
    world({ takenHandles: ["northline"] })
    const result = await continueProfileDetailsAction("laurens-studio", {
      fields: { ...FIELDS, handle: "northline" },
      revision: 0,
    })
    expect(result).toMatchObject({
      ok: false,
      revision: 1,
      errors: { handle: expect.stringMatching(/taken/) },
    })
    // The lookup that can see other workspaces is read-only.
    expect(calls.filter((c) => c.client === "admin").every((c) => c.op === "select")).toBe(true)
    expect(publicationWrites()).toEqual([])
  })

  it("refuses a reserved address even if the browser was bypassed", async () => {
    world()
    const result = await continueProfileDetailsAction("laurens-studio", {
      fields: { ...FIELDS, handle: "settings" },
      revision: 0,
    })
    expect(result).toMatchObject({
      ok: false,
      errors: { handle: expect.stringMatching(/reserved/i) },
    })
  })
})

describe("draft image", () => {
  const png = () =>
    new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])],
      "lp.png",
      {
        type: "image/png",
      },
    )

  it("uploads to a profile-scoped draft path and never deletes the live image", async () => {
    world({ draftAvatar: LIVE_AVATAR })
    const body = new FormData()
    body.set("image", png())
    await expect(uploadProfileDraftAvatarAction("laurens-studio", body)).resolves.toEqual({
      ok: true,
    })

    expect(uploadAvatar).toHaveBeenCalledTimes(1)
    const [path] = uploadAvatar.mock.calls[0] as unknown as [string]
    expect(path.startsWith(`${PROFILE_ID}/draft-`)).toBe(true)
    expect(removeAvatars).not.toHaveBeenCalled()
    expect(publicationWrites()).toEqual([])
  })

  it("removes a replaced draft-only image", async () => {
    world({ draftAvatar: `${PROFILE_ID}/draft-old.png` })
    const body = new FormData()
    body.set("image", png())
    await uploadProfileDraftAvatarAction("laurens-studio", body)
    expect(removeAvatars).toHaveBeenCalledWith([`${PROFILE_ID}/draft-old.png`])
  })

  it("refuses a file whose bytes are not an image, whatever it claims", async () => {
    world()
    const body = new FormData()
    body.set("image", new File(["<svg/>"], "x.png", { type: "image/png" }))
    const result = await uploadProfileDraftAvatarAction("laurens-studio", body)
    expect(result.ok).toBe(false)
    expect(uploadAvatar).not.toHaveBeenCalled()
  })
})

describe("the builder has no path to publication", () => {
  const read = (...parts: string[]) => readFileSync(join(__dirname, "..", "..", ...parts), "utf8")

  it.each([
    ["lib", "public", "draft-actions.ts"],
    ["lib", "public", "draft-store.ts"],
    ["app", "[slug]", "settings", "public-profile", "builder", "profile-details-step.tsx"],
  ])("%s never names a publishing operation", (...parts) => {
    // Comments stripped: the docblocks say these operations are absent, by name.
    const source = read(...parts)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
    expect(source).not.toMatch(
      /release_public_handle|setProfilePublishedAction|status:\s*"published"/,
    )
    expect(source).not.toMatch(/from\("public_profiles"\)\s*\.(update|insert|upsert|delete)/)
    expect(source).not.toMatch(/@\/lib\/public\/actions"/)
  })
})
