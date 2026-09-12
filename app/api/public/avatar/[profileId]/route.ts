import { NextResponse } from "next/server"
import { createPublicClient } from "@/lib/supabase/public"
import { createAdminClient } from "@/lib/supabase/admin"
import { createAvatarUrl } from "@/lib/public/avatars"

/**
 * A creator's avatar, on a public page.
 *
 * Same shape and same reasoning as the asset route: the read that decides
 * whether this may be served is an `anon` select, so RLS answers it, and the
 * only profiles `anon` can see are published ones. An unpublished profile's
 * avatar 404s even for the creator who uploaded it — they see it in settings,
 * through a signed URL minted by the page they are authorised to be on.
 *
 * `avatar_path` is not a column `anon` holds. It is read with the service role
 * only after the row's visibility has been established above, so the object's
 * address never depends on who asked.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ profileId: string }> },
) {
  const { profileId } = await params
  if (!/^[0-9a-f-]{36}$/i.test(profileId)) return notFound()

  const supabase = createPublicClient()
  const { data: profile } = await supabase
    .from("public_profiles")
    .select("id")
    .eq("id", profileId)
    .maybeSingle()

  if (!profile) return notFound()

  const { data: located } = await createAdminClient()
    .from("public_profiles")
    .select("avatar_path")
    .eq("id", profileId)
    .maybeSingle()

  if (!located?.avatar_path) return notFound()

  const signedUrl = await createAvatarUrl(located.avatar_path)
  // A missing object is a missing avatar, not a broken page: the component
  // renders initials when the image fails, so 404 is the right answer.
  if (!signedUrl) return notFound()

  const response = NextResponse.redirect(signedUrl, 307)
  response.headers.set("Cache-Control", "public, max-age=60, stale-while-revalidate=30")
  return response
}

function notFound() {
  return new NextResponse("Not found", {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  })
}
