import { createBrowserClient } from "@supabase/ssr"
import { clientEnv } from "@/lib/env"
import type { Database } from "./database.types"

/** Browser client. Anon key only, subject to RLS. */
export function createClient() {
  const env = clientEnv()
  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  )
}
