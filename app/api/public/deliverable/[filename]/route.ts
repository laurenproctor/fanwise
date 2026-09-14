import { NextResponse } from "next/server"
import { createDownloadUrl } from "@/lib/products/storage"
import { resolveDeliverableLink } from "@/lib/publishing/deliverable-links"

/**
 * A buyer file, fetched by a channel that stores downloads as URLs.
 *
 * Nobody is signed in, and nobody ever will be: the caller is a store's own
 * server fetching the file for a buyer it has already checked, or, on a store
 * set to redirect, the buyer's browser. That is why this sits under
 * /api/public, which the proxy lets through without a session. What makes it
 * safe is the token, and nothing else in the request is trusted.
 *
 * Unlike the image route beside it, the address is a bearer capability. Anyone
 * holding it gets the file, and that is the design: it is handed only to the
 * channel, lives only in the store's product data, and a store in its default
 * download mode fetches it server-side so the buyer never sees it. Everything
 * that limits it is re-derived here per request, in
 * lib/publishing/deliverable-links.ts: a revoked address, a deleted listing or
 * asset, or an asset that is no longer a ready buyer file all answer 404.
 *
 * The `[filename]` segment is cosmetic. A store names the buyer's download
 * after the address's last segment, so it carries the real filename; the
 * token in the query string is what is served.
 *
 * The answer is a redirect to a five-minute signed link with the real filename
 * as its download name, rather than the bytes, because a deliverable can be
 * gigabytes and a function response cannot. The store's fetch follows it.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? ""

  const { createAdminClient } = await import("@/lib/supabase/admin")
  const resolved = await resolveDeliverableLink(createAdminClient(), token)
  if (!resolved) return notFound()

  try {
    const signedUrl = await createDownloadUrl(resolved.storagePath, resolved.filename)
    const response = NextResponse.redirect(signedUrl, 307)
    // Never cached. A cached redirect would outlive a revocation, and it would
    // hand one buyer's fetch a signature minted for another.
    response.headers.set("Cache-Control", "no-store")
    response.headers.set("Referrer-Policy", "no-referrer")
    response.headers.set("X-Robots-Tag", "noindex, nofollow")
    return response
  } catch (cause) {
    console.error("[public] could not mint a deliverable URL", cause)
    return new NextResponse("That file is temporarily unavailable.", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    })
  }
}

// One answer for every refusal, so it confirms nothing about which tokens exist.
function notFound() {
  return new NextResponse("Not found", {
    status: 404,
    headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
  })
}
