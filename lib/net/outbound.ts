import { promises as dns } from "node:dns"
import { isIP } from "node:net"
import { isBlockedAddress, type Family, type ResolvedAddress } from "./addresses"

export type { Family, ResolvedAddress } from "./addresses"

/**
 * The outbound-request boundary.
 *
 * Every server request to a host a creator named goes through here. The
 * caller passes a URL and gets a `Response`, the way it would from `fetch`;
 * what happens in between is the point:
 *
 *   1. The URL is checked. HTTPS only, no credentials in it, no port but 443,
 *      and a hostname that is a public DNS name or a public address literal.
 *   2. The hostname is resolved here, once, and every address it yields is
 *      checked against `lib/net/addresses`. One private, loopback, link-local,
 *      multicast, reserved or metadata address among them refuses the whole
 *      request.
 *   3. The connection is made to the address that was checked. The transport
 *      never resolves the name again, so a record that changes between the
 *      check and the connect (DNS rebinding) changes nothing.
 *   4. No redirect is followed. A 3xx is an error, so a credential sent to
 *      one origin is never re-sent to another.
 *   5. A connect timeout, a deadline for the whole exchange, and a cap on the
 *      body. A slow or enormous answer is an error, not a stuck job.
 *
 * Errors are `OutboundError`s with a `kind` the caller can map into its own
 * vocabulary. They carry the hostname and the kind and nothing else: no
 * header, no body, no URL with anything in it. The adapter that called is
 * the one that knows what to tell a creator.
 *
 * Nothing here knows which channel is calling. A provider name in this
 * directory is a test failure (`tests/unit/channel-boundaries.test.ts`).
 *
 * The resolver and the transport are injectable, so the whole policy can be
 * tested with scripted DNS and a scripted server. Production passes nothing
 * and gets `dns.lookup` and the `node:https` transport.
 */

export type OutboundRefusal =
  | "invalid_url"
  | "scheme"
  | "credentials"
  | "port"
  | "hostname"
  | "unresolvable"
  | "address_blocked"
  | "redirect"
  | "timeout"
  | "body_too_large"
  | "network"

/** Kinds worth trying again: the destination was allowed and did not answer. */
const RETRYABLE: ReadonlySet<OutboundRefusal> = new Set(["unresolvable", "timeout", "network"])

export class OutboundError extends Error {
  readonly kind: OutboundRefusal

  constructor(kind: OutboundRefusal, message: string) {
    super(message)
    this.name = "OutboundError"
    this.kind = kind
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.kind)
  }
}

export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>

export interface TransportRequest {
  /** The validated URL. Credentials, if any were present, were refused. */
  url: URL
  /** The one address the transport may connect to. */
  address: string
  family: Family
  method: string
  headers: Record<string, string>
  body?: string
  connectTimeoutMs: number
  /** Aborts on the response deadline. The transport destroys its socket. */
  signal: AbortSignal
}

export interface TransportResponse {
  status: number
  headers: Headers
  body: AsyncIterable<Uint8Array>
}

export type Transport = (request: TransportRequest) => Promise<TransportResponse>

export interface OutboundInit {
  method?: string
  headers?: Record<string, string>
  body?: string
}

export interface OutboundOptions {
  resolve?: Resolver
  transport?: Transport
  /** Time to open the socket. */
  connectTimeoutMs?: number
  /** Time for the whole exchange, from the first byte sent to the last received. */
  responseTimeoutMs?: number
  /** The most body the caller will be handed. */
  maxBodyBytes?: number
}

export const OUTBOUND_DEFAULTS = {
  connectTimeoutMs: 10_000,
  responseTimeoutMs: 30_000,
  maxBodyBytes: 5 * 1024 * 1024,
} as const

const REDIRECT = new Set([301, 302, 303, 307, 308])
const NO_BODY = new Set([204, 205, 304])

/**
 * A public DNS name: labels, at least one dot, an alphabetic top-level label.
 * Single-label names resolve through search domains, which is a way to reach
 * a neighbour by a name that looks harmless.
 */
const DNS_NAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/

/** Suffixes that name this machine or this network by convention. */
const LOCAL_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".localdomain",
  ".home.arpa",
  ".in-addr.arpa",
  ".ip6.arpa",
]

async function defaultResolve(hostname: string): Promise<ResolvedAddress[]> {
  const found = await dns.lookup(hostname, { all: true, verbatim: true })
  return found
    .filter(
      (entry): entry is { address: string; family: 4 | 6 } =>
        entry.family === 4 || entry.family === 6,
    )
    .map((entry) => ({ address: entry.address, family: entry.family }))
}

let defaultTransport: Transport | null = null

async function loadDefaultTransport(): Promise<Transport> {
  if (!defaultTransport) {
    // Lazy so that a caller with an injected transport never touches
    // node:https, and so this module has no import cycle with the transport.
    const { httpsTransport } = await import("./https-transport")
    defaultTransport = httpsTransport
  }
  return defaultTransport
}

interface Defaults {
  resolve: Resolver
  transport: Transport | null
}

const productionDefaults: Defaults = { resolve: defaultResolve, transport: null }
let defaults: Defaults = productionDefaults

/**
 * Test seam. The adapters build their clients without a way to hand a
 * transport through, and their tests script the store; this is how they do
 * it. Production never calls this.
 */
export function overrideOutboundDefaultsForTests(override: {
  resolve?: Resolver
  transport?: Transport
}): void {
  defaults = {
    resolve: override.resolve ?? productionDefaults.resolve,
    transport: override.transport ?? null,
  }
}

export function resetOutboundDefaultsForTests(): void {
  defaults = productionDefaults
}

/** The checks that need no network: shape, scheme, credentials, port, name. */
export function validateOutboundUrl(input: string): URL {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new OutboundError("invalid_url", "the request URL could not be parsed")
  }

  if (url.protocol !== "https:") {
    throw new OutboundError("scheme", "outbound requests are https only")
  }
  if (url.username !== "" || url.password !== "") {
    throw new OutboundError("credentials", "outbound URLs may not carry credentials")
  }
  // The URL parser drops an explicit :443; anything left is another port.
  if (url.port !== "") {
    throw new OutboundError("port", "outbound requests use port 443 only")
  }

  const hostname = literalHostname(url)
  if (hostname === null) {
    throw new OutboundError("hostname", "the request has no usable hostname")
  }
  if (isIP(hostname) !== 0) {
    if (isBlockedAddress(hostname)) {
      throw new OutboundError("address_blocked", `${hostname} is not a public address`)
    }
    return url
  }
  if (
    hostname === "localhost" ||
    LOCAL_SUFFIXES.some((suffix) => hostname.endsWith(suffix)) ||
    !DNS_NAME.test(hostname)
  ) {
    throw new OutboundError("hostname", `${hostname} is not a public host name`)
  }
  return url
}

/** The hostname without IPv6 brackets or a trailing dot, lower-cased. */
function literalHostname(url: URL): string | null {
  const raw = url.hostname
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1")
    .replace(/\.$/, "")
  return raw.length === 0 ? null : raw
}

/** Resolves the hostname and refuses if any address it yields is off limits. */
async function pin(url: URL, resolve: Resolver): Promise<ResolvedAddress> {
  const hostname = literalHostname(url)!
  const family = isIP(hostname)
  if (family === 4 || family === 6) return { address: hostname, family }

  let addresses: ResolvedAddress[]
  try {
    addresses = await resolve(hostname)
  } catch {
    throw new OutboundError("unresolvable", `${hostname} could not be resolved`)
  }
  if (addresses.length === 0) {
    throw new OutboundError("unresolvable", `${hostname} resolved to nothing`)
  }
  const offending = addresses.find((entry) => isBlockedAddress(entry.address))
  if (offending) {
    throw new OutboundError("address_blocked", `${hostname} resolves to a non-public address`)
  }
  return addresses[0]!
}

export async function outboundFetch(
  input: string,
  init: OutboundInit = {},
  options: OutboundOptions = {},
): Promise<Response> {
  const url = validateOutboundUrl(input)
  const resolve = options.resolve ?? defaults.resolve
  const transport = options.transport ?? defaults.transport ?? (await loadDefaultTransport())
  const connectTimeoutMs = options.connectTimeoutMs ?? OUTBOUND_DEFAULTS.connectTimeoutMs
  const responseTimeoutMs = options.responseTimeoutMs ?? OUTBOUND_DEFAULTS.responseTimeoutMs
  const maxBodyBytes = options.maxBodyBytes ?? OUTBOUND_DEFAULTS.maxBodyBytes
  const hostname = literalHostname(url)!

  const pinned = await pin(url, resolve)

  const controller = new AbortController()
  const deadline = setTimeout(() => {
    controller.abort(new OutboundError("timeout", `${hostname} did not answer in time`))
  }, responseTimeoutMs)

  try {
    let response: TransportResponse
    try {
      response = await transport({
        url,
        address: pinned.address,
        family: pinned.family,
        method: init.method ?? "GET",
        headers: init.headers ?? {},
        ...(init.body === undefined ? {} : { body: init.body }),
        connectTimeoutMs,
        signal: controller.signal,
      })
    } catch (error) {
      throw asOutboundError(error, controller.signal, hostname)
    }

    if (REDIRECT.has(response.status)) {
      controller.abort(new OutboundError("redirect", `${hostname} redirected the request`))
      throw new OutboundError("redirect", `${hostname} redirected the request`)
    }
    if (response.status < 200 || response.status > 599) {
      throw new OutboundError("network", `${hostname} answered with an unusable status`)
    }

    const declared = Number(response.headers.get("content-length") ?? "")
    if (Number.isFinite(declared) && declared > maxBodyBytes) {
      controller.abort(new OutboundError("body_too_large", `${hostname} answered with too much`))
      throw new OutboundError("body_too_large", `${hostname} answered with too much`)
    }

    const body = await collect(response.body, maxBodyBytes, controller, hostname)
    return new Response(NO_BODY.has(response.status) ? null : body, {
      status: response.status,
      headers: response.headers,
    })
  } finally {
    clearTimeout(deadline)
  }
}

async function collect(
  body: AsyncIterable<Uint8Array>,
  maxBodyBytes: number,
  controller: AbortController,
  hostname: string,
): Promise<Buffer<ArrayBuffer>> {
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    for await (const chunk of body) {
      received += chunk.byteLength
      if (received > maxBodyBytes) {
        const error = new OutboundError("body_too_large", `${hostname} answered with too much`)
        controller.abort(error)
        throw error
      }
      chunks.push(chunk)
    }
  } catch (error) {
    throw asOutboundError(error, controller.signal, hostname)
  }
  return Buffer.concat(chunks)
}

/**
 * Whatever escaped the transport or the body read, as an `OutboundError`.
 * The signal's reason wins, because a socket destroyed on the deadline
 * reports itself as any of several errors and the deadline is the truth.
 * Nothing from the original is kept but its code: an error from a socket
 * can hold the request that was written to it.
 */
function asOutboundError(error: unknown, signal: AbortSignal, hostname: string): OutboundError {
  if (signal.aborted && signal.reason instanceof OutboundError) return signal.reason
  if (error instanceof OutboundError) return error
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "unknown"
  return new OutboundError("network", `could not complete the request to ${hostname} (${code})`)
}
