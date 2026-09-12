import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib"
import { describe, expect, it, vi } from "vitest"
import { embeddedIpv4, isBlockedAddress } from "@/lib/net/addresses"
import {
  OUTBOUND_DEFAULTS,
  OutboundError,
  outboundFetch,
  validateOutboundUrl,
  type ResolvedAddress,
  type Transport,
  type TransportRequest,
} from "@/lib/net/outbound"

/**
 * The outbound-request boundary, with DNS and the socket both scripted.
 *
 * Every test here is a way a hostname a creator typed could have made the
 * server talk to something it must not, or a way a server that was allowed
 * could have kept a job hung or fed it more than it can hold. The boundary
 * is the only thing between an adapter and those outcomes, so the tests are
 * the specification.
 */

const PUBLIC_V4 = "93.184.216.34"
const PUBLIC_V6 = "2606:2800:220:1:248:1893:25c8:1946"

function resolving(...addresses: ResolvedAddress[]) {
  return vi.fn(async () => addresses)
}

const publicV4 = () => resolving({ address: PUBLIC_V4, family: 4 })

async function* bytes(...chunks: string[]) {
  for (const chunk of chunks) yield Buffer.from(chunk)
}

/** A transport that answers with a fixed response and records what it was asked. */
function answering(
  status: number,
  body = "{}",
  headers: Record<string, string> = { "content-type": "application/json" },
) {
  const calls: TransportRequest[] = []
  const transport: Transport = async (request) => {
    calls.push(request)
    return { status, headers: new Headers(headers), body: bytes(body) }
  }
  return { transport, calls }
}

async function refusal(promise: Promise<unknown>): Promise<OutboundError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof OutboundError) return error
    throw error
  }
  throw new Error("expected the boundary to refuse")
}

describe("the URL is checked before anything is resolved", () => {
  const kinds: Array<[string, string]> = [
    ["not a url", "invalid_url"],
    ["http://shop.example.com/wp-json", "scheme"],
    ["ftp://shop.example.com/", "scheme"],
    ["https://ck_live:cs_live@shop.example.com/", "credentials"],
    ["https://shop.example.com:8443/", "port"],
    ["https://shop.example.com:80/", "port"],
    ["https://localhost/", "hostname"],
    ["https://LOCALHOST/", "hostname"],
    ["https://shop.localhost/", "hostname"],
    ["https://printer.local/", "hostname"],
    ["https://db.internal/", "hostname"],
    ["https://router.home.arpa/", "hostname"],
    ["https://intranet/", "hostname"],
    ["https://1.0.0.127.in-addr.arpa/", "hostname"],
    ["https://shop_1.example.com/", "hostname"],
  ]

  it.each(kinds)("%s is refused as %s", async (url, kind) => {
    const resolve = publicV4()
    const error = await refusal(
      outboundFetch(url, {}, { resolve, transport: answering(200).transport }),
    )
    expect(error.kind).toBe(kind)
    expect(resolve).not.toHaveBeenCalled()
  })

  it("an explicit :443 is the default port and is allowed", () => {
    expect(validateOutboundUrl("https://shop.example.com:443/x").port).toBe("")
  })

  it("a trailing dot is a fully qualified name, resolved without it", async () => {
    const resolve = publicV4()
    await outboundFetch(
      "https://shop.example.com./",
      {},
      { resolve, transport: answering(200).transport },
    )
    expect(resolve).toHaveBeenCalledWith("shop.example.com")
  })
})

describe("address literals never reach the resolver", () => {
  const blocked = [
    "https://127.0.0.1/",
    "https://127.1.2.3/",
    "https://0.0.0.0/",
    "https://10.0.0.5/",
    "https://172.16.0.1/",
    "https://172.31.255.254/",
    "https://192.168.1.1/",
    "https://169.254.169.254/latest/meta-data/",
    "https://100.100.100.200/",
    "https://168.63.129.16/",
    "https://224.0.0.1/",
    "https://255.255.255.255/",
    "https://192.0.2.10/",
    "https://198.18.0.1/",
    // The URL parser normalises the shorthand and integer spellings.
    "https://2130706433/",
    "https://0x7f.0.0.1/",
    "https://0177.0.0.1/",
    "https://[::1]/",
    "https://[::]/",
    "https://[fd00:ec2::254]/",
    "https://[fe80::1]/",
    "https://[fc00::1]/",
    "https://[ff02::1]/",
    "https://[2001:db8::1]/",
    "https://[::ffff:127.0.0.1]/",
    "https://[::ffff:7f00:1]/",
    "https://[::ffff:a9fe:a9fe]/",
    "https://[64:ff9b::7f00:1]/",
    "https://[::127.0.0.1]/",
    "https://[2002:7f00:1::]/",
  ]

  it.each(blocked)("%s is refused as address_blocked", async (url) => {
    const resolve = publicV4()
    const error = await refusal(
      outboundFetch(url, {}, { resolve, transport: answering(200).transport }),
    )
    expect(error.kind).toBe("address_blocked")
    expect(resolve).not.toHaveBeenCalled()
  })

  it("a public literal is pinned as itself", async () => {
    const resolve = publicV4()
    const { transport, calls } = answering(200)
    await outboundFetch(`https://${PUBLIC_V4}/`, {}, { resolve, transport })
    expect(resolve).not.toHaveBeenCalled()
    expect(calls[0]?.address).toBe(PUBLIC_V4)
    expect(calls[0]?.family).toBe(4)
  })

  it("a public IPv6 literal is pinned as itself", async () => {
    const { transport, calls } = answering(200)
    await outboundFetch(`https://[${PUBLIC_V6}]/`, {}, { resolve: publicV4(), transport })
    expect(calls[0]?.address).toBe(PUBLIC_V6)
    expect(calls[0]?.family).toBe(6)
  })
})

describe("the name is resolved here and every answer is judged", () => {
  const cases: Array<[string, ResolvedAddress[]]> = [
    ["a loopback record", [{ address: "127.0.0.1", family: 4 }]],
    ["a private record", [{ address: "10.20.30.40", family: 4 }]],
    ["a link-local record", [{ address: "169.254.169.254", family: 4 }]],
    ["a carrier-NAT record", [{ address: "100.64.0.1", family: 4 }]],
    ["a unique-local IPv6 record", [{ address: "fd12::1", family: 6 }]],
    ["an IPv6 loopback record", [{ address: "::1", family: 6 }]],
    ["an IPv4-mapped private record", [{ address: "::ffff:192.168.0.1", family: 6 }]],
    ["an IPv4-mapped hex private record", [{ address: "::ffff:c0a8:1", family: 6 }]],
    ["a NAT64 record for loopback", [{ address: "64:ff9b::7f00:1", family: 6 }]],
    [
      "a public record beside a private one",
      [
        { address: PUBLIC_V4, family: 4 },
        { address: "10.0.0.1", family: 4 },
      ],
    ],
    [
      "a private record beside a public one",
      [
        { address: "192.168.1.1", family: 4 },
        { address: PUBLIC_V4, family: 4 },
      ],
    ],
    ["a record that is not an address", [{ address: "not-an-address", family: 4 }]],
    ["a zoned link-local record", [{ address: "fe80::1%eth0", family: 6 }]],
  ]

  it.each(cases)("%s refuses the request", async (_label, addresses) => {
    const { transport, calls } = answering(200)
    const error = await refusal(
      outboundFetch(
        "https://shop.example.com/",
        {},
        { resolve: resolving(...addresses), transport },
      ),
    )
    expect(error.kind).toBe("address_blocked")
    expect(calls).toHaveLength(0)
  })

  it("a name that resolves to nothing is unresolvable, and retryable", async () => {
    const error = await refusal(
      outboundFetch(
        "https://shop.example.com/",
        {},
        { resolve: resolving(), transport: answering(200).transport },
      ),
    )
    expect(error.kind).toBe("unresolvable")
    expect(error.retryable).toBe(true)
  })

  it("a resolver failure is unresolvable and carries none of the resolver's words", async () => {
    const resolve = vi.fn(async () => {
      throw new Error("ENOTFOUND shop.example.com secret-detail")
    })
    const error = await refusal(
      outboundFetch(
        "https://shop.example.com/",
        {},
        { resolve, transport: answering(200).transport },
      ),
    )
    expect(error.kind).toBe("unresolvable")
    expect(error.message).not.toContain("secret-detail")
  })

  it("a public IPv6 record is allowed and pinned with its family", async () => {
    const { transport, calls } = answering(200)
    await outboundFetch(
      "https://shop.example.com/",
      {},
      { resolve: resolving({ address: PUBLIC_V6, family: 6 }), transport },
    )
    expect(calls[0]?.address).toBe(PUBLIC_V6)
    expect(calls[0]?.family).toBe(6)
  })
})

describe("the connection goes to the address that was checked", () => {
  it("pins the resolved address and keeps the hostname for TLS", async () => {
    const { transport, calls } = answering(200)
    await outboundFetch(
      "https://shop.example.com/wp-json/wc/v3/products?per_page=1",
      { method: "GET", headers: { Authorization: "Basic abc" } },
      { resolve: publicV4(), transport },
    )
    expect(calls).toHaveLength(1)
    const request = calls[0]!
    expect(request.address).toBe(PUBLIC_V4)
    expect(request.url.hostname).toBe("shop.example.com")
    expect(request.url.pathname).toBe("/wp-json/wc/v3/products")
    expect(request.url.search).toBe("?per_page=1")
    expect(request.method).toBe("GET")
    expect(request.headers.Authorization).toBe("Basic abc")
  })

  it("resolves once, so a record that changes afterwards changes nothing", async () => {
    let calls = 0
    const rebinding = vi.fn(async (): Promise<ResolvedAddress[]> => {
      calls += 1
      return calls === 1
        ? [{ address: PUBLIC_V4, family: 4 }]
        : [{ address: "169.254.169.254", family: 4 }]
    })
    const seen = answering(200)
    await outboundFetch(
      "https://shop.example.com/",
      {},
      { resolve: rebinding, transport: seen.transport },
    )
    expect(rebinding).toHaveBeenCalledTimes(1)
    expect(seen.calls[0]?.address).toBe(PUBLIC_V4)
  })

  it("a dotted-path URL is normalised before it is sent", async () => {
    const { transport, calls } = answering(200)
    await outboundFetch(
      "https://shop.example.com/wp-json/wc/v3/../../",
      {},
      { resolve: publicV4(), transport },
    )
    expect(calls[0]?.url.pathname).toBe("/wp-json/")
  })
})

describe("no redirect is followed", () => {
  it.each([301, 302, 303, 307, 308])("a %s is refused and never chased", async (status) => {
    const { transport, calls } = answering(status, "", {
      location: "https://evil.example.net/collect",
    })
    const error = await refusal(
      outboundFetch(
        "https://shop.example.com/",
        { headers: { Authorization: "Basic secret" } },
        { resolve: publicV4(), transport },
      ),
    )
    expect(error.kind).toBe("redirect")
    expect(error.retryable).toBe(false)
    // One request, to the origin that was asked for, and the credential went
    // nowhere else.
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url.hostname).toBe("shop.example.com")
    expect(error.message).not.toContain("evil.example.net")
    expect(error.message).not.toContain("secret")
  })
})

describe("deadlines", () => {
  it("a transport that never answers is a timeout, and retryable", async () => {
    const transport: Transport = (request) =>
      new Promise((_resolve, reject) => {
        request.signal.addEventListener("abort", () => reject(request.signal.reason))
      })
    const error = await refusal(
      outboundFetch(
        "https://shop.example.com/",
        {},
        { resolve: publicV4(), transport, responseTimeoutMs: 30 },
      ),
    )
    expect(error.kind).toBe("timeout")
    expect(error.retryable).toBe(true)
  })

  it("a body that stalls after the headers is a timeout too", async () => {
    let signal: AbortSignal | null = null
    const transport: Transport = async (request) => {
      signal = request.signal
      async function* stalling() {
        yield Buffer.from("{")
        await new Promise<void>((_resolve, reject) => {
          request.signal.addEventListener("abort", () => reject(request.signal.reason))
        })
      }
      return { status: 200, headers: new Headers(), body: stalling() }
    }
    const error = await refusal(
      outboundFetch(
        "https://shop.example.com/",
        {},
        { resolve: publicV4(), transport, responseTimeoutMs: 30 },
      ),
    )
    expect(error.kind).toBe("timeout")
    expect(signal!.aborted).toBe(true)
  })

  it("the transport is told the connect timeout", async () => {
    const { transport, calls } = answering(200)
    await outboundFetch(
      "https://shop.example.com/",
      {},
      { resolve: publicV4(), transport, connectTimeoutMs: 1234 },
    )
    expect(calls[0]?.connectTimeoutMs).toBe(1234)
  })

  it("the defaults are strict", () => {
    expect(OUTBOUND_DEFAULTS.connectTimeoutMs).toBeLessThanOrEqual(10_000)
    expect(OUTBOUND_DEFAULTS.responseTimeoutMs).toBeLessThanOrEqual(30_000)
    expect(OUTBOUND_DEFAULTS.maxBodyBytes).toBeLessThanOrEqual(5 * 1024 * 1024)
  })
})

describe("the body is capped", () => {
  it("a declared length over the cap is refused before a byte is read", async () => {
    let read = false
    const transport: Transport = async () => ({
      status: 200,
      headers: new Headers({ "content-length": "1000" }),
      body: (async function* () {
        read = true
        yield Buffer.alloc(10)
      })(),
    })
    const error = await refusal(
      outboundFetch(
        "https://shop.example.com/",
        {},
        { resolve: publicV4(), transport, maxBodyBytes: 100 },
      ),
    )
    expect(error.kind).toBe("body_too_large")
    expect(error.retryable).toBe(false)
    expect(read).toBe(false)
  })

  it("an undeclared body that grows past the cap is cut off and the socket told to stop", async () => {
    let signal: AbortSignal | null = null
    const transport: Transport = async (request) => {
      signal = request.signal
      return {
        status: 200,
        headers: new Headers(),
        body: (async function* () {
          for (let i = 0; i < 1000; i += 1) yield Buffer.alloc(64)
        })(),
      }
    }
    const error = await refusal(
      outboundFetch(
        "https://shop.example.com/",
        {},
        { resolve: publicV4(), transport, maxBodyBytes: 200 },
      ),
    )
    expect(error.kind).toBe("body_too_large")
    expect(signal!.aborted).toBe(true)
  })
})

describe("a compressed answer is decoded", () => {
  /*
    A server may compress whether or not it was asked to. The store B8's exit
    runs against answers its REST index gzipped even when the request says
    `Accept-Encoding: identity`, and before this the adapter was handed the raw
    deflate stream, failed to parse it, and reported that the provider had
    answered in a shape it did not recognise. The connection was refused and
    the log pointed at the wrong thing entirely.
  */

  function compressed(payload: string, coding: "gzip" | "deflate" | "br") {
    const encode = { gzip: gzipSync, deflate: deflateSync, br: brotliCompressSync }[coding]
    const packed = encode(Buffer.from(payload))
    const transport: Transport = async () => ({
      status: 200,
      headers: new Headers({ "content-type": "application/json", "content-encoding": coding }),
      body: (async function* () {
        yield packed
      })(),
    })
    return { transport, packed }
  }

  it.each(["gzip", "deflate", "br"] as const)("reads a %s body", async (coding) => {
    const { transport } = compressed(JSON.stringify({ name: "House of Proctor" }), coding)
    const response = await outboundFetch(
      "https://shop.example.com/wp-json/",
      {},
      { resolve: publicV4(), transport },
    )
    await expect(response.json()).resolves.toEqual({ name: "House of Proctor" })
  })

  it("leaves an uncompressed body alone, and identity means uncompressed", async () => {
    const cases: Record<string, string>[] = [
      { "content-type": "application/json" },
      { "content-type": "application/json", "content-encoding": "identity" },
    ]
    for (const headers of cases) {
      const { transport } = answering(200, '{"id":1}', headers)
      const response = await outboundFetch(
        "https://shop.example.com/",
        {},
        { resolve: publicV4(), transport },
      )
      await expect(response.json()).resolves.toEqual({ id: 1 })
    }
  })

  it("does not describe the body it hands back as still encoded", async () => {
    // A caller that believed content-encoding would decode twice, and one that
    // believed the compressed content-length would truncate.
    const { transport } = compressed('{"id":1}', "gzip")
    const response = await outboundFetch(
      "https://shop.example.com/",
      {},
      { resolve: publicV4(), transport },
    )
    expect(response.headers.get("content-encoding")).toBeNull()
    expect(response.headers.get("content-length")).toBeNull()
    expect(response.headers.get("content-type")).toBe("application/json")
  })

  it("caps the decompressed size, not just the compressed one", async () => {
    // The whole reason this needs a guard: a small gzip that expands past the
    // cap must be refused, or the cap is decorative.
    const bomb = "a".repeat(5_000_000)
    const { transport, packed } = compressed(bomb, "gzip")
    expect(packed.byteLength).toBeLessThan(100_000)

    const error = await refusal(
      outboundFetch(
        "https://shop.example.com/",
        {},
        { resolve: publicV4(), transport, maxBodyBytes: 100_000 },
      ),
    )
    expect(error.kind).toBe("body_too_large")
  })

  it("refuses an encoding it cannot read rather than passing the bytes on", async () => {
    const { transport } = answering(200, "whatever", {
      "content-type": "application/json",
      "content-encoding": "exotic",
    })
    const error = await refusal(
      outboundFetch("https://shop.example.com/", {}, { resolve: publicV4(), transport }),
    )
    expect(error.kind).toBe("network")
  })

  it("refuses a body that is not the encoding it claims", async () => {
    const { transport } = answering(200, "not gzip at all", {
      "content-type": "application/json",
      "content-encoding": "gzip",
    })
    const error = await refusal(
      outboundFetch("https://shop.example.com/", {}, { resolve: publicV4(), transport }),
    )
    expect(error.kind).toBe("network")
  })
})

describe("what comes back", () => {
  it("is a Response the caller can read the way it reads fetch's", async () => {
    const { transport } = answering(201, JSON.stringify({ id: 9 }), {
      "content-type": "application/json",
      "x-wp-total": "1",
    })
    const response = await outboundFetch(
      "https://shop.example.com/",
      { method: "POST", body: '{"name":"x"}' },
      { resolve: publicV4(), transport },
    )
    expect(response.ok).toBe(true)
    expect(response.status).toBe(201)
    expect(response.headers.get("x-wp-total")).toBe("1")
    expect(await response.json()).toEqual({ id: 9 })
  })

  it("a 204 has no body", async () => {
    const { transport } = answering(204, "")
    const response = await outboundFetch(
      "https://shop.example.com/",
      {},
      { resolve: publicV4(), transport },
    )
    expect(response.status).toBe(204)
    expect(response.body).toBeNull()
  })

  it("a non-2xx is returned for the caller to normalise, not thrown", async () => {
    const { transport } = answering(401, '{"code":"woocommerce_rest_cannot_view"}')
    const response = await outboundFetch(
      "https://shop.example.com/",
      {},
      { resolve: publicV4(), transport },
    )
    expect(response.ok).toBe(false)
    expect(response.status).toBe(401)
    expect(await response.text()).toContain("cannot_view")
  })

  it("a socket error is a network error carrying its code and nothing that was sent", async () => {
    const transport: Transport = async () => {
      const error = new Error("connect ECONNREFUSED 93.184.216.34:443 Authorization: Basic hunter2")
      Object.assign(error, { code: "ECONNREFUSED" })
      throw error
    }
    const error = await refusal(
      outboundFetch(
        "https://shop.example.com/",
        { headers: { Authorization: "Basic hunter2" } },
        { resolve: publicV4(), transport },
      ),
    )
    expect(error.kind).toBe("network")
    expect(error.retryable).toBe(true)
    expect(error.message).toContain("ECONNREFUSED")
    expect(error.message).not.toContain("hunter2")
    expect(error.message).not.toContain("Authorization")
  })
})

describe("the address table", () => {
  it.each([
    "127.0.0.1",
    "10.1.1.1",
    "172.20.0.1",
    "192.168.0.1",
    "169.254.169.254",
    "100.64.1.1",
    "0.0.0.0",
    "224.0.0.5",
    "240.0.0.1",
    "168.63.129.16",
    "::1",
    "::",
    "fe80::1",
    "fd00:ec2::254",
    "ff02::1",
    "2001:db8::1",
    "2001::1",
    "2002:c000:204::",
    "100::1",
    "::ffff:10.0.0.1",
    "::ffff:a00:1",
    "64:ff9b::a00:1",
    "fe80::1%en0",
    "garbage",
  ])("%s is blocked", (address) => {
    expect(isBlockedAddress(address)).toBe(true)
  })

  it.each([
    PUBLIC_V4,
    "8.8.8.8",
    "1.1.1.1",
    PUBLIC_V6,
    "2001:4860:4860::8888",
    `::ffff:${PUBLIC_V4}`,
  ])("%s is allowed", (address) => {
    expect(isBlockedAddress(address)).toBe(false)
  })

  it("unwraps the two prefixes that embed an IPv4 address", () => {
    expect(embeddedIpv4("::ffff:127.0.0.1")).toBe("127.0.0.1")
    expect(embeddedIpv4("::ffff:7f00:1")).toBe("127.0.0.1")
    expect(embeddedIpv4("::FFFF:C0A8:0101")).toBe("192.168.1.1")
    expect(embeddedIpv4("64:ff9b::7f00:1")).toBe("127.0.0.1")
    expect(embeddedIpv4("2001:db8::1")).toBeNull()
    expect(embeddedIpv4("::1")).toBeNull()
  })
})
