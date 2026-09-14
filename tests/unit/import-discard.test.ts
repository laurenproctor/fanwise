import { beforeEach, describe, expect, it, vi } from "vitest"

/*
  Discarding an import, run for real, with the database and storage replaced.

  The discard used to mark the import discarded, remove its source files,
  delete the product straight from the table, ignore whether that worked, and
  redirect regardless — leaving the product's own uploads in storage and, on a
  failure, a creator in the catalog believing a draft was gone. It now goes
  through the same guarded deletion as the product page's Delete draft. What is
  held here is that it does, that it cleans both kinds of stored object, that a
  refusal stays on the screen, and that replacing a source never deletes
  anything.
*/
const PRODUCT = "8d7c0a2b-6f1e-4c3a-9b2d-1e0f5a6b7c8d"

const state = vi.hoisted(() => ({
  rpc: [] as Array<{ name: string; args: unknown }>,
  answer: { data: null as unknown, error: null as { message: string } | null },
  removed: [] as string[][],
  storageFails: false,
  importFound: true,
  tableWrites: [] as Array<{ table: string; op: "update" | "delete" }>,
  enqueued: [] as string[],
}))

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirected to ${to}`)
  },
}))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("@/lib/jobs", () => ({
  jobs: {
    enqueue: async (name: string) => {
      state.enqueued.push(name)
    },
  },
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: (table: string) => {
      const chain = {
        eq: () => chain,
        in: () => chain,
        select: () => chain,
        maybeSingle: async () => ({
          data:
            table === "workspaces"
              ? { id: "workspace-1", slug: "northbound-type" }
              : table === "products"
                ? { id: PRODUCT, slug: "pasted-draft" }
                : null,
          error: null,
        }),
        then: (resolve: (value: { error: null }) => unknown) => resolve({ error: null }),
      }
      return {
        select: () => chain,
        update: () => {
          state.tableWrites.push({ table, op: "update" })
          return chain
        },
        delete: () => {
          state.tableWrites.push({ table, op: "delete" })
          return chain
        },
      }
    },
    rpc: async (name: string, args: unknown) => {
      state.rpc.push({ name, args })
      return state.answer
    },
  }),
}))
vi.mock("@/lib/imports/queries", () => ({
  getImport: async () =>
    state.importFound
      ? {
          row: {
            id: "import-1",
            product_id: PRODUCT,
            source_url: "https://old.example/product",
            normalized_url: "https://old.example/product",
            source_path: null,
            evidence: {},
            content_hash: null,
          },
          sources: [{ id: "source-1", source_type: "public_url", storage_path: null }],
          product: { slug: "pasted-draft" },
        }
      : null,
  listDeliverables: async () => [],
}))
vi.mock("@/lib/products/storage", () => ({
  removeObjects: async (paths: string[]) => {
    if (state.storageFails) throw new Error("storage is down")
    state.removed.push(paths)
  },
}))

import { discardImportAction, replaceSourceAction } from "@/lib/imports/actions"
import { draftDeletionBlockedMessage } from "@/lib/products/draft-deletion"

beforeEach(() => {
  state.rpc = []
  state.answer = {
    data: { outcome: "deleted", blocker: null, asset_paths: [], import_source_paths: [] },
    error: null,
  }
  state.removed = []
  state.storageFails = false
  state.importFound = true
  state.tableWrites = []
  state.enqueued = []
  vi.restoreAllMocks()
})

describe("discarding a new import", () => {
  it("deletes its product through the guarded function, and never at the table", async () => {
    await expect(discardImportAction("northbound-type", "import-1")).rejects.toThrow(
      "redirected to /northbound-type",
    )

    expect(state.rpc).toEqual([{ name: "delete_product_draft", args: { p_product_id: PRODUCT } }])
    expect(state.tableWrites).toEqual([])
  })

  it("cleans the import's source files and the product's own uploads, after the database said yes", async () => {
    state.answer = {
      data: {
        outcome: "deleted",
        blocker: null,
        asset_paths: ["workspace-1/product/deliverable.zip"],
        import_source_paths: ["workspace-1/import-sources/notes.txt"],
      },
      error: null,
    }

    await expect(discardImportAction("northbound-type", "import-1")).rejects.toThrow(
      "redirected to /northbound-type",
    )

    expect(state.removed).toEqual([
      ["workspace-1/product/deliverable.zip"],
      ["workspace-1/import-sources/notes.txt"],
    ])
  })

  it("still leaves for the catalog when only the storage cleanup fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    state.answer = {
      data: {
        outcome: "deleted",
        blocker: null,
        asset_paths: ["workspace-1/product/deliverable.zip"],
        import_source_paths: [],
      },
      error: null,
    }
    state.storageFails = true

    await expect(discardImportAction("northbound-type", "import-1")).rejects.toThrow(
      "redirected to /northbound-type",
    )
  })
})

describe("a discard that does not happen", () => {
  it("explains that a product that has left Fanwise is no longer a new draft, and stays", async () => {
    state.answer = {
      data: {
        outcome: "blocked",
        blocker: "publication_history",
        asset_paths: [],
        import_source_paths: [],
      },
      error: null,
    }

    const result = await discardImportAction("northbound-type", "import-1")

    expect(result).toEqual({
      error: draftDeletionBlockedMessage("publication_history", "import"),
    })
    expect(result.error).toContain("can no longer be discarded as a new draft")
    expect(state.removed).toEqual([])
  })

  it("asks the creator to wait while the import is still being read", async () => {
    state.answer = {
      data: {
        outcome: "blocked",
        blocker: "import_in_progress",
        asset_paths: [],
        import_source_paths: [],
      },
      error: null,
    }

    const result = await discardImportAction("northbound-type", "import-1")

    expect(result.error).toBe(draftDeletionBlockedMessage("import_in_progress", "import"))
    expect(result.error).toContain("can't be discarded yet")
  })

  it("does not redirect when the database fails, and shows no raw error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    state.answer = { data: null, error: { message: "could not serialize access" } }

    const result = await discardImportAction("northbound-type", "import-1")

    expect(result.error).toBe("That could not be discarded. Nothing was removed. Try again.")
    expect(state.removed).toEqual([])
  })

  it("says an import the caller cannot see could not be found, and deletes nothing", async () => {
    state.importFound = false

    await expect(discardImportAction("northbound-type", "import-1")).resolves.toEqual({
      error: "That import could not be found.",
    })
    expect(state.rpc).toEqual([])
  })
})

describe("replacing the source", () => {
  it("points the import at the new link and leaves the product alone", async () => {
    await expect(
      replaceSourceAction("northbound-type", "import-1", "https://new.example/product"),
    ).resolves.toEqual({ error: null })

    expect(state.rpc).toEqual([])
    expect(state.removed).toEqual([])
    expect(state.tableWrites.filter((write) => write.op === "delete")).toEqual([])
    expect(state.tableWrites.map((write) => write.table)).not.toContain("products")
    expect(state.enqueued).toEqual(["import_source"])
  })
})
