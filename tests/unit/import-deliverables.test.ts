import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

/*
  The action, run for real, with everything it reaches outside itself replaced:
  who is signed in, which workspace the slug names, what the import and its
  files are, and the delete it would hand off to. What is under test is the
  decision between those calls, which is the whole of the replacement guarantee.
*/
const state = vi.hoisted(() => ({
  files: [] as Array<{ id: string; asset_state: string }>,
  deleted: [] as string[],
}))

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirected to ${to}`)
  },
}))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("@/lib/jobs", () => ({ jobs: { enqueue: async () => {} } }))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: "workspace-1", slug: "northbound-type" },
            error: null,
          }),
        }),
      }),
    }),
  }),
}))
vi.mock("@/lib/imports/queries", () => ({
  getImport: async () => ({ row: { id: "import-1", product_id: "product-1" } }),
  listDeliverables: async () => state.files,
}))
vi.mock("@/lib/products/actions", () => ({
  deleteAssetAction: async (_slug: string, assetId: string) => {
    state.deleted.push(assetId)
    return { error: null }
  },
}))

import { removeDeliverableAction } from "@/lib/imports/actions"

/**
 * Replacing the only buyer file never leaves a product with none.
 *
 * A browser test used to upload a zip, try to remove it, read the refusal,
 * upload a replacement and then remove the original. Every step of that is the
 * decision this action makes about what it is handed, so it is made here for
 * each state a file can be in. Uploading never deletes anything; only this
 * action does, which is why it is the one place the guarantee has to hold.
 */

const ONLY = "That is the only file buyers would receive. Upload its replacement first."

describe("removing a buyer file from an import", () => {
  beforeEach(() => {
    state.files = []
    state.deleted = []
  })

  it("refuses to remove the only ready file, and deletes nothing", async () => {
    state.files = [{ id: "original", asset_state: "ready" }]

    await expect(
      removeDeliverableAction("northbound-type", "import-1", "original"),
    ).resolves.toEqual({ error: ONLY })
    expect(state.deleted).toEqual([])
  })

  it("still refuses while the replacement has not been measured", async () => {
    // A replacement that is uploading, or failed, is not a file a buyer can
    // receive. The original stays until one is.
    for (const pending of ["pending", "failed"]) {
      state.files = [
        { id: "original", asset_state: "ready" },
        { id: "replacement", asset_state: pending },
      ]
      await expect(
        removeDeliverableAction("northbound-type", "import-1", "original"),
      ).resolves.toEqual({ error: ONLY })
    }
    expect(state.deleted).toEqual([])
  })

  it("removes the original once a replacement is ready", async () => {
    state.files = [
      { id: "original", asset_state: "ready" },
      { id: "replacement", asset_state: "ready" },
    ]

    await expect(
      removeDeliverableAction("northbound-type", "import-1", "original"),
    ).resolves.toEqual({ error: null })
    expect(state.deleted).toEqual(["original"])
  })

  it("lets a file that never became ready go, because nobody would receive it", async () => {
    state.files = [{ id: "broken", asset_state: "failed" }]

    await expect(removeDeliverableAction("northbound-type", "import-1", "broken")).resolves.toEqual(
      {
        error: null,
      },
    )
    expect(state.deleted).toEqual(["broken"])
  })

  it("does not remove a file that is not this import's", async () => {
    state.files = [{ id: "original", asset_state: "ready" }]

    await expect(
      removeDeliverableAction("northbound-type", "import-1", "somebody-elses"),
    ).resolves.toEqual({ error: "That file could not be found." })
    expect(state.deleted).toEqual([])
  })
})

describe("the import screen's routes", () => {
  const ROOT = join(__dirname, "..", "..")
  const read = (...path: string[]) => readFileSync(join(ROOT, ...path), "utf8")

  it("answers an import that is not this workspace's with not found, not forbidden", () => {
    // Indistinguishable from an id that was never real, which is what stops a
    // probe confirming one. The row is unreadable across workspaces by RLS
    // (tests/db/product-import.test.ts); this is what the page does with that.
    const page = read("app", "[slug]", "new", "link", "[importId]", "page.tsx")

    expect(page).toContain('if (!(await getCurrentUser())) redirect("/sign-in")')
    expect(page).toMatch(/const record = await getImport\([^)]*\)\s*if \(!record\) notFound\(\)/)
  })

  it("checks for a session itself on the importer, not only in the proxy", () => {
    const page = read("app", "[slug]", "new", "link", "page.tsx")
    expect(page).toContain('redirect("/sign-in")')
  })
})
