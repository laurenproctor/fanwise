import { NextResponse } from "next/server"
import { z } from "zod"
import { createPublicClient } from "@/lib/supabase/public"
import { createAdminClient } from "@/lib/supabase/admin"
import { referrerHost } from "@/lib/public/urls"

/**
 * Records that a visitor left a public product page for a channel.
 *
 * ## What is deliberately not here
 *
 * No IP address, no user agent, no cookie, no visitor or session identifier,
 * no full referrer. A row says a page sent somebody to a channel at a time,
 * and the referrer is reduced to a bare host before it is stored. That is
 * enough to tell a creator which of their channels a page actually drives and
 * not enough to reconstruct anybody's browsing, which is the line this endpoint
 * is built not to cross rather than a setting somebody could turn off.
 *
 * ## Why it writes with the service role
 *
 * The alternative is an INSERT grant to `anon`, and an anonymous insert grant
 * is a table anybody on the internet can write rows into. Instead `anon` has
 * no grant on `public_outbound_clicks` at all, this handler re-derives every
 * stored field from the database, and the only thing the browser supplies is
 * which page and which channel — both of which are checked against a
 * cookie-less `anon` read, so a click cannot be recorded against a page that
 * is not genuinely published.
 *
 * ## Why it never blocks the click
 *
 * The browser sends this with `sendBeacon`, which does not wait for a
 * response, and follows the link immediately. Nothing here is on the path
 * between a visitor and the shop they are trying to reach. A failure is logged
 * and answered 204 for the same reason: the click already happened, and there
 * is nobody left to tell.
 */

const bodySchema = z.object({
  pageId: z.uuid(),
  channelId: z.uuid(),
  /**
   * A campaign label, when the visitor arrived with one. Bounded and
   * character-restricted, because it is the one string here that comes from
   * the URL a stranger chose.
   */
  campaign: z
    .string()
    .trim()
    .max(64)
    .regex(/^[A-Za-z0-9._-]*$/)
    .optional(),
})

export async function POST(request: Request) {
  let parsed
  try {
    parsed = bodySchema.safeParse(await request.json())
  } catch {
    return noContent()
  }
  if (!parsed.success) return noContent()

  const { pageId, channelId, campaign } = parsed.data

  // The visibility check, as `anon`. A page that is a draft, or whose profile
  // is a draft, is invisible here and produces no row — so the click log
  // cannot be used to probe for unpublished pages either.
  const supabase = createPublicClient()
  const { data: page } = await supabase
    .from("public_product_pages")
    .select("id, public_profile_id, product_id")
    .eq("id", pageId)
    .maybeSingle()

  if (!page) return noContent()

  // And the channel has to be one this product genuinely has a live listing
  // on, so a row cannot be attributed to a channel the creator never used.
  const { data: listing } = await supabase
    .from("channel_listings")
    .select("id")
    .eq("product_id", page.product_id)
    .eq("channel_id", channelId)
    .maybeSingle()

  if (!listing) return noContent()

  // workspace_id is read rather than accepted: the composite foreign keys
  // require it to match the page's, and the browser has no business naming it.
  const admin = createAdminClient()
  const { data: owner } = await admin
    .from("public_product_pages")
    .select("workspace_id")
    .eq("id", pageId)
    .maybeSingle()

  if (!owner) return noContent()

  const { error } = await admin.from("public_outbound_clicks").insert({
    workspace_id: owner.workspace_id,
    public_profile_id: page.public_profile_id,
    public_product_page_id: page.id,
    channel_id: channelId,
    referrer_host: referrerHost(request.headers.get("referer")),
    campaign: campaign && campaign.length > 0 ? campaign : null,
  })

  if (error) console.error("[public] outbound click not recorded", error)

  return noContent()
}

/**
 * Always 204, whatever happened.
 *
 * The caller is a beacon that has already navigated away, so there is no
 * client to act on an error code, and distinguishing "no such page" from
 * "recorded" in the response would turn this into an endpoint for testing
 * whether a page id exists.
 */
function noContent() {
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } })
}
