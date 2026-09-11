import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createPreviewUrl } from "@/lib/products/storage"

/**
 * An image, rendered inline in Fanwise's own UI.
 *
 * The sibling of the download route, and the difference is the whole reason it
 * exists: a signed URL carrying Content-Disposition makes a browser save the
 * file, so an <img> pointed at the download route renders nothing at all.
 *
 * Authorization is the RLS read below, not the URL being hard to guess. A user
 * who cannot select the asset row gets a 404, identical to one that does not
 * exist.
 *
 * Images only, judged by the mime type the finalize job sniffed from the stored
 * bytes rather than by anything the browser claimed at upload. Without that
 * check this route would render any uploaded file inline on request, which is
 * not a hole worth leaving open to save a condition.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; assetId: string }> },
) {
  const { assetId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new NextResponse("Not found", { status: 404 })

  const { data: asset } = await supabase
    .from("product_assets")
    .select("storage_path, mime_type, asset_state")
    .eq("id", assetId)
    .maybeSingle()

  if (!asset || asset.asset_state !== "ready" || !asset.mime_type?.startsWith("image/")) {
    return new NextResponse("Not found", { status: 404 })
  }

  try {
    const signedUrl = await createPreviewUrl(asset.storage_path)
    return NextResponse.redirect(signedUrl, { status: 307 })
  } catch (cause) {
    console.error("[assets] could not mint a preview URL", cause)
    return new NextResponse("That image is temporarily unavailable.", { status: 503 })
  }
}
