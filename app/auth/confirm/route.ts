import { NextResponse, type NextRequest } from "next/server"
import { clientEnv } from "@/lib/env"
import {
  PASSWORD_RESET_PATH,
  RECOVERY_FAILURE_PATH,
  safeRedirectTarget,
} from "@/lib/auth/redirect-target"
import { createClient } from "@/lib/supabase/server"

/**
 * Where a recovery link is spent.
 *
 * The link is a bearer credential that arrives by email, so it is exchanged for
 * a session here, once, on the server, and never reaches a client component or
 * a page that could log it. Everything after this point authorizes on the
 * session cookie.
 *
 * Two shapes are accepted because Supabase sends two, depending on how the
 * project's email template is written:
 *
 *   token_hash + type  the template in supabase/config.toml, verified directly.
 *                      Works when the link is opened on a different device from
 *                      the one that asked for it, which is the common case: a
 *                      request made on a laptop, read on a phone.
 *   code               the stock template, which routes through Supabase's own
 *                      verify endpoint and comes back as a PKCE code. Handled so
 *                      that a deployment whose template has not been customized
 *                      degrades rather than breaks, but it is same-device only:
 *                      the code verifier is a cookie on the requesting browser.
 *
 * Only `recovery` is accepted. Signup confirmation is off until C4 and will add
 * its own type here when it is turned on, deliberately rather than by inheriting
 * a permissive allowlist.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams
  // The base is the configured app URL, never the request host.
  const base = clientEnv().NEXT_PUBLIC_APP_URL
  const next = safeRedirectTarget(params.get("next"), PASSWORD_RESET_PATH)

  const tokenHash = params.get("token_hash")
  const type = params.get("type")
  const code = params.get("code")

  const supabase = await createClient()

  let verified = false
  if (tokenHash && type === "recovery") {
    const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash })
    verified = !error
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    verified = !error
  }

  // A link that does not verify is expired, already spent, or forged, and the
  // person holding it cannot act on any of those differently. They get one
  // message and a way to start again. The provider's reason is not repeated.
  if (!verified) {
    return NextResponse.redirect(new URL(RECOVERY_FAILURE_PATH, base))
  }

  return NextResponse.redirect(new URL(next, base))
}
