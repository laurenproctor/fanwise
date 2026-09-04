import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { clientEnv, serverEnv } from "@/lib/env"
import type { Database } from "./database.types"

/**
 * Service-role client. BYPASSES RLS.
 *
 * Use only where a request genuinely has no user context: webhook handlers,
 * background jobs, and migrations-adjacent tooling. Every call site must
 * establish the workspace scope itself, in code, because the database will not
 * do it for you here.
 *
 * Never import this into a component, a route handler serving a browser
 * request, or anything that could be bundled for the client.
 */
export function createAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error("createAdminClient() was called in the browser.")
  }
  const pub = clientEnv()
  const secret = serverEnv()
  return createSupabaseClient<Database>(
    pub.NEXT_PUBLIC_SUPABASE_URL,
    secret.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  )
}
