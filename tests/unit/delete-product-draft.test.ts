import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

const ROOT = join(__dirname, "..", "..")

/*
  Delete draft, run for real, with everything outside it replaced: who is
  signed in, which workspace the slug names, the product the caller can see,
  the database function that decides and deletes, storage, and the router.
  Whether the database refuses what it should — under concurrency too — is
  tests/db/product-draft-deletion.test.ts, against real Postgres. What is under
  test here is what the application does with each answer.
*/
const PRODUCT = "5b0f7a4e-2f4c-4d1b-9a53-0c7e3c1d2a10"

const state = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  workspace: { id: "workspace-1", slug: "northbound-type" } as { id: string; slug: string } | null,
  product: null as { id: string; slug: string } | null,
  rpc: [] as Array<{ name: string; args: unknown }>,
  answer: { data: null as unknown, error: null as { message: string; code?: string } | null },
  removed: [] as string[][],
  failStorageCall: null as number | null,
  storageCalls: 0,
  revalidated: [] as Array<[string, string | undefined]>,
  tableDeletes: [] as string[],
}))

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirected to ${to}`)
  },
}))
vi.mock("next/cache", () => ({
  revalidatePath: (path: string, type?: string) => state.revalidated.push([path, type]),
}))
vi.mock("@/lib/jobs", () => ({ jobs: { enqueue: async () => {} } }))
vi.mock("@/lib/products/assets", () => ({ deleteAssetCascade: async () => {} }))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (table: string) => {
      const chain = {
        eq: () => chain,
        maybeSingle: async () => ({
          data: table === "workspaces" ? state.workspace : state.product,
          error: null,
        }),
      }
      return {
        select: () => chain,
        delete: () => {
          state.tableDeletes.push(table)
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
vi.mock("@/lib/products/storage", () => ({
  createUploadUrl: async () => ({}),
  buildStoragePath: () => "",
  sanitizeFilename: (name: string) => name,
  removeObjects: async (paths: string[]) => {
    state.storageCalls += 1
    if (state.failStorageCall === state.storageCalls) throw new Error("storage is down")
    state.removed.push(paths)
  },
}))

import { deleteProductDraftAction } from "@/lib/products/actions"
import {
  DRAFT_DELETION_BLOCKERS,
  DRAFT_DELETION_MESSAGES,
  canConfirmDraftDeletion,
  draftDeletionBlockedMessage,
  eligibilityFromBlocker,
  type DraftDeletionBlocker,
} from "@/lib/products/draft-deletion"

function form(confirmation?: string): FormData {
  const data = new FormData()
  if (confirmation !== undefined) data.set("confirmation", confirmation)
  return data
}

const run = (confirmation: string | undefined = "DELETE", productId = PRODUCT) =>
  deleteProductDraftAction("northbound-type", productId, { error: null }, form(confirmation))

const deletedAnswer = (assetPaths: string[], importSourcePaths: string[]) => ({
  data: {
    outcome: "deleted",
    blocker: null,
    asset_paths: assetPaths,
    import_source_paths: importSourcePaths,
  },
  error: null,
})

beforeEach(() => {
  state.user = { id: "user-1" }
  state.workspace = { id: "workspace-1", slug: "northbound-type" }
  state.product = { id: PRODUCT, slug: "aster-grotesk" }
  state.rpc = []
  state.answer = deletedAnswer([], [])
  state.removed = []
  state.failStorageCall = null
  state.storageCalls = 0
  state.revalidated = []
  state.tableDeletes = []
  vi.restoreAllMocks()
})

describe("the confirmation", () => {
  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["lower case", "delete"],
    ["padded", " DELETE"],
    ["the product's name", "Aster Grotesk"],
  ])("refuses a %s confirmation before asking the database anything", async (_label, typed) => {
    await expect(
      deleteProductDraftAction("northbound-type", PRODUCT, { error: null }, form(typed)),
    ).resolves.toEqual({ error: DRAFT_DELETION_MESSAGES.confirmation })
    expect(state.rpc).toEqual([])
    expect(state.removed).toEqual([])
  })

  it("enables the final button only for the exact word, and never while pending", () => {
    expect(canConfirmDraftDeletion("", false)).toBe(false)
    expect(canConfirmDraftDeletion("delete", false)).toBe(false)
    expect(canConfirmDraftDeletion("DELETE ", false)).toBe(false)
    expect(canConfirmDraftDeletion("DELETE", false)).toBe(true)
    expect(canConfirmDraftDeletion("DELETE", true)).toBe(false)
  })
})

describe("a successful deletion", () => {
  it("calls the guarded function for the product, then cleans both kinds of stored object", async () => {
    state.answer = deletedAnswer(
      ["workspace-1/p/cover.png", "workspace-1/p/thumb.webp"],
      ["workspace-1/import-sources/a.pdf"],
    )

    await expect(run()).rejects.toThrow("redirected to /northbound-type")

    expect(state.rpc).toEqual([{ name: "delete_product_draft", args: { p_product_id: PRODUCT } }])
    expect(state.removed).toEqual([
      ["workspace-1/p/cover.png", "workspace-1/p/thumb.webp"],
      ["workspace-1/import-sources/a.pdf"],
    ])
    // Never straight at the table.
    expect(state.tableDeletes).toEqual([])
  })

  it("asks storage for nothing when there is nothing stored", async () => {
    await expect(run()).rejects.toThrow("redirected to /northbound-type")
    expect(state.storageCalls).toBe(0)
  })

  it("revalidates the catalog, the product, and the profile builder before redirecting", async () => {
    await expect(run()).rejects.toThrow("redirected to /northbound-type")

    expect(state.revalidated).toEqual(
      expect.arrayContaining([
        ["/northbound-type", "layout"],
        ["/northbound-type/aster-grotesk", undefined],
        ["/northbound-type/profile", undefined],
        ["/northbound-type/profile/builder/products", undefined],
      ]),
    )
  })

  it.each([1, 2])(
    "still counts as deleted when storage call %i fails, and logs it without the paths",
    async (failing) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {})
      state.answer = deletedAnswer(
        ["workspace-1/p/cover.png"],
        ["workspace-1/import-sources/a.pdf"],
      )
      state.failStorageCall = failing

      await expect(run()).rejects.toThrow("redirected to /northbound-type")

      // The other call still ran.
      expect(state.storageCalls).toBe(2)
      expect(log).toHaveBeenCalledWith(
        "[products] deleted a draft but not all of its stored objects",
        expect.objectContaining({ productId: PRODUCT, count: 1 }),
      )
    },
  )
})

describe("a deletion that does not happen", () => {
  it.each(DRAFT_DELETION_BLOCKERS)(
    "stays on the page with the stable sentence for %s, and removes nothing",
    async (blocker) => {
      state.answer = {
        data: { outcome: "blocked", blocker, asset_paths: [], import_source_paths: [] },
        error: null,
      }

      await expect(run()).resolves.toEqual({ error: draftDeletionBlockedMessage(blocker) })
      expect(state.removed).toEqual([])
      expect(state.revalidated).toEqual([])
    },
  )

  it("says not found when the database has nothing for this caller", async () => {
    state.answer = {
      data: { outcome: "not_found", blocker: null, asset_paths: [], import_source_paths: [] },
      error: null,
    }
    await expect(run()).resolves.toEqual({ error: DRAFT_DELETION_MESSAGES.notFound })
  })

  it("says not found, without calling the database, for a product outside this workspace", async () => {
    state.product = null
    await expect(run()).resolves.toEqual({ error: DRAFT_DELETION_MESSAGES.notFound })
    expect(state.rpc).toEqual([])
  })

  it("says not found for an id that is not an id", async () => {
    await expect(run("DELETE", "../../etc")).resolves.toEqual({
      error: DRAFT_DELETION_MESSAGES.notFound,
    })
    expect(state.rpc).toEqual([])
  })

  it("never shows a raw database error, and does not redirect", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    state.answer = {
      data: null,
      error: { message: 'deadlock detected on relation "products"', code: "40P01" },
    }

    const result = await run()

    expect(result).toEqual({ error: DRAFT_DELETION_MESSAGES.failed })
    expect(result.error).not.toContain("deadlock")
    expect(state.removed).toEqual([])
    expect(log).toHaveBeenCalled()
  })

  it("refuses an answer of the wrong shape rather than acting on it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    state.answer = {
      data: { outcome: "deleted", blocker: null, asset_paths: [42], import_source_paths: [] },
      error: null,
    }

    await expect(run()).resolves.toEqual({ error: DRAFT_DELETION_MESSAGES.failed })
    expect(state.removed).toEqual([])
  })

  it("refuses a blocker this build does not know", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    state.answer = {
      data: { outcome: "blocked", blocker: "mystery", asset_paths: [], import_source_paths: [] },
      error: null,
    }

    await expect(run()).resolves.toEqual({ error: DRAFT_DELETION_MESSAGES.failed })
  })

  it("sends a signed-out caller to sign in", async () => {
    state.user = null
    await expect(run()).rejects.toThrow("redirected to /sign-in")
    expect(state.rpc).toEqual([])
  })
})

describe("the vocabulary", () => {
  it("has exactly the codes the database can return", () => {
    const migration = readFileSync(
      join(ROOT, "supabase", "migrations", "20260913040000_delete_product_draft.sql"),
      "utf8",
    )
    const body = migration.slice(
      migration.indexOf("create or replace function public.product_draft_deletion_blocker"),
    )
    const returned = [...body.matchAll(/return '([a-z_]+)';/g)].map((match) => match[1])
    const codes = [...new Set(returned)].filter((code) => code !== "not_found")

    expect(codes.sort()).toEqual([...DRAFT_DELETION_BLOCKERS].sort())
  })

  it("gives every blocker its own sentence, in words rather than codes", () => {
    const sentences = DRAFT_DELETION_BLOCKERS.map((code) => draftDeletionBlockedMessage(code))
    expect(new Set(sentences).size).toBe(DRAFT_DELETION_BLOCKERS.length)
    for (const sentence of sentences) expect(sentence).not.toMatch(/_/)
  })

  it.each<[DraftDeletionBlocker, string]>([
    [
      "publication_history",
      "This product can't be permanently deleted. Fanwise has already tried to publish it to a channel.",
    ],
    [
      "upload_in_progress",
      "This draft can't be deleted yet. A file is still uploading. Wait for it to finish, or remove the unfinished file, then try again.",
    ],
  ])("keeps the sentence for %s stable", (code, sentence) => {
    expect(draftDeletionBlockedMessage(code)).toBe(sentence)
  })

  it("reads the page's eligibility from the database's answer, hiding anything it does not recognise", () => {
    expect(eligibilityFromBlocker(null)).toEqual({ kind: "eligible" })
    expect(eligibilityFromBlocker("public_page")).toEqual({
      kind: "blocked",
      blocker: "public_page",
    })
    expect(eligibilityFromBlocker("not_found")).toEqual({ kind: "hidden" })
    expect(eligibilityFromBlocker("something_new")).toEqual({ kind: "hidden" })
    expect(eligibilityFromBlocker(undefined)).toEqual({ kind: "hidden" })
  })
})

describe("one deletion path", () => {
  function sourceFiles(dir: string): string[] {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return []
    }
    return entries.flatMap((entry) => {
      if (entry === "node_modules" || entry.startsWith(".")) return []
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) return sourceFiles(full)
      return /\.(ts|tsx)$/.test(entry) ? [full] : []
    })
  }

  it("no application code deletes from products directly", () => {
    const files = ["lib", "app", "components", "trigger", "scripts"].flatMap((dir) =>
      sourceFiles(join(ROOT, dir)),
    )
    expect(files.length).toBeGreaterThan(0)

    const offenders = files.filter((file) =>
      /from\(\s*["']products["']\s*\)\s*\.delete\(/.test(readFileSync(file, "utf8")),
    )
    expect(offenders).toEqual([])
  })
})
