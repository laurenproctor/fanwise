import type { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { isStale, open, seal } from "./seal"

/**
 * Reading and writing marketplace credentials.
 *
 * The only path to channel_connection_secrets. That table carries no grant to
 * anon or authenticated at all, so every call here goes through the service
 * role and therefore has to scope the workspace itself, in code, per
 * docs/security.md rule 4. Both functions take a workspaceId and both filter on
 * it; a caller that has not established which workspace it is acting for cannot
 * use this module correctly, which is the intent.
 *
 * Three rules this file exists to make structural rather than remembered:
 *
 *   1. A credential is never returned to the browser. Nothing here is a server
 *      action and nothing here is importable from a client component: the
 *      admin client throws in the browser.
 *   2. A credential is never logged. There is no console call in this file, and
 *      no error thrown from it carries plaintext. When decryption fails the
 *      caller learns that it failed, not what was in the box.
 *   3. A credential is never placed in an AI prompt. Nothing in lib/ai will
 *      ever import this module; the boundary test in tests/unit enforces it.
 */

/**
 * Binds a sealed blob to the row it belongs to. Passed to GCM as additional
 * authenticated data, so a ciphertext moved between connections, or between
 * workspaces, refuses to open rather than opening into the wrong tenant.
 */
function contextFor(workspaceId: string, connectionId: string): string {
  return `channel_connection:${workspaceId}:${connectionId}`
}

export async function storeConnectionCredentials(params: {
  workspaceId: string
  connectionId: string
  credentials: Record<string, unknown>
}): Promise<void> {
  const { workspaceId, connectionId, credentials } = params
  const sealed = seal(JSON.stringify(credentials), contextFor(workspaceId, connectionId))

  const admin = createAdminClient()
  const { error } = await admin.from("channel_connection_secrets").upsert(
    {
      channel_connection_id: connectionId,
      workspace_id: workspaceId,
      encrypted_credentials: sealed.ciphertext,
      key_version: sealed.keyVersion,
    },
    { onConflict: "channel_connection_id" },
  )

  // Deliberately not wrapped with the payload in scope. A thrown Supabase error
  // is safe to propagate; a message built from `credentials` would not be.
  if (error) throw new Error(`could not store credentials: ${error.message}`)
}

/**
 * Returns null when there is no credential for this connection, which is a
 * normal state: a connection can exist while its authorization is being redone.
 * Throws when a credential exists but cannot be opened, because that is a
 * configuration or integrity problem and silently treating it as absent would
 * send the caller down the "reconnect your shop" path for a key mistake.
 */
export async function readConnectionCredentials<T>(params: {
  workspaceId: string
  connectionId: string
  schema: z.ZodType<T>
}): Promise<T | null> {
  const { workspaceId, connectionId, schema } = params

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("channel_connection_secrets")
    .select("encrypted_credentials, key_version")
    .eq("channel_connection_id", connectionId)
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  if (error) throw new Error(`could not read credentials: ${error.message}`)
  if (!data) return null

  const context = contextFor(workspaceId, connectionId)
  const plaintext = open(
    { ciphertext: data.encrypted_credentials, keyVersion: data.key_version },
    context,
  )

  // Validated before use, like every other external payload. A credential that
  // has drifted out of shape is a credential that produces a confusing provider
  // error three calls later.
  const parsed = schema.safeParse(JSON.parse(plaintext))
  if (!parsed.success) {
    throw new Error("stored credential does not match the shape this channel expects")
  }

  // Rotation happens on read rather than in a migration or a cron job: the rows
  // that matter are the ones being used, and this is the only place that is
  // guaranteed to hold both the plaintext and the active key at once. Best
  // effort, because failing a publish to re-seal a working credential would be
  // the wrong trade.
  if (isStale(data.key_version)) {
    const resealed = seal(plaintext, context)
    await admin
      .from("channel_connection_secrets")
      .update({
        encrypted_credentials: resealed.ciphertext,
        key_version: resealed.keyVersion,
      })
      .eq("channel_connection_id", connectionId)
      .eq("workspace_id", workspaceId)
  }

  return parsed.data
}
