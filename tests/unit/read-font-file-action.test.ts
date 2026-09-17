import { beforeEach, describe, expect, it, vi } from "vitest"

/*
  The action the files section calls for every "Not read yet" row, with the
  caller, the workspace and the row it can see replaced. What is under test is
  when a job is queued: only for a ready font with no reading, and never for
  a row the caller's workspace cannot see.
*/
const state = vi.hoisted(() => ({
  asset: null as Record<string, unknown> | null,
  enqueued: [] as Array<{ name: string; payload: unknown }>,
}))

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirected to ${to}`)
  },
}))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("@/lib/jobs", () => ({
  jobs: {
    enqueue: async (name: string, payload: unknown) => {
      state.enqueued.push({ name, payload })
      return { id: "run", name, payload, enqueuedAt: new Date() }
    },
  },
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: state.asset, error: null }),
          }),
          maybeSingle: async () =>
            table === "workspaces"
              ? { data: { id: "workspace-1", slug: "northbound-type" }, error: null }
              : { data: state.asset, error: null },
        }),
      }),
    }),
  }),
}))

import { readFontFileAction } from "@/lib/fonts/actions"

beforeEach(() => {
  state.asset = null
  state.enqueued = []
})

describe("asking for a font file's reading", () => {
  it("queues the finalize job for a ready font with no reading", async () => {
    state.asset = { id: "asset-1", asset_state: "ready", mime_type: "font/otf", metadata: {} }

    const result = await readFontFileAction("northbound-type", "asset-1")

    expect(result).toEqual({ error: null })
    expect(state.enqueued).toEqual([
      { name: "finalize_asset", payload: { workspaceId: "workspace-1", assetId: "asset-1" } },
    ])
  })

  it("queues nothing for a font that was read", async () => {
    state.asset = {
      id: "asset-1",
      asset_state: "ready",
      mime_type: "font/otf",
      metadata: { fontProblem: "collection" },
    }

    expect(await readFontFileAction("northbound-type", "asset-1")).toEqual({ error: null })
    expect(state.enqueued).toEqual([])
  })

  it("queues nothing for a row that is not ready, or neither a font nor a package", async () => {
    state.asset = { id: "asset-1", asset_state: "pending", mime_type: null, metadata: {} }
    await readFontFileAction("northbound-type", "asset-1")
    state.asset = {
      id: "asset-1",
      asset_state: "ready",
      mime_type: "application/pdf",
      metadata: {},
    }
    await readFontFileAction("northbound-type", "asset-1")

    expect(state.enqueued).toEqual([])
  })

  it("queues a look inside a ready package nobody has looked inside, once", async () => {
    state.asset = {
      id: "asset-1",
      asset_state: "ready",
      mime_type: "application/zip",
      metadata: {},
    }
    await readFontFileAction("northbound-type", "asset-1")
    expect(state.enqueued).toHaveLength(1)

    state.asset = {
      id: "asset-1",
      asset_state: "ready",
      mime_type: "application/zip",
      metadata: { archiveProblem: "unsupported" },
    }
    await readFontFileAction("northbound-type", "asset-1")
    expect(state.enqueued).toHaveLength(1)
  })

  it("says so when the workspace cannot see the file", async () => {
    state.asset = null

    const result = await readFontFileAction("northbound-type", "asset-1")

    expect(result.error).toBe("That file could not be found.")
    expect(state.enqueued).toEqual([])
  })
})
