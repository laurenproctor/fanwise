import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createDownloadUrl } from "@/lib/products/storage"

/**
 * Creator-facing download.
 *
 * ADR 0001: the signed response must carry Content-Disposition built from the
 * asset's `filename` column, so the file arrives correctly named. Storage paths
 * are `<workspace>/<product>/<uuid><ext>`, so without this the creator would
 * receive a file named after a uuid.
 *
 * Authorization is the RLS read below, not the URL being hard to guess. A user
 * who cannot select the asset row gets a 404, identical to one that does not
 * exist.
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
    .select("storage_path, filename, asset_state")
    .eq("id", assetId)
    .maybeSingle()

  if (!asset || asset.asset_state !== "ready") {
    return new NextResponse("Not found", { status: 404 })
  }

  try {
    const signedUrl = await createDownloadUrl(asset.storage_path, asset.filename)
    return NextResponse.redirect(signedUrl, { status: 307 })
  } catch (cause) {
    console.error("[assets] could not mint a download URL", cause)
    return new NextResponse("That file is temporarily unavailable.", { status: 503 })
  }
}
