import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

/*
  The action, run for real, with everything it reaches outside itself replaced:
  who is signed in, which workspace the slug names, the import, the database
  function that decides and deletes, and the storage removal after it. The
  decision itself — never the last ready buyer file, even under concurrency — is
  the database's, and tests/db/import-deliverable-removal.test.ts proves it
  against real Postgres. What is under test here is what this action does with
  each answer the function can give.
*/
const state = vi.hoisted(() => ({
  rpc: [] as Array<{ name: string; args: unknown }>,
  answer: { data: null as string[] | null, error: null as { message: string } | null },
  removed: [] as string[][],
  storageFails: false,
  importFound: true,
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
    rpc: async (name: string, args: unknown) => {
      state.rpc.push({ name, args })
      return state.answer
    },
  }),
}))
vi.mock("@/lib/imports/queries", () => ({
  getImport: async () =>
    state.importFound ? { row: { id: "import-1", product_id: "product-1" } } : null,
  listDeliverables: async () => [],
}))
vi.mock("@/lib/products/storage", () => ({
  removeObjects: async (paths: string[]) => {
    if (state.storageFails) throw new Error("storage is down")
    state.removed.push(paths)
  },
}))

import { removeDeliverableAction } from "@/lib/imports/actions"

/**
 * Replacing the only buyer file never leaves a product with none.
 *
 * A browser test used to upload a zip, try to remove it, read the refusal,
 * upload a replacement and then remove the original. The rule is now one
 * database transaction; this is the action around it: who it asks, what it
 * tells the creator for each refusal, and that stored bytes are only removed
 * once the database has agreed the rows are gone.
 */

const ONLY = "That is the only file buyers would receive. Upload its replacement first."

describe("removing a buyer file from an import", () => {
  beforeEach(() => {
    state.rpc = []
    state.answer = { data: null, error: null }
    state.removed = []
    state.storageFails = false
    state.importFound = true
  })

  it("asks the database to decide and delete, for this import's product", async () => {
    state.answer = { data: ["ws/product-1/original.zip"], error: null }

    await expect(
      removeDeliverableAction("northbound-type", "import-1", "original"),
    ).resolves.toEqual({ error: null })

    expect(state.rpc).toEqual([
      {
        name: "remove_import_deliverable",
        args: { p_product_id: "product-1", p_asset_id: "original" },
      },
    ])
  })

  it("removes the stored bytes of every row the database removed, after it did", async () => {
    state.answer = { data: ["ws/p/original.zip", "ws/p/original-derivative.zip"], error: null }

    await removeDeliverableAction("northbound-type", "import-1", "original")

    expect(state.removed).toEqual([["ws/p/original.zip", "ws/p/original-derivative.zip"]])
  })

  it("refuses the only ready file in the creator's words, and removes no bytes", async () => {
    state.answer = { data: null, error: { message: "only_ready_deliverable" } }

    await expect(
      removeDeliverableAction("northbound-type", "import-1", "original"),
    ).resolves.toEqual({ error: ONLY })
    expect(state.removed).toEqual([])
  })

  it("says a file that is not this import's could not be found", async () => {
    state.answer = { data: null, error: { message: "deliverable_not_found" } }

    await expect(
      removeDeliverableAction("northbound-type", "import-1", "somebody-elses"),
    ).resolves.toEqual({ error: "That file could not be found." })
    expect(state.removed).toEqual([])
  })

  it("never shows a raw database error, and removes no bytes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    state.answer = { data: null, error: { message: "canceling statement due to lock timeout" } }

    await expect(
      removeDeliverableAction("northbound-type", "import-1", "original"),
    ).resolves.toEqual({ error: "That file could not be removed. Try again." })
    expect(state.removed).toEqual([])
  })

  it("reports the removal as done when only the stored bytes could not be cleared", async () => {
    // The rows are committed by then: the buyer file is gone from the product,
    // and saying otherwise would invite a retry that finds nothing to remove.
    vi.spyOn(console, "error").mockImplementation(() => {})
    state.answer = { data: ["ws/p/original.zip"], error: null }
    state.storageFails = true

    await expect(
      removeDeliverableAction("northbound-type", "import-1", "original"),
    ).resolves.toEqual({ error: null })
  })

  it("asks nothing of the database for an import it cannot find", async () => {
    state.importFound = false

    await expect(
      removeDeliverableAction("northbound-type", "import-1", "original"),
    ).resolves.toEqual({ error: "That import could not be found." })
    expect(state.rpc).toEqual([])
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
