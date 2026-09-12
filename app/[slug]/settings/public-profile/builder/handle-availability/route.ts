import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { checkHandleForProfile, loadBuilderContext } from "@/lib/public/draft-store"
import { DRAFT_LIMITS } from "@/lib/public/profile-draft"

/**
 * Whether a studio address is free, for the builder's address field.
 *
 * A route handler rather than a server action because of how the field uses
 * it. Server actions from one page are dispatched one at a time, so a check
 * that took a second would hold the draft's autosave behind it; and an action
 * cannot be aborted, where this can be, which is how a superseded check stops
 * costing anything.
 *
 * Signed-in workspace members only, answered about their own profile. It says
 * one thing about one exact handle, the fact a save would disclose anyway, and
 * never lists, suggests, or says whose a taken handle is. The prior settings
 * form declined a live check for fear of exactly this becoming an enumeration
 * API; restricting it to authenticated members and a single boolean is the
 * line held instead. There is no rate limit in the stack yet, which is noted
 * in the PR as the remaining gap.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const handle = new URL(request.url).searchParams.get("handle") ?? ""

  if (handle.length > DRAFT_LIMITS.handle) return json({ status: "invalid" })

  const supabase = await createClient()
  const ctx = await loadBuilderContext(supabase, slug)
  if (!ctx) return json({ error: "not_found" }, 404)

  try {
    return json({ status: await checkHandleForProfile(ctx.profile, handle) })
  } catch (error) {
    console.error("[public] handle availability failed", error)
    return json({ error: "unavailable" }, 503)
  }
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } })
}
