import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { clientEnv } from "@/lib/env"
import type { Database } from "./database.types"

/**
 * The anonymous client. No cookies, no session, ever.
 *
 * This is what renders a public creator page, and the missing cookie jar is the
 * whole point of it existing alongside `createClient()`.
 *
 * `createClient()` reads the request's cookies, so a signed-in creator visiting
 * their own `/@handle` would be `authenticated` there, and the member SELECT
 * policies would hand them their own drafts. The page would look right to the
 * one person who cannot tell. Everyone else — and the cache, which does not
 * know whose response it holds — would get something different.
 *
 * So the public read path is deliberately blind to who is asking. What this
 * client can see is exactly what a stranger can see, which makes "is this
 * safe to cache and serve to anyone" a question with one answer rather than a
 * property of whoever happened to render it first. RLS does the rest: `anon`
 * holds SELECT on four tables, all of them gated on `status = 'published'`.
 *
 * Preview is the deliberate exception and does not come through here. It uses
 * the member client, is marked no-store, and is never the canonical URL.
 */
export function createPublicClient() {
  const env = clientEnv()
  return createSupabaseClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}
