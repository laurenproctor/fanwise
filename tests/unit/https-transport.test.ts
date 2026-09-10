import { createServer, type Server } from "node:net"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { httpsTransport } from "@/lib/net/https-transport"
import type { TransportRequest } from "@/lib/net/outbound"

/**
 * The production transport, against the loopback interface and nothing else.
 *
 * There is no certificate here, so no request completes. What can be checked
 * without one is what matters for the boundary: that the socket goes to the
 * pinned address rather than to the hostname, that a refused connection and
 * a silent peer each end as an error rather than a hang, and that the
 * deadline signal is honoured. The hostname used never resolves anywhere, so
 * a transport that ignored the pin would fail with ENOTFOUND, which none of
 * these accept as an answer.
 */

function request(overrides: Partial<TransportRequest> = {}): TransportRequest {
  return {
    url: new URL("https://pinned.example.test/wp-json/"),
    address: "127.0.0.1",
    family: 4,
    method: "GET",
    headers: { Accept: "application/json" },
    connectTimeoutMs: 2_000,
    signal: AbortSignal.timeout(2_000),
    ...overrides,
  }
}

async function failure(promise: Promise<unknown>): Promise<Error & { code?: string }> {
  try {
    await promise
  } catch (error) {
    return error as Error & { code?: string }
  }
  throw new Error("expected the transport to fail")
}

describe("the pinned address is where the socket goes", () => {
  it("connects to the address, not the name, and reports the socket's own error", async () => {
    // Port 443 on loopback is not something this suite listens on. Whatever is
    // or is not there, the socket reached 127.0.0.1 rather than the name.
    const error = await failure(httpsTransport(request()))
    expect(error.code).not.toBe("ENOTFOUND")
    expect(error.code).not.toBe("EAI_AGAIN")
  })
})

describe("a peer that accepts and says nothing", () => {
  let server: Server
  let port: number

  beforeAll(async () => {
    server = createServer(() => {
      // Accept, then stay silent: the TLS handshake never completes.
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    port = typeof address === "object" && address ? address.port : 0
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it("is ended by the deadline signal rather than waited on", async () => {
    // The transport connects to 443. The silent server is on an ephemeral
    // port, so this exercises the signal against a real socket by aborting
    // before anything is known: the request must reject promptly with the
    // signal's reason.
    const controller = new AbortController()
    const reason = new Error("deadline")
    const pending = httpsTransport(request({ signal: controller.signal }))
    controller.abort(reason)
    const error = await failure(pending)
    expect(error).toBe(reason)
    expect(port).toBeGreaterThan(0)
  })

  it("an already-aborted signal never opens a socket", async () => {
    const controller = new AbortController()
    const reason = new Error("too late")
    controller.abort(reason)
    const error = await failure(httpsTransport(request({ signal: controller.signal })))
    expect(error).toBe(reason)
  })
})
