import { afterEach, describe, expect, it, vi } from "vitest"
import {
  OutboundError,
  outboundRequest,
  overrideOutboundDefaultsForTests,
  type Transport,
} from "@/lib/net/outbound"
import {
  fetchPage,
  importErrorForStatus,
  isHtmlContentType,
} from "@/lib/imports/retrieval/fetch-page"
import { ImportError } from "@/lib/imports/errors"
import { importerFor } from "@/lib/imports/sources/registry"
import { fetchTransport, PUBLIC_ADDRESS, resetStore } from "./outbound-support"
import {
  DELETED_ARTIFACT,
  EXPIRED_ARTIFACT,
  JS_SHELL,
  ORGANIZATION_ARTIFACT,
  PRIVATE_ARTIFACT,
  PUBLIC_ARTIFACT,
  PUBLIC_WEBPAGE,
  htmlResponse,
  oversizedPage,
} from "./import-page-fixtures"

/**
 * Reading a public link, through the real boundary with a scripted socket.
 *
 * Nothing here is mocked above the wire. The URL checks, the address checks,
 * the redirect revalidation, the deadline and the body cap are the production
 * ones; what is scripted is DNS and the bytes that come back. So a test that
 * says "a redirect into a private network is refused" is a test of the code
 * that will refuse it in production, not of a stand-in.
 */

const ARTIFACT_URL = "https://claude.ai/code/artifact/3f2e8c4e-7d4b"
const PAGE_URL = "https://example.com/products/aster-grotesk"

/** A private address, for the rebinding and redirect tests. */
const PRIVATE_ADDRESS = "169.254.169.254"

afterEach(() => {
  resetStore()
  vi.restoreAllMocks()
})

/** Scripts DNS per host, so one host can resolve somewhere it must not. */
function scriptHosts(
  answers: (url: string, headers: Record<string, string>) => Response,
  addresses: Record<string, string> = {},
): { headersSeen: Record<string, string>[] } {
  const headersSeen: Record<string, string>[] = []
  const transport: Transport = async (request) => {
    headersSeen.push({ ...request.headers })
    const response = answers(request.url.toString(), request.headers)
    return {
      status: response.status,
      headers: response.headers,
      body: response.body ?? (async function* () {})(),
    }
  }

  overrideOutboundDefaultsForTests({
    resolve: async (hostname) => [{ address: addresses[hostname] ?? PUBLIC_ADDRESS, family: 4 }],
    transport,
  })

  return { headersSeen }
}

describe("reading a page", () => {
  it("returns the markup, the status and where it came from", async () => {
    scriptHosts(() => htmlResponse(PUBLIC_ARTIFACT))

    const page = await fetchPage(ARTIFACT_URL)

    expect(page.status).toBe(200)
    expect(page.resolvedUrl).toBe(ARTIFACT_URL)
    expect(page.redirects).toEqual([])
    expect(page.html).toContain("Type Scale Studio")
  })

  it("sends an honest user agent and nothing that identifies anybody", async () => {
    const { headersSeen } = scriptHosts(() => htmlResponse(PUBLIC_WEBPAGE))
    await fetchPage(PAGE_URL)

    const sent = headersSeen[0]!
    // The exact set, asserted as a set. The day somebody adds "just the
    // referer" is the day a signed URL leaks into a stranger's access log.
    expect(Object.keys(sent).sort()).toEqual(["accept", "user-agent"])
    expect(sent["user-agent"]).toContain("FanwiseImporter")
    // Not a browser string. Disguising this is the first step of bypassing bot
    // protection, and it is the step that makes every later one look reasonable.
    expect(sent["user-agent"]).not.toMatch(/Mozilla|Chrome|Safari/)
  })

  it("refuses anything that is not a page", async () => {
    scriptHosts(
      () =>
        new Response(Buffer.from([0x50, 0x4b, 0x03, 0x04]), {
          status: 200,
          headers: { "content-type": "application/zip" },
        }),
    )

    await expect(fetchPage(PAGE_URL)).rejects.toMatchObject({ code: "not_html" })
  })

  it("maps every status a host can answer with to a code, never to a number", async () => {
    const cases: Array<[number, string]> = [
      [401, "login_required"],
      [403, "login_required"],
      [404, "not_found"],
      [410, "not_found"],
      [429, "provider_error"],
      [500, "provider_error"],
      [503, "provider_error"],
    ]

    for (const [status, code] of cases) {
      expect(importErrorForStatus(status), String(status)).toBe(code)

      scriptHosts(() => htmlResponse("<html></html>", status))
      const error = await fetchPage(PAGE_URL).catch((caught: unknown) => caught)
      expect(error, String(status)).toBeInstanceOf(ImportError)
      expect((error as ImportError).code, String(status)).toBe(code)
      // Rule 8: the creator reads Fanwise's words, never the status line.
      expect((error as ImportError).userMessage).not.toMatch(/\d{3}/)
    }
  })

  it("knows a page from a file", () => {
    expect(isHtmlContentType("text/html")).toBe(true)
    expect(isHtmlContentType("text/html; charset=utf-8")).toBe(true)
    expect(isHtmlContentType("application/xhtml+xml")).toBe(true)
    expect(isHtmlContentType("application/pdf")).toBe(false)
    expect(isHtmlContentType(null)).toBe(false)
  })
})

describe("what the boundary refuses before a socket opens", () => {
  it("refuses a URL that is not on the public internet", async () => {
    scriptHosts(() => htmlResponse(PUBLIC_WEBPAGE))

    for (const url of [
      "https://localhost/x",
      "https://127.0.0.1/x",
      "https://169.254.169.254/latest/meta-data/",
      "https://box.internal/x",
      "https://example.com:8443/x",
      "http://example.com/x",
      "https://user:secret@example.com/x",
    ]) {
      const error = await fetchPage(url).catch((caught: unknown) => caught)
      expect(error, url).toBeInstanceOf(ImportError)
      expect(["blocked_address", "unsupported_source"], url).toContain((error as ImportError).code)
    }
  })

  it("refuses a public name that resolves to a private address", async () => {
    // DNS rebinding, and the reason the boundary resolves once and pins: the
    // name is ordinary, the address is not, and the check is on the address.
    scriptHosts(() => htmlResponse(PUBLIC_WEBPAGE), { "example.com": PRIVATE_ADDRESS })

    await expect(fetchPage(PAGE_URL)).rejects.toMatchObject({ code: "blocked_address" })
  })
})

describe("redirects", () => {
  it("follows one and records where the body came from", async () => {
    scriptHosts((url) =>
      url === PAGE_URL
        ? new Response(null, { status: 301, headers: { location: "https://example.com/final" } })
        : htmlResponse(PUBLIC_WEBPAGE),
    )

    const page = await fetchPage(PAGE_URL)

    expect(page.resolvedUrl).toBe("https://example.com/final")
    expect(page.redirects).toEqual(["https://example.com/final"])
  })

  it("re-checks every hop, so a redirect into a private network is refused", async () => {
    // The whole point of revalidating rather than following: the first URL is
    // unimpeachable and the second is the attack.
    scriptHosts(
      (url) =>
        url === PAGE_URL
          ? new Response(null, {
              status: 302,
              headers: { location: "https://metadata.example.net/latest" },
            })
          : htmlResponse(PUBLIC_WEBPAGE),
      { "metadata.example.net": PRIVATE_ADDRESS },
    )

    await expect(fetchPage(PAGE_URL)).rejects.toMatchObject({ code: "blocked_address" })
  })

  it("refuses a redirect to a scheme or port the first request could not have used", async () => {
    for (const location of ["http://example.com/x", "https://example.com:8443/x", "ftp://x/y"]) {
      scriptHosts((url) =>
        url === PAGE_URL
          ? new Response(null, { status: 307, headers: { location } })
          : htmlResponse(PUBLIC_WEBPAGE),
      )
      const error = await fetchPage(PAGE_URL).catch((caught: unknown) => caught)
      expect(error, location).toBeInstanceOf(ImportError)
      expect((error as ImportError).code, location).toBe("blocked_address")
    }
  })

  it("stops after the budget rather than following a loop for ever", async () => {
    scriptHosts((url) => {
      const hop = Number(new URL(url).searchParams.get("hop") ?? "0")
      return new Response(null, {
        status: 302,
        headers: { location: `https://example.com/x?hop=${hop + 1}` },
      })
    })

    await expect(fetchPage("https://example.com/x?hop=0")).rejects.toMatchObject({
      code: "too_many_redirects",
    })
  })

  it("drops a secret-bearing header the moment the origin changes", async () => {
    const { headersSeen } = scriptHosts((url) =>
      url === PAGE_URL
        ? new Response(null, { status: 302, headers: { location: "https://elsewhere.test/x" } })
        : htmlResponse(PUBLIC_WEBPAGE),
    )

    // fetchPage never sends one; the boundary is asked directly, because this
    // is a property of the boundary that every future caller inherits.
    await outboundRequest(
      PAGE_URL,
      { headers: { authorization: "Bearer secret", cookie: "session=1", accept: "text/html" } },
      { maxRedirects: 2 },
    )

    expect(headersSeen[0]).toMatchObject({ authorization: "Bearer secret" })
    expect(headersSeen[1]).not.toHaveProperty("authorization")
    expect(headersSeen[1]).not.toHaveProperty("cookie")
    // What is not a secret survives.
    expect(headersSeen[1]).toMatchObject({ accept: "text/html" })
  })

  it("still refuses a redirect outright when no budget was asked for", async () => {
    // The default every channel adapter uses, unchanged by this feature.
    scriptHosts(() => new Response(null, { status: 302, headers: { location: "https://a.test/" } }))

    await expect(outboundRequest(PAGE_URL, {}, {})).rejects.toBeInstanceOf(OutboundError)
  })
})

describe("size and time", () => {
  it("refuses a body larger than the cap", async () => {
    scriptHosts(() => htmlResponse(oversizedPage(3 * 1024 * 1024)))

    await expect(fetchPage(PAGE_URL)).rejects.toMatchObject({ code: "too_large" })
  })

  it("refuses a declared length larger than the cap without reading it", async () => {
    scriptHosts(() =>
      htmlResponse("<html></html>", 200, { "content-length": String(50 * 1024 * 1024) }),
    )

    await expect(fetchPage(PAGE_URL)).rejects.toMatchObject({ code: "too_large" })
  })

  it("gives up on a host that never answers", async () => {
    overrideOutboundDefaultsForTests({
      resolve: async () => [{ address: PUBLIC_ADDRESS, family: 4 }],
      transport: (request) =>
        new Promise((_resolve, reject) => {
          request.signal.addEventListener("abort", () => reject(request.signal.reason))
        }),
    })

    await expect(
      // A one-millisecond deadline rather than a slow test.
      outboundRequest(PAGE_URL, {}, { responseTimeoutMs: 1 }),
    ).rejects.toMatchObject({ kind: "timeout" })
  })
})

describe("what each kind of artifact page means", () => {
  async function readArtifact(html: string, status = 200) {
    resetStore()
    overrideOutboundDefaultsForTests({
      resolve: async () => [{ address: PUBLIC_ADDRESS, family: 4 }],
      transport: fetchTransport(async () => htmlResponse(html, status)),
    })
    const page = await fetchPage(ARTIFACT_URL)
    return importerFor(new URL(ARTIFACT_URL)).read(page, ARTIFACT_URL)
  }

  it("reads a published one into evidence", async () => {
    const evidence = await readArtifact(PUBLIC_ARTIFACT)

    expect(evidence.provider).toBe("hosted_artifact")
    expect(evidence.title?.value).toBe("Type Scale Studio")
    expect(evidence.title?.origin).toBe("og")
    expect(evidence.publicDemoAvailable).toBe(true)
    expect(evidence.contentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(evidence.visibleFeatures.value).toContain("Export to Figma, CSS and Tailwind")
  })

  it("never reads a heading out of a script", async () => {
    const evidence = await readArtifact(PUBLIC_ARTIFACT)
    const everything = JSON.stringify(evidence)

    expect(everything).not.toContain("injected heading")
  })

  it("refuses a sign-in wall that answers 200", async () => {
    await expect(readArtifact(PRIVATE_ARTIFACT)).rejects.toMatchObject({ code: "login_required" })
  })

  it("tells an organization boundary from a sign-in wall", async () => {
    await expect(readArtifact(ORGANIZATION_ARTIFACT)).rejects.toMatchObject({
      code: "organization_only",
    })
  })

  it("refuses an expired link and a deleted one, differently", async () => {
    await expect(readArtifact(EXPIRED_ARTIFACT)).rejects.toMatchObject({ code: "expired" })
    await expect(readArtifact(DELETED_ARTIFACT)).rejects.toMatchObject({ code: "not_found" })
  })

  it("refuses a page that rendered nothing rather than calling it imported", async () => {
    await expect(readArtifact(JS_SHELL)).rejects.toMatchObject({ code: "unsupported_source" })
  })

  it("never reports a refusal as a successful import", async () => {
    for (const html of [
      PRIVATE_ARTIFACT,
      ORGANIZATION_ARTIFACT,
      EXPIRED_ARTIFACT,
      DELETED_ARTIFACT,
      JS_SHELL,
    ]) {
      await expect(readArtifact(html)).rejects.toBeInstanceOf(ImportError)
    }
  })
})
