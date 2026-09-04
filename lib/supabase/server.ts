import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { clientEnv } from "@/lib/env"
import type { Database } from "./database.types"

/**
 * Server client acting as the signed-in user. Still subject to RLS, which is
 * the point: server code does not get to bypass tenancy just because it can.
 */
export async function createClient() {
  const env = clientEnv()
  const cookieStore = await cookies()

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (items) => {
          try {
            items.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {
            // Called from a Server Component. The proxy refreshes the session instead.
          }
        },
      },
    },
  )
}
