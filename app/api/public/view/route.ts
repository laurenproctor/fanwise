import { NextResponse } from "next/server"
import { z } from "zod"
import { createPublicClient } from "@/lib/supabase/public"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { isLikelyBot, viewReferrerHost } from "@/lib/public/page-views"

/**
 * Records that somebody looked at a public profile or one of its product
 * pages. The sibling of /api/public/outbound, and built to the same rules:
 * read its header for the reasoning, which is not repeated here.
 *
 * In short: nobody is signed in and nothing the browser says is believed. The
 * profile and the page are checked against a cookie-less `anon` read, so a view
 * cannot be recorded against anything that is not genuinely published; the
 * workspace is re-derived with the service role, which is the only writer; and
 * the row carries no visitor identity — no IP, no user agent, no cookie, no
 * session — just the page, a time, and where the visitor came from as a bare
 * host.
 *
 * Three kinds of visit are not counted, all decided here and none stored:
 *
 *   - a crawler or unfurler, by the user agent it announces;
 *   - the creator, or anyone else in the workspace, looking at their own page.
 *     A creator checking their profile after every edit would otherwise be
 *     most of its traffic;
 *   - a reload in the same tab, which the browser filters before sending
 *     (components/public/page-view-beacon.tsx).
 *
 * Always 204, for the reason the outbound handler gives: nothing is waiting on
 * the answer, and a different answer for "no such page" would make this an
 * endpoint for testing whether a page id exists.
 */

const bodySchema = z.object({
  profileId: z.uuid(),
  pageId: z.uuid().optional(),
  /** document.referrer. Reduced to a host before it is stored, and only that. */
  referrer: z.string().max(2048).optional(),
  campaign: z
    .string()
    .trim()
    .max(64)
    .regex(/^[A-Za-z0-9._-]*$/)
    .optional(),
})

export async function POST(request: Request) {
  if (isLikelyBot(request.headers.get("user-agent"))) return noContent()

  let parsed
  try {
    parsed = bodySchema.safeParse(await request.json())
  } catch {
    return noContent()
  }
  if (!parsed.success) return noContent()

  const { profileId, pageId, referrer, campaign } = parsed.data

  // The visibility check, as `anon`: RLS shows published profiles and
  // published pages under them, and nothing else.
  const supabase = createPublicClient()
  const { data: profile } = await supabase
    .from("public_profiles")
    .select("id")
    .eq("id", profileId)
    .maybeSingle()
  if (!profile) return noContent()

  if (pageId) {
    const { data: page } = await supabase
      .from("public_product_pages")
      .select("id")
      .eq("id", pageId)
      .eq("public_profile_id", profileId)
      .maybeSingle()
    if (!page) return noContent()
  }

  try {
    const admin = createAdminClient()
    const { data: owner } = await admin
      .from("public_profiles")
      .select("workspace_id")
      .eq("id", profileId)
      .maybeSingle()
    if (!owner) return noContent()

    if (await isOwnVisit(request, owner.workspace_id)) return noContent()

    const { error } = await admin.from("public_page_views").insert({
      workspace_id: owner.workspace_id,
      public_profile_id: profileId,
      public_product_page_id: pageId ?? null,
      referrer_host: viewReferrerHost(referrer, new URL(request.url).host),
      campaign: campaign && campaign.length > 0 ? campaign : null,
    })

    if (error) console.error("[public] page view not recorded", error)
  } catch (error) {
    console.error("[public] page view not recorded", error)
  }

  return noContent()
}

/**
 * Whether the visitor is signed in as a member of the workspace that owns the
 * page. Asked only when the request carries a Supabase session cookie, so an
 * anonymous visitor — nearly all of them — costs no auth call.
 */
async function isOwnVisit(request: Request, workspaceId: string): Promise<boolean> {
  const cookieHeader = request.headers.get("cookie") ?? ""
  if (!/(?:^|;\s*)sb-[^=]*-auth-token/.test(cookieHeader)) return false
  try {
    const supabase = await createClient()
    const { data } = await supabase.rpc("is_workspace_member", { p_workspace_id: workspaceId })
    return data === true
  } catch {
    return false
  }
}

function noContent() {
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } })
}
