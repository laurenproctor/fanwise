import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The public download route (ADR 0012), with the database and storage replaced.
 * What is pinned is the route's own contract: every refusal is the same 404, a
 * good token is a redirect to a short-lived link that is never cached, and a
 * HEAD neither mints a link nor counts a use.
 */

const resolveDeliveryToken = vi.fn()
const recordDeliveryUse = vi.fn(async (_linkId: string) => {})
const createDownloadUrl = vi.fn(
  async (_path: string, _filename: string) => "https://storage.example/signed/aster.zip?token=abc",
)

vi.mock("@/lib/delivery/links", () => ({
  resolveDeliveryToken: (token: string) => resolveDeliveryToken(token),
  recordDeliveryUse: (id: string) => recordDeliveryUse(id),
}))
vi.mock("@/lib/products/storage", () => ({
  createDownloadUrl: (path: string, name: string) => createDownloadUrl(path, name),
}))

const { GET, HEAD } = await import("@/app/api/public/delivery/[token]/route")

const params = (token: string) => ({ params: Promise.resolve({ token }) })
const request = new Request("https://fanwise.test/api/public/delivery/x")

beforeEach(() => {
  resolveDeliveryToken.mockReset()
  recordDeliveryUse.mockClear()
  createDownloadUrl.mockClear()
})

describe("the public download route", () => {
  it("answers every refusal with the same uncached 404", async () => {
    resolveDeliveryToken.mockResolvedValue(null)
    const response = await GET(request, params("anything"))
    expect(response.status).toBe(404)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(createDownloadUrl).not.toHaveBeenCalled()
  })

  it("redirects a good token to a named, short-lived download and records the use", async () => {
    resolveDeliveryToken.mockResolvedValue({
      linkId: "link-1",
      storagePath: "ws/product/asset.zip",
      filename: "aster.zip",
    })
    const response = await GET(request, params("good"))
    expect(response.status).toBe(302)
    expect(response.headers.get("Location")).toBe(
      "https://storage.example/signed/aster.zip?token=abc",
    )
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer")
    expect(createDownloadUrl).toHaveBeenCalledWith("ws/product/asset.zip", "aster.zip")
    expect(recordDeliveryUse).toHaveBeenCalledWith("link-1")
  })

  it("checks a token on HEAD without minting a link or counting a use", async () => {
    resolveDeliveryToken.mockResolvedValue({
      linkId: "link-1",
      storagePath: "ws/product/asset.zip",
      filename: "aster.zip",
    })
    const response = await HEAD(request, params("good"))
    expect(response.status).toBe(200)
    expect(createDownloadUrl).not.toHaveBeenCalled()
    expect(recordDeliveryUse).not.toHaveBeenCalled()
  })
})
