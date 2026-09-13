import { beforeEach, describe, expect, it, vi } from "vitest"

/*
  The action, run for real, with everything outside it replaced: who is signed
  in, which workspace the slug names, the asset the caller can see, the locked
  database function, the old cascade, and storage. Whether the database refuses
  the last ready buyer file — under concurrency too — is proven against real
  Postgres in tests/db/import-deliverable-removal.test.ts. What is under test
  here is which path each kind of file takes, and what the creator is told.
*/
const state = vi.hoisted(() => ({
  asset: null as { id: string; product_id: string; asset_type: string } | null,
  rpc: [] as Array<{ name: string; args: unknown }>,
  answer: { data: null as string[] | null, error: null as { message: string } | null },
  cascaded: [] as string[],
  removed: [] as string[][],
  storageFails: false,
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
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            table === "workspaces"
              ? { data: { id: "workspace-1", slug: "northbound-type" }, error: null }
              : { data: state.asset, error: null },
        }),
      }),
    }),
    rpc: async (name: string, args: unknown) => {
      state.rpc.push({ name, args })
      return state.answer
    },
  }),
}))
vi.mock("@/lib/products/assets", () => ({
  deleteAssetCascade: async (_workspaceId: string, assetId: string) => {
    state.cascaded.push(assetId)
  },
}))
vi.mock("@/lib/products/storage", () => ({
  createUploadUrl: async () => ({}),
  buildStoragePath: () => "",
  sanitizeFilename: (name: string) => name,
  removeObjects: async (paths: string[]) => {
    if (state.storageFails) throw new Error("storage is down")
    state.removed.push(paths)
  },
}))

import { deleteAssetAction } from "@/lib/products/actions"

/**
 * Deleting a file on the product page.
 *
 * The product page's Files section used to delete any file at once, including
 * the only one a buyer would receive, which the import screen already refused.
 * Now both screens hold the same rule, through the same locked function, and
 * everything that is not a buyer file deletes exactly as it did.
 */

const ONLY = "That is the only file buyers would receive. Upload its replacement first."

describe("deleting a product's buyer file", () => {
  beforeEach(() => {
    state.asset = null
    state.rpc = []
    state.answer = { data: null, error: null }
    state.cascaded = []
    state.removed = []
    state.storageFails = false
  })

  it.each(["deliverable", "archive", "source_file"])(
    "sends a %s through the locked function for its own product, not the cascade",
    async (type) => {
      state.asset = { id: "file-1", product_id: "product-1", asset_type: type }
      state.answer = { data: ["ws/product-1/file-1.zip"], error: null }

      await expect(deleteAssetAction("northbound-type", "file-1")).resolves.toEqual({
        error: null,
      })

      expect(state.rpc).toEqual([
        {
          name: "remove_import_deliverable",
          args: { p_product_id: "product-1", p_asset_id: "file-1" },
        },
      ])
      expect(state.cascaded).toEqual([])
      expect(state.removed).toEqual([["ws/product-1/file-1.zip"]])
    },
  )

  it("refuses the product's last ready buyer file in the import screen's words, and removes no bytes", async () => {
    state.asset = { id: "file-1", product_id: "product-1", asset_type: "deliverable" }
    state.answer = { data: null, error: { message: "only_ready_deliverable" } }

    await expect(deleteAssetAction("northbound-type", "file-1")).resolves.toEqual({
      error: ONLY,
    })
    expect(state.removed).toEqual([])
    expect(state.cascaded).toEqual([])
  })

  it("says a file removed by someone else in the meantime could not be found", async () => {
    state.asset = { id: "file-1", product_id: "product-1", asset_type: "deliverable" }
    state.answer = { data: null, error: { message: "deliverable_not_found" } }

    await expect(deleteAssetAction("northbound-type", "file-1")).resolves.toEqual({
      error: "That file could not be found.",
    })
  })

  it("never shows a raw database error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    state.asset = { id: "file-1", product_id: "product-1", asset_type: "deliverable" }
    state.answer = { data: null, error: { message: "canceling statement due to lock timeout" } }

    await expect(deleteAssetAction("northbound-type", "file-1")).resolves.toEqual({
      error: "That file could not be deleted. Try again.",
    })
    expect(state.removed).toEqual([])
  })

  it("reports the deletion as done when only the stored bytes could not be cleared", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    state.asset = { id: "file-1", product_id: "product-1", asset_type: "deliverable" }
    state.answer = { data: ["ws/product-1/file-1.zip"], error: null }
    state.storageFails = true

    await expect(deleteAssetAction("northbound-type", "file-1")).resolves.toEqual({
      error: null,
    })
  })
})

describe("deleting any other product file", () => {
  beforeEach(() => {
    state.rpc = []
    state.cascaded = []
    state.removed = []
  })

  it.each(["cover_image", "preview_image", "documentation", "license", "screenshot", "other"])(
    "deletes a %s as it always has, without the buyer-file check",
    async (type) => {
      state.asset = { id: "file-2", product_id: "product-1", asset_type: type }

      await expect(deleteAssetAction("northbound-type", "file-2")).resolves.toEqual({
        error: null,
      })

      expect(state.rpc).toEqual([])
      expect(state.cascaded).toEqual(["file-2"])
    },
  )

  it("says a file the caller cannot see could not be found, and deletes nothing", async () => {
    state.asset = null

    await expect(deleteAssetAction("northbound-type", "somebody-elses")).resolves.toEqual({
      error: "That file could not be found.",
    })
    expect(state.rpc).toEqual([])
    expect(state.cascaded).toEqual([])
  })
})
