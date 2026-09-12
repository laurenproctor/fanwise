import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { adminClient, anonClient, createActor, destroyActor, type Actor } from "./harness"
import { WORKSPACE_ICON_BUCKET, buildIconPath } from "@/lib/workspaces/icons"

/**
 * The workspace icon, against a real database and real storage.
 *
 * Two questions, and neither is answerable by reading the policy text: can a
 * creator reach another workspace's icon, and can a path that does not belong to
 * a workspace be written into its row.
 */

let alice: Actor
let bob: Actor

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00])

beforeAll(async () => {
  alice = await createActor("icon-a")
  bob = await createActor("icon-b")
}, 60_000)

afterAll(async () => {
  const admin = adminClient()
  await admin.storage
    .from(WORKSPACE_ICON_BUCKET)
    .remove([`${alice.workspaceId}/a.png`, `${bob.workspaceId}/b.png`])
    .catch(() => {})
  await destroyActor(alice)
  await destroyActor(bob)
}, 60_000)

describe("the icon column", () => {
  it("an owner may set a path inside their own workspace", async () => {
    const path = buildIconPath(alice.workspaceId, "a", "image/png")
    const { error } = await alice.client
      .from("workspaces")
      .update({ icon_path: path })
      .eq("id", alice.workspaceId)

    expect(error).toBeNull()

    const { data } = await alice.client
      .from("workspaces")
      .select("icon_path")
      .eq("id", alice.workspaceId)
      .single()
    expect(data?.icon_path).toBe(path)
  })

  /**
   * The constraint, not the application, is what makes this impossible. An
   * owner who posts another workspace's id as their own icon path would
   * otherwise have a row pointing at a private object they may then read
   * through their own workspace's signed URL.
   */
  it("refuses a path belonging to another workspace", async () => {
    const { error } = await alice.client
      .from("workspaces")
      .update({ icon_path: buildIconPath(bob.workspaceId, "b", "image/png") })
      .eq("id", alice.workspaceId)

    expect(error).not.toBeNull()
    expect(error?.message).toContain("workspaces_icon_path_scoped")
  })

  it("refuses a path with no workspace prefix at all", async () => {
    const { error } = await alice.client
      .from("workspaces")
      .update({ icon_path: "icon.png" })
      .eq("id", alice.workspaceId)

    expect(error).not.toBeNull()
  })

  it("allows clearing the icon", async () => {
    const { error } = await alice.client
      .from("workspaces")
      .update({ icon_path: null })
      .eq("id", alice.workspaceId)
    expect(error).toBeNull()
  })

  it("does not let one creator write another workspace's row", async () => {
    const { data, error } = await bob.client
      .from("workspaces")
      .update({ icon_path: buildIconPath(alice.workspaceId, "a", "image/png") })
      .eq("id", alice.workspaceId)
      .select("id")

    // No matching row: RLS makes someone else's workspace indistinguishable
    // from one that does not exist.
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })
})

describe("the icon bucket", () => {
  const alicePath = () => `${alice.workspaceId}/a.png`

  beforeAll(async () => {
    const admin = adminClient()
    const { error } = await admin.storage
      .from(WORKSPACE_ICON_BUCKET)
      .upload(alicePath(), PNG, { contentType: "image/png", upsert: true })
    if (error) throw error
  }, 60_000)

  it("is private: an anonymous caller cannot read an object from it", async () => {
    const anon = anonClient()
    const { data, error } = await anon.storage.from(WORKSPACE_ICON_BUCKET).download(alicePath())
    expect(data).toBeNull()
    expect(error).not.toBeNull()
  })

  it("lets a member read their own workspace's icon", async () => {
    const { data, error } = await alice.client.storage
      .from(WORKSPACE_ICON_BUCKET)
      .download(alicePath())
    expect(error).toBeNull()
    expect(data).not.toBeNull()
  })

  it("does not let one creator read another workspace's icon", async () => {
    const { data, error } = await bob.client.storage
      .from(WORKSPACE_ICON_BUCKET)
      .download(alicePath())
    expect(data).toBeNull()
    expect(error).not.toBeNull()
  })

  it("does not let one creator write into another workspace's prefix", async () => {
    const { error } = await bob.client.storage
      .from(WORKSPACE_ICON_BUCKET)
      .upload(`${alice.workspaceId}/intruder.png`, PNG, { contentType: "image/png" })
    expect(error).not.toBeNull()
  })

  it("does not let one creator delete another workspace's icon", async () => {
    await bob.client.storage.from(WORKSPACE_ICON_BUCKET).remove([alicePath()])

    // Still there, read back with the service role so the check does not depend
    // on the policy it is testing.
    const { error } = await adminClient().storage.from(WORKSPACE_ICON_BUCKET).download(alicePath())
    expect(error).toBeNull()
  })
})
