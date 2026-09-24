import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createPreviewUrl, downloadObject } from "@/lib/products/storage"
import { isFontMimeType, readPackagedFont, ZIP_MIME_TYPE } from "@/lib/fonts/read-upload"
import { MAX_PREVIEWABLE_PACKAGE_BYTES } from "@/lib/fonts/archive-limits"
import { isReadPackagedFont } from "@/lib/fonts/detected"

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
 * Images and fonts only, judged by the mime type the finalize job sniffed from
 * the stored bytes rather than by anything the browser claimed at upload.
 * Without that check this route would render any uploaded file inline on
 * request, which is not a hole worth leaving open to save a condition.
 *
 * Fonts are admitted for the font workspace's live preview, which fetches the
 * bytes and hands them to the FontFace API. A font cannot run script, and the
 * reader is already a member of the workspace that owns it: this is the same
 * file the download route would give them, without the attachment header.
 *
 * A font inside a ZIP package is admitted the same way, named by `?entry=`,
 * the path the package's contents list shows. The package itself is never
 * served inline: the entry must be one the finalize job already read as a font
 * (`metadata.archive`), the package must be small enough to open in a request,
 * and the bytes are sniffed again before they go out, so nothing but a font
 * ever leaves a package through here.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; assetId: string }> },
) {
  const { assetId } = await params
  const entryPath = new URL(request.url).searchParams.get("entry")
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new NextResponse("Not found", { status: 404 })

  const { data: asset } = await supabase
    .from("product_assets")
    .select("storage_path, mime_type, asset_state, byte_size, metadata")
    .eq("id", assetId)
    .maybeSingle()

  if (!asset || asset.asset_state !== "ready") {
    return new NextResponse("Not found", { status: 404 })
  }

  if (entryPath !== null) return packagedFont(asset, entryPath)

  if (!(asset.mime_type?.startsWith("image/") || isFontMimeType(asset.mime_type))) {
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

async function packagedFont(
  asset: {
    storage_path: string
    mime_type: string | null
    byte_size: number | null
    metadata: unknown
  },
  entryPath: string,
): Promise<NextResponse> {
  if (
    asset.mime_type !== ZIP_MIME_TYPE ||
    asset.byte_size === null ||
    asset.byte_size > MAX_PREVIEWABLE_PACKAGE_BYTES ||
    !isReadPackagedFont(asset.metadata, entryPath)
  ) {
    return new NextResponse("Not found", { status: 404 })
  }

  try {
    const read = readPackagedFont(await downloadObject(asset.storage_path), entryPath)
    if (!read.ok) return new NextResponse("Not found", { status: 404 })
    return new NextResponse(new Uint8Array(read.bytes), {
      status: 200,
      headers: {
        "Content-Type": read.mimeType,
        // The reader is a signed-in member and the bytes never change (a ready
        // asset is immutable), so the browser may keep them for the session.
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (cause) {
    console.error("[assets] could not read a packaged font", cause)
    return new NextResponse("That font is temporarily unavailable.", { status: 503 })
  }
}
