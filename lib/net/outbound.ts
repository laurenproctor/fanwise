import { promises as dns } from "node:dns"
import { isIP } from "node:net"
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib"
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
 *   4. No redirect is followed unless the caller asks for a budget, and a
 *      followed hop is not a shortcut past any of the above: the `Location` is
 *      re-validated and re-resolved from scratch, so a redirect into a private
 *      address is refused exactly as a direct request to it would be. Any
 *      header that carries a secret is dropped the moment the origin changes,
 *      so a credential sent to one origin is never re-sent to another. With
 *      no budget — the default, and what every channel adapter uses — a 3xx
 *      is still an error.
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
  /**
   * How many redirects to follow. Zero, the default, refuses them.
   *
   * Opt-in rather than on, because every caller until the link importer was an
   * authenticated API client, and for those a 3xx is either a misconfiguration
   * or somebody trying to move a bearer token to a host of their choosing.
   * Reading a page a creator pasted is the one case where a redirect is
   * ordinary: shorteners, canonical hosts and trailing slashes all produce one.
   */
  maxRedirects?: number
}

export const OUTBOUND_DEFAULTS = {
  connectTimeoutMs: 10_000,
  responseTimeoutMs: 30_000,
  maxBodyBytes: 5 * 1024 * 1024,
  maxRedirects: 0,
} as const

/**
 * Request headers that must never survive a change of origin.
 *
 * Lower-cased, compared lower-cased. Nothing in this repository sends any of
 * them through here today; they are dropped anyway, because the cost of being
 * wrong about that later is a credential handed to whoever controls the
 * redirect.
 */
const ORIGIN_BOUND_HEADERS = new Set(["authorization", "cookie", "proxy-authorization"])

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

/** What a request actually did, for a caller that needs to record it. */
export interface OutboundResult {
  response: Response
  /**
   * The URL the body actually came from. Differs from the input only when a
   * redirect was followed, and it is what provenance should record: the page
   * a creator was shown is the one at the end of the chain.
   */
  resolvedUrl: string
  /** Every hop taken, in order, final URL last. Empty when none were. */
  redirects: string[]
}

/**
 * One request, with the whole policy applied, and a record of where it went.
 *
 * `outboundFetch` is this without the record, and is what every caller that
 * does not follow redirects uses.
 */
export async function outboundRequest(
  input: string,
  init: OutboundInit = {},
  options: OutboundOptions = {},
): Promise<OutboundResult> {
  const resolve = options.resolve ?? defaults.resolve
  const transport = options.transport ?? defaults.transport ?? (await loadDefaultTransport())
  const connectTimeoutMs = options.connectTimeoutMs ?? OUTBOUND_DEFAULTS.connectTimeoutMs
  const responseTimeoutMs = options.responseTimeoutMs ?? OUTBOUND_DEFAULTS.responseTimeoutMs
  const maxBodyBytes = options.maxBodyBytes ?? OUTBOUND_DEFAULTS.maxBodyBytes
  const maxRedirects = options.maxRedirects ?? OUTBOUND_DEFAULTS.maxRedirects

  /*
    One deadline for the whole exchange, redirects included. A per-hop deadline
    would let a chain of slow-but-not-timing-out hops run for as long as the
    budget allows multiplied by the number of hops, which is the shape of a
    stuck job that no single timeout ever fires on.
  */
  const controller = new AbortController()
  let deadlineHost = literalHostname(validateOutboundUrl(input)) ?? "the host"
  const deadline = setTimeout(() => {
    controller.abort(new OutboundError("timeout", `${deadlineHost} did not answer in time`))
  }, responseTimeoutMs)

  try {
    let url = validateOutboundUrl(input)
    let headers = { ...(init.headers ?? {}) }
    const redirects: string[] = []

    // <= so that a budget of n follows n redirects and refuses the (n+1)th.
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const hostname = literalHostname(url)!
      deadlineHost = hostname

      /*
        Resolved and checked on every hop, never once for the chain. This is
        the whole defence against a redirect into a private address, and it is
        also why a DNS record that changes between hops cannot help: each hop
        connects to the address this call checked.
      */
      const pinned = await pin(url, resolve)

      let response: TransportResponse
      try {
        response = await transport({
          url,
          address: pinned.address,
          family: pinned.family,
          method: init.method ?? "GET",
          headers,
          ...(init.body === undefined ? {} : { body: init.body }),
          connectTimeoutMs,
          signal: controller.signal,
        })
      } catch (error) {
        throw asOutboundError(error, controller.signal, hostname)
      }

      if (REDIRECT.has(response.status)) {
        if (hop === maxRedirects) {
          const error = new OutboundError(
            "redirect",
            maxRedirects === 0
              ? `${hostname} redirected the request`
              : `${hostname} redirected more times than allowed`,
          )
          controller.abort(error)
          throw error
        }

        const location = response.headers.get("location")
        if (!location) {
          throw new OutboundError("network", `${hostname} redirected without saying where`)
        }

        let next: URL
        try {
          next = new URL(location, url)
        } catch {
          throw new OutboundError("invalid_url", `${hostname} redirected to an unusable address`)
        }

        // The full entry check again, not a subset: scheme, credentials, port
        // and hostname all have to hold for the new URL on its own terms.
        const validated = validateOutboundUrl(next.toString())

        if (validated.origin !== url.origin) {
          headers = Object.fromEntries(
            Object.entries(headers).filter(
              ([name]) => !ORIGIN_BOUND_HEADERS.has(name.toLowerCase()),
            ),
          )
        }

        // The body of a redirect is not the answer and may still be large.
        await drain(response.body, maxBodyBytes, controller, hostname)

        url = validated
        redirects.push(validated.toString())
        continue
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
      const decoded = decode(body, response.headers.get("content-encoding"), maxBodyBytes, hostname)

      /*
        The body handed back is decoded, so the headers that described it
        encoded would be lies. A caller that trusted either would decode twice
        or truncate.
      */
      const outHeaders = new Headers(response.headers)
      outHeaders.delete("content-encoding")
      outHeaders.delete("content-length")

      return {
        response: new Response(NO_BODY.has(response.status) ? null : decoded, {
          status: response.status,
          headers: outHeaders,
        }),
        resolvedUrl: url.toString(),
        redirects,
      }
    }

    // Unreachable: the loop either returns or throws on its last iteration.
    throw new OutboundError("redirect", "the request redirected more times than allowed")
  } finally {
    clearTimeout(deadline)
  }
}

export async function outboundFetch(
  input: string,
  init: OutboundInit = {},
  options: OutboundOptions = {},
): Promise<Response> {
  const { response } = await outboundRequest(input, init, options)
  return response
}

/**
 * Reads and discards a body, holding it to the same cap as a kept one.
 *
 * A redirect's body is not the answer, but nothing stops a server sending a
 * gigabyte with one, and a socket left unread is a socket left open.
 */
async function drain(
  body: AsyncIterable<Uint8Array>,
  maxBodyBytes: number,
  controller: AbortController,
  hostname: string,
): Promise<void> {
  let received = 0
  try {
    for await (const chunk of body) {
      received += chunk.byteLength
      if (received > maxBodyBytes) {
        const error = new OutboundError("body_too_large", `${hostname} answered with too much`)
        controller.abort(error)
        throw error
      }
    }
  } catch (error) {
    throw asOutboundError(error, controller.signal, hostname)
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
 * A compressed answer, decompressed.
 *
 * Not an optimization. A server may compress whether or not it was asked to:
 * a WordPress store behind a page cache answers its REST index gzipped even
 * when the request says `Accept-Encoding: identity`, and the bytes that
 * arrive are then not JSON, not UTF-8, and not anything an adapter's schema
 * can read. The adapter sees a shape it does not recognise and reports that
 * the provider answered strangely, which sends whoever reads the log looking
 * in the wrong place entirely.
 *
 * **The cap is applied to the decompressed size, not the compressed one.**
 * A few kilobytes of gzip can become gigabytes, so `maxOutputLength` stops
 * the inflate at the same limit `collect` holds the wire to, and the overrun
 * is reported as what it is rather than as a broken stream.
 *
 * An encoding that is not understood is refused rather than passed through.
 * Handing an adapter bytes it cannot read while telling it they are fine is
 * how this arrived in the first place.
 */
/**
 * zlib answers with a Buffer over Node's shared pool. A `Response` body needs
 * a view that owns its buffer, so the decoded bytes are copied out of the pool
 * once. The uncompressed path never reaches here and never pays for it.
 */
function own(buffer: Buffer): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(buffer.byteLength))
  copy.set(buffer)
  return copy
}

function decode(
  body: Buffer<ArrayBuffer>,
  encoding: string | null,
  maxBodyBytes: number,
  hostname: string,
): Uint8Array<ArrayBuffer> {
  // A comma list is legal; the last coding applied is the outermost, and
  // nothing here has ever needed to unwrap more than one.
  const codings = (encoding ?? "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0 && part !== "identity")

  if (codings.length === 0) return body
  if (codings.length > 1) {
    throw new OutboundError("network", `${hostname} answered in more encodings than one`)
  }

  const limit = { maxOutputLength: maxBodyBytes }
  try {
    switch (codings[0]) {
      case "gzip":
      case "x-gzip":
        return own(gunzipSync(body, limit))
      case "deflate":
        return own(inflateSync(body, limit))
      case "br":
        return own(brotliDecompressSync(body, limit))
      default:
        throw new OutboundError(
          "network",
          `${hostname} answered in an encoding Fanwise cannot read`,
        )
    }
  } catch (error) {
    if (error instanceof OutboundError) throw error
    // zlib raises a RangeError once the output passes maxOutputLength.
    if (error instanceof RangeError) {
      throw new OutboundError("body_too_large", `${hostname} answered with too much`)
    }
    throw new OutboundError("network", `${hostname} answered in an encoding it did not keep to`)
  }
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
