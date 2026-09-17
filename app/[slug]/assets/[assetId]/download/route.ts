import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createDownloadUrl } from "@/lib/products/storage"
import { downloadName } from "@/lib/products/download-name"

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
 *
 * `?name=` renames the download. An assisted channel's handoff hands over
 * renditions under names the channel's editor sorts by, and a package under
 * the name buyers will see, and neither is the row's filename. The extension
 * is kept from the row, whatever the query says, so a file cannot arrive
 * claiming to be a type it is not.
 */
export async function GET(
  request: Request,
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
    const signedUrl = await createDownloadUrl(
      asset.storage_path,
      downloadName(asset.filename, new URL(request.url).searchParams.get("name")),
    )
    return NextResponse.redirect(signedUrl, { status: 307 })
  } catch (cause) {
    console.error("[assets] could not mint a download URL", cause)
    return new NextResponse("That file is temporarily unavailable.", { status: 503 })
  }
}
