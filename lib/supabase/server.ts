import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { clientEnv } from "@/lib/env"
import type { Database } from "./database.types"

/**
 * Server client acting as the signed-in user. Still subject to RLS, which is
 * the point: server code does not get to bypass tenancy just because it can.
 */
export async function createClient() {
  // cookies() first, and the order matters. Reading it is what tells Next the
  // route is dynamic, so during `next build` this line ends the prerender
  // attempt before clientEnv() is reached. With the two reversed, a build
  // environment missing NEXT_PUBLIC_SUPABASE_* fails the export of every auth
  // page instead of rendering them per request, which is what they are.
  const cookieStore = await cookies()
  const env = clientEnv()

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
