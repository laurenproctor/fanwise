import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/supabase/database.types"

/**
 * Tenancy test harness.
 *
 * Every actor here is a real Supabase user holding a real JWT, talking to the
 * database through PostgREST. That is deliberate: testing RLS over a raw
 * Postgres connection with a hand-set role proves the policies compile, not that
 * the path production actually uses is safe.
 */

export type Client = SupabaseClient<Database>

/**
 * Retries only transport-level failures: a gateway that did not answer (502,
 * 503, 504) or a socket error. Application responses are passed straight
 * through untouched, so a 403 carrying SQLSTATE 42501 and a 200 carrying an
 * empty array both reach the assertions exactly as the database produced them.
 *
 * This exists because a gateway 502 is not an answer to the question these
 * tests ask. Treating one as a pass would be vacuous; treating one as a failure
 * would be a false alarm. Neither is a result, so the call is simply retried.
 * On a clean runner this never fires.
 */
const GATEWAY_FAILURE = new Set([502, 503, 504])
const MAX_TRANSPORT_ATTEMPTS = 3

const retryingFetch: typeof fetch = async (input, init) => {
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_TRANSPORT_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(input, init)
      if (!GATEWAY_FAILURE.has(response.status) || attempt === MAX_TRANSPORT_ATTEMPTS) {
        return response
      }
    } catch (error) {
      lastError = error
      if (attempt === MAX_TRANSPORT_ATTEMPTS) throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
  }

  throw lastError ?? new Error("gateway did not respond")
}

function required(name: string, ...fallbacks: string[]): string {
  for (const key of [name, ...fallbacks]) {
    const value = process.env[key]
    if (value) return value
  }
  throw new Error(
    `${name} is not set. Start the local stack with \`supabase start\` and export the keys ` +
      `it prints, or run \`pnpm test:db\` through the documented CI setup.`,
  )
}

export const SUPABASE_URL = () => required("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL")
export const ANON_KEY = () => required("SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY")
export const SERVICE_ROLE_KEY = () => required("SUPABASE_SERVICE_ROLE_KEY")

/** Service-role client. Bypasses RLS; used only to create and destroy fixtures. */
export function adminClient(): Client {
  return createClient<Database>(SUPABASE_URL(), SERVICE_ROLE_KEY(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: retryingFetch },
  })
}

/** An unauthenticated client, carrying only the anon key. */
export function anonClient(): Client {
  return createClient<Database>(SUPABASE_URL(), ANON_KEY(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: retryingFetch },
  })
}

export interface Actor {
  userId: string
  email: string
  client: Client
  workspaceId: string
  workspaceSlug: string
}

const PASSWORD = "correct-horse-battery-staple"

let counter = 0
function uniqueEmail(label: string): string {
  counter += 1
  return `a1-${label}-${Date.now()}-${counter}@fanwise.test`
}

/**
 * Creates a confirmed user, signs them in for a real session, and gives them one
 * workspace through the sanctioned RPC.
 */
export async function createActor(label: string): Promise<Actor> {
  const admin = adminClient()
  const email = uniqueEmail(label)

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  })
  if (createError || !created.user) {
    throw new Error(`could not create test user: ${createError?.message}`)
  }

  const client = anonClient()
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (signInError) throw new Error(`could not sign in test user: ${signInError.message}`)

  const slug = `ws-${label}-${Date.now().toString(36)}-${(counter % 1000).toString(36)}`
  const { data: workspace, error: rpcError } = await client.rpc("create_workspace", {
    p_name: `Workspace ${label}`,
    p_slug: slug,
  })
  if (rpcError || !workspace) {
    throw new Error(`could not create workspace: ${rpcError?.message}`)
  }

  return {
    userId: created.user.id,
    email,
    client,
    workspaceId: workspace.id,
    workspaceSlug: workspace.slug,
  }
}

/** Removes the user; the workspace and membership cascade from auth.users. */
export async function destroyActor(actor: Actor): Promise<void> {
  const admin = adminClient()
  await admin.from("workspaces").delete().eq("id", actor.workspaceId)
  await admin.auth.admin.deleteUser(actor.userId)
}

/** Postgres insufficient_privilege / RLS violation, as surfaced by PostgREST. */
export const RLS_DENIED = "42501"
