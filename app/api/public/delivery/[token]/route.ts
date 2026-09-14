import { NextResponse } from "next/server"
import { recordDeliveryUse, resolveDeliveryToken } from "@/lib/delivery/links"
import { createDownloadUrl } from "@/lib/products/storage"

/**
 * A buyer's download, reached from the storefront that sold it (ADR 0012).
 *
 * Nobody is signed in. The request comes from a buyer's browser, or from the
 * storefront's own server fetching on the buyer's behalf, and neither has a
 * Fanwise session or ever will — which is why the route is under the proxy's
 * public prefix. Nothing in the request is trusted except the token, and the
 * token only names a link: whether that link may still download anything is
 * re-derived from the database on every request (`resolveDeliveryToken`).
 *
 * The answer is a redirect to a storage link that lives five minutes and names
 * the file, so the address a storefront holds never becomes the address of the
 * bytes. Every refusal is the same 404, so a response says nothing about which
 * condition failed or whether a token ever existed.
 */
async function deliver(token: string): Promise<NextResponse> {
  const delivery = await resolveDeliveryToken(token)
  if (!delivery) return notFound()

  try {
    const signedUrl = await createDownloadUrl(delivery.storagePath, delivery.filename)
    void recordDeliveryUse(delivery.linkId).catch(() => {})
    const response = NextResponse.redirect(signedUrl, 302)
    // Never cached: a cached redirect would outlive both a revocation and the
    // five-minute signature it points at.
    response.headers.set("Cache-Control", "no-store")
    response.headers.set("Referrer-Policy", "no-referrer")
    return response
  } catch (cause) {
    console.error("[delivery] could not mint a download URL", cause)
    return new NextResponse("This download is temporarily unavailable. Try again shortly.", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    })
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return deliver(token)
}

/**
 * A storefront may check the address before it saves it. Whether it would
 * download, without minting a link or counting a use.
 */
export async function HEAD(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const delivery = await resolveDeliveryToken(token)
  return new NextResponse(null, {
    status: delivery ? 200 : 404,
    headers: { "Cache-Control": "no-store" },
  })
}

function notFound(): NextResponse {
  return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } })
}
