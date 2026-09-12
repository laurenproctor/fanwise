import { NextResponse } from "next/server"
import { createPublicClient } from "@/lib/supabase/public"
import { createPreviewUrl } from "@/lib/products/storage"

/**
 * A product image, on a public page.
 *
 * Nobody is signed in. This is reached by a stranger's browser, from a page
 * that renders for the open web, and it must answer without a session — which
 * is why it is on the proxy's public list. Nothing in the request is trusted:
 * the asset id is not a capability, and what may be served is re-derived from
 * the database on every request.
 *
 * The sibling of `/[slug]/assets/[assetId]/preview`, and the difference is the
 * authorization. That route reads as the signed-in user and lets RLS decide;
 * this one reads as `anon` through a cookie-less client, so the only rows it
 * can see at all are images of a product with a published public page beneath
 * a published profile. The policy is
 * `images behind a published public page are readable by anyone`, and there is
 * no second check here on purpose: a condition written twice is a condition
 * that can disagree with itself.
 *
 * Unpublishing therefore takes the pictures down with the page, on the next
 * request, with no cache to purge and no objects to move. That is the whole
 * reason the bucket is private and this route exists rather than a public URL.
 *
 * Images only, judged by the mime type the finalize job sniffed from the
 * stored bytes rather than by anything a browser claimed at upload. Without
 * that check this would render any uploaded file inline on request.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params

  // A malformed id is a 404 rather than a 400. The response for "no such
  // image" and "not a valid id" should be identical, so neither confirms
  // anything about what exists.
  if (!/^[0-9a-f-]{36}$/i.test(assetId)) return notFound()

  const supabase = createPublicClient()

  const { data: asset } = await supabase
    .from("product_assets")
    .select("id, mime_type, asset_type")
    .eq("id", assetId)
    .maybeSingle()

  if (!asset || !asset.mime_type?.startsWith("image/")) return notFound()

  // Gallery types only. A deliverable is the file a buyer pays for, and a
  // deliverable that happens to be a PNG is not a preview.
  if (!GALLERY_TYPES.has(asset.asset_type)) return notFound()

  // `storage_path` is not granted to anon, which is deliberate: the object's
  // address is not a public fact. The path is read with the service role,
  // having already established through RLS above that this image is public.
  const { createAdminClient } = await import("@/lib/supabase/admin")
  const { data: located } = await createAdminClient()
    .from("product_assets")
    .select("storage_path")
    .eq("id", assetId)
    .maybeSingle()

  if (!located) return notFound()

  try {
    const signedUrl = await createPreviewUrl(located.storage_path)
    const response = NextResponse.redirect(signedUrl, 307)
    /*
      Cached, but for less time than the signed URL lives, so a cached redirect
      never points at an expired signature. Short enough that unpublishing is
      visible in a minute rather than a day — the page itself is revalidated on
      publish, and this is the one thing a creator would otherwise watch linger.
    */
    response.headers.set("Cache-Control", "public, max-age=60, stale-while-revalidate=30")
    return response
  } catch (cause) {
    console.error("[public] could not mint an image URL", cause)
    return new NextResponse("That image is temporarily unavailable.", { status: 503 })
  }
}

/** Matches the gallery set in lib/public/queries.ts. Deliverables never appear. */
const GALLERY_TYPES = new Set([
  "cover_image",
  "preview_image",
  "specimen",
  "screenshot",
  "promotional",
])

function notFound() {
  return new NextResponse("Not found", {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  })
}
