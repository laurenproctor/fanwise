import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  FALLBACK_WORKSPACE_NAME,
  personalWorkspaceName,
  personalWorkspaceSlug,
  provisionPersonalWorkspace,
} from "@/lib/workspaces/provision"
import type { Workspace } from "@/lib/workspaces/queries"
import { workspaceNameSchema, workspaceSlugSchema } from "@/lib/workspaces/schemas"
import { RESERVED_WORKSPACE_SLUGS, slugify } from "@/lib/slug"

/**
 * The application half of first-run provisioning: naming, and absorbing a slug
 * collision. The half that makes it idempotent is the database function, and
 * tests/db/workspace-provisioning.test.ts proves that against real Postgres,
 * concurrency included.
 */

describe("personalWorkspaceName", () => {
  it("names the workspace for the person when a provider supplied their name", () => {
    expect(personalWorkspaceName({ full_name: "Lauren Proctor" })).toBe("Lauren’s studio")
    expect(personalWorkspaceName({ name: "  Ada   Lovelace " })).toBe("Ada’s studio")
  })

  it("prefers full_name, and moves on when it is unusable", () => {
    expect(personalWorkspaceName({ full_name: "Grace Hopper", name: "Ada" })).toBe("Grace’s studio")
    expect(personalWorkspaceName({ full_name: 7, name: "Ada" })).toBe("Ada’s studio")
  })

  it("keeps the characters real first names carry", () => {
    expect(personalWorkspaceName({ full_name: "Jean-Luc Picard" })).toBe("Jean-Luc’s studio")
    expect(personalWorkspaceName({ full_name: "Zoë Kravitz" })).toBe("Zoë’s studio")
  })

  it("falls back to My studio when there is no usable name", () => {
    for (const metadata of [
      undefined,
      null,
      "Lauren",
      [],
      {},
      { full_name: "" },
      { full_name: "   " },
      { full_name: 42 },
      { name: { first: "Lauren" } },
      { full_name: "lauren@example.com" },
      { full_name: "<b>Lauren</b>" },
      { full_name: "a".repeat(41) },
    ]) {
      expect(personalWorkspaceName(metadata), JSON.stringify(metadata)).toBe(
        FALLBACK_WORKSPACE_NAME,
      )
    }
  })

  it("always produces a name the column accepts", () => {
    for (const metadata of [{}, { full_name: "a".repeat(40) }, { full_name: "Lauren Proctor" }]) {
      expect(workspaceNameSchema.safeParse(personalWorkspaceName(metadata)).success).toBe(true)
    }
  })
})

describe("personalWorkspaceSlug", () => {
  it("is the slugified name with a suffix", () => {
    expect(personalWorkspaceSlug("My studio", "ab12")).toBe("my-studio-ab12")
    expect(personalWorkspaceSlug("Lauren’s studio", "ab12")).toBe("lauren-s-studio-ab12")
  })

  it("never returns the unsuffixed slug, so it says nothing about who holds that one", () => {
    for (const name of ["My studio", "Lauren’s studio", "Zoë’s studio"]) {
      expect(personalWorkspaceSlug(name, "ab12")).not.toBe(slugify(name))
    }
  })

  it("is always a valid, reachable workspace slug", () => {
    for (const name of ["My studio", "Lauren’s studio", "Ωμέγα’s studio", "a".repeat(40)]) {
      const slug = personalWorkspaceSlug(name, "zz99")
      expect(workspaceSlugSchema.safeParse(slug).success, slug).toBe(true)
      expect(RESERVED_WORKSPACE_SLUGS.has(slug)).toBe(false)
    }
  })
})

describe("provisionPersonalWorkspace", () => {
  type RpcArgs = { p_name: string; p_slug: string }
  type RpcResult = { data: Workspace | null; error: { code: string; message: string } | null }
  type Client = Parameters<typeof provisionPersonalWorkspace>[0]

  const WORKSPACE: Workspace = {
    id: "00000000-0000-0000-0000-000000000001",
    name: FALLBACK_WORKSPACE_NAME,
    slug: "my-studio-aaaa",
    owner_user_id: "00000000-0000-0000-0000-000000000002",
    icon_path: null,
    created_at: "2026-09-11T00:00:00Z",
    updated_at: "2026-09-11T00:00:00Z",
  }
  const ok: RpcResult = { data: WORKSPACE, error: null }
  const collision: RpcResult = { data: null, error: { code: "23505", message: "duplicate" } }

  function fakeClient(results: RpcResult[]) {
    const calls: Array<{ fn: string; args: RpcArgs }> = []
    const rpc = async (fn: string, args: RpcArgs): Promise<RpcResult> => {
      calls.push({ fn, args })
      return results.shift() ?? { data: null, error: { code: "XX000", message: "unexpected" } }
    }
    return { client: { rpc } as unknown as Client, calls }
  }

  function suffixes(...values: string[]) {
    return () => values.shift() ?? "zzzz"
  }

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("provisions through the idempotent database function in one call", async () => {
    const { client, calls } = fakeClient([ok])

    const result = await provisionPersonalWorkspace(client, { user_metadata: {} }, suffixes("aaaa"))

    expect(result).toEqual({ ok: true, workspace: WORKSPACE })
    expect(calls).toEqual([
      {
        fn: "provision_personal_workspace",
        args: { p_name: "My studio", p_slug: "my-studio-aaaa" },
      },
    ])
  })

  it("names the workspace from the account's metadata", async () => {
    const { client, calls } = fakeClient([ok])

    await provisionPersonalWorkspace(
      client,
      { user_metadata: { full_name: "Lauren Proctor" } },
      suffixes("aaaa"),
    )

    expect(calls[0]?.args).toEqual({ p_name: "Lauren’s studio", p_slug: "lauren-s-studio-aaaa" })
  })

  it("absorbs a slug collision by asking again with a new suffix", async () => {
    const { client, calls } = fakeClient([collision, ok])

    const result = await provisionPersonalWorkspace(
      client,
      { user_metadata: {} },
      suffixes("aaaa", "bbbb"),
    )

    expect(result.ok).toBe(true)
    expect(calls.map((c) => c.args.p_slug)).toEqual(["my-studio-aaaa", "my-studio-bbbb"])
  })

  it("stops at the first error that is not a collision, and does not retry it", async () => {
    const { client, calls } = fakeClient([
      { data: null, error: { code: "42501", message: "authentication required" } },
      ok,
    ])

    const result = await provisionPersonalWorkspace(client, { user_metadata: {} })

    expect(result).toEqual({ ok: false })
    expect(calls).toHaveLength(1)
    expect(console.error).toHaveBeenCalledOnce()
  })

  it("gives up after five collisions rather than looping", async () => {
    const { client, calls } = fakeClient(Array.from({ length: 10 }, () => collision))

    const result = await provisionPersonalWorkspace(client, { user_metadata: {} })

    expect(result).toEqual({ ok: false })
    expect(calls).toHaveLength(5)
  })
})
