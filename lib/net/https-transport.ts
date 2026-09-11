import { request as httpsRequest } from "node:https"
import type { LookupFunction } from "node:net"
import { OutboundError, type Transport, type TransportResponse } from "./outbound"

/**
 * The production transport: one HTTPS request over `node:https`, connected to
 * the address the boundary already validated rather than to whatever the
 * hostname resolves to a second time.
 *
 * `node:https` rather than `fetch` for one reason. The boundary resolves the
 * hostname, checks every address, and must then connect to the address it
 * checked; a second resolution inside the transport is the window a DNS
 * rebinding attack uses. `fetch` offers no way to pin the address. `https.request`
 * takes a `lookup` function, and this one answers with the pinned address and
 * nothing else. TLS still verifies the certificate against the hostname,
 * because `servername` is the hostname and only the socket's destination is
 * pinned.
 *
 * Redirects are not followed: `https.request` never does, and the boundary
 * refuses a 3xx rather than chasing it. The connect timeout is enforced here,
 * because only the transport sees the socket; the response deadline arrives
 * as an AbortSignal and is enforced by the boundary around the whole exchange.
 */
export const httpsTransport: Transport = (request) =>
  new Promise<TransportResponse>((resolve, reject) => {
    const { url, address, family, signal } = request

    const lookup: LookupFunction = (_hostname, options, callback) => {
      if (options.all) callback(null, [{ address, family }])
      else callback(null, address, family)
    }

    const req = httpsRequest({
      protocol: "https:",
      hostname: url.hostname,
      port: 443,
      path: `${url.pathname}${url.search}`,
      method: request.method,
      headers: request.headers,
      servername: url.hostname,
      lookup,
    })

    const abort = () => req.destroy(signal.reason instanceof Error ? signal.reason : undefined)

    req.once("socket", (socket) => {
      const timer = setTimeout(() => {
        req.destroy(new OutboundError("timeout", `connecting to ${url.hostname} took too long`))
      }, request.connectTimeoutMs)
      const clear = () => clearTimeout(timer)
      socket.once("connect", clear)
      socket.once("error", clear)
      socket.once("close", clear)
    })

    req.once("response", (response) => {
      signal.removeEventListener("abort", abort)
      const headers = new Headers()
      for (const [name, value] of Object.entries(response.headers)) {
        if (value === undefined) continue
        headers.set(name, Array.isArray(value) ? value.join(", ") : value)
      }
      // Destroying the request destroys the socket the body is read from, so
      // the boundary's deadline still ends a slow body.
      signal.addEventListener("abort", abort, { once: true })
      resolve({ status: response.statusCode ?? 0, headers, body: response })
    })

    req.once("error", (error) => {
      signal.removeEventListener("abort", abort)
      reject(error)
    })

    // Listeners first, then the signal: a request destroyed before its error
    // listener exists raises an unhandled 'error' and settles nothing.
    if (signal.aborted) {
      reject(signal.reason)
      abort()
      return
    }
    signal.addEventListener("abort", abort, { once: true })

    if (request.body !== undefined) req.write(request.body)
    req.end()
  })
