import { randomBytes } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"
import { readConnectionCredentials, storeConnectionCredentials } from "@/lib/credentials"
import { adminClient, anonClient, createActor, destroyActor, type Actor } from "./harness"

/**
 * The credential row is bound to its connection's workspace twice, and this
 * file proves the line that migration 20260909170000 added: the composite
 * foreign key. The GCM binding in lib/credentials was already proven in
 * tests/unit/credentials.test.ts and is exercised here end to end, through
 * the service role, the only path to the table.
 *
 * Every write here is the service role's, because authenticated holds no
 * grant on channel_connection_secrets at all. That is unchanged, and the
 * first test says so.
 */

const FOREIGN_KEY_VIOLATION = "23503"
const NO_GRANT = "42501"

const credentialSchema = z.object({ token: z.string() })

let alice: Actor
let bob: Actor
let aliceConnectionId: string
let bobConnectionId: string

async function createConnection(actor: Actor, account: string): Promise<string> {
  const admin = adminClient()
  const { data: channel } = await admin.from("channels").select("id").eq("key", "mock_api").single()
  const { data, error } = await actor.client
    .from("channel_connections")
    .insert({
      workspace_id: actor.workspaceId,
      channel_id: channel!.id,
      external_account_id: account,
    })
    .select("id")
    .single()
  if (error) throw new Error(`could not create connection: ${error.message}`)
  return data.id
}

beforeAll(async () => {
  if (!process.env.CREDENTIALS_ENCRYPTION_KEY) {
    process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString("base64")
  }
  alice = await createActor("cb-alice")
  bob = await createActor("cb-bob")
  aliceConnectionId = await createConnection(alice, "cb-alice-shop")
  bobConnectionId = await createConnection(bob, "cb-bob-shop")
})

afterAll(async () => {
  if (alice) await destroyActor(alice)
  if (bob) await destroyActor(bob)
})

describe("the table is unreachable from the browser, still", () => {
  it("anon has no grant", async () => {
    const { error } = await anonClient().from("channel_connection_secrets").select("*")
    expect(error?.code).toBe(NO_GRANT)
  })

  it("a member has no grant, even on their own connection's row", async () => {
    const { error } = await alice.client.from("channel_connection_secrets").select("*")
    expect(error?.code).toBe(NO_GRANT)
  })
})

describe("a credential row cannot associate a connection with a different workspace", () => {
  it("refuses alice's connection under bob's workspace id", async () => {
    const { error } = await adminClient().from("channel_connection_secrets").insert({
      channel_connection_id: aliceConnectionId,
      workspace_id: bob.workspaceId,
      encrypted_credentials: "not.a.real.blob",
      key_version: 1,
    })
    expect(error?.code).toBe(FOREIGN_KEY_VIOLATION)

    const { data } = await adminClient()
      .from("channel_connection_secrets")
      .select("channel_connection_id")
      .eq("channel_connection_id", aliceConnectionId)
    expect(data).toEqual([])
  })

  it("refuses a row for a connection that does not exist", async () => {
    const { error } = await adminClient().from("channel_connection_secrets").insert({
      channel_connection_id: crypto.randomUUID(),
      workspace_id: alice.workspaceId,
      encrypted_credentials: "not.a.real.blob",
      key_version: 1,
    })
    expect(error?.code).toBe(FOREIGN_KEY_VIOLATION)
  })

  it("refuses to move an existing row to another workspace", async () => {
    await storeConnectionCredentials({
      workspaceId: bob.workspaceId,
      connectionId: bobConnectionId,
      credentials: { token: "bob-token" },
    })

    const { error } = await adminClient()
      .from("channel_connection_secrets")
      .update({ workspace_id: alice.workspaceId })
      .eq("channel_connection_id", bobConnectionId)
    expect(error?.code).toBe(FOREIGN_KEY_VIOLATION)
  })
})

describe("the service role retains what the credential service needs", () => {
  it("stores and reads a credential scoped to its own workspace", async () => {
    await storeConnectionCredentials({
      workspaceId: alice.workspaceId,
      connectionId: aliceConnectionId,
      credentials: { token: "alice-token" },
    })

    const read = await readConnectionCredentials({
      workspaceId: alice.workspaceId,
      connectionId: aliceConnectionId,
      schema: credentialSchema,
    })
    expect(read).toEqual({ token: "alice-token" })
  })

  it("reads nothing when the workspace does not match the connection", async () => {
    // The query filters on both ids, so the row is simply not found. The
    // foreign key means no such row can exist; the filter means the service
    // does not depend on that.
    const read = await readConnectionCredentials({
      workspaceId: bob.workspaceId,
      connectionId: aliceConnectionId,
      schema: credentialSchema,
    })
    expect(read).toBeNull()
  })

  it("the row goes with its connection", async () => {
    const { error } = await alice.client
      .from("channel_connections")
      .delete()
      .eq("id", aliceConnectionId)
    expect(error).toBeNull()

    const { data } = await adminClient()
      .from("channel_connection_secrets")
      .select("channel_connection_id")
      .eq("channel_connection_id", aliceConnectionId)
    expect(data).toEqual([])
  })
})
