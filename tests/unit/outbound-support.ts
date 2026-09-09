import {
  overrideOutboundDefaultsForTests,
  resetOutboundDefaultsForTests,
  type Transport,
  type TransportResponse,
} from "@/lib/net/outbound"

/**
 * Scripting a store behind the outbound boundary.
 *
 * The adapter tests were written against a fetch-shaped store: a function of
 * (url, init) answering with a `Response`. The boundary does not call fetch,
 * so this turns such a function into a transport and installs it, together
 * with a resolver that answers a public address, as the boundary's defaults.
 * The adapter code under test then runs through the real boundary, the real
 * URL checks and the real address check, and only the socket is scripted.
 */

/** A public address for scripted DNS. Not in any blocked range. */
export const PUBLIC_ADDRESS = "93.184.216.34"

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export function fetchTransport(fetchLike: FetchLike): Transport {
  return async (request): Promise<TransportResponse> => {
    const response = await fetchLike(request.url.toString(), {
      method: request.method,
      headers: request.headers,
      ...(request.body === undefined ? {} : { body: request.body }),
    })
    return {
      status: response.status,
      headers: response.headers,
      body: response.body ?? (async function* () {})(),
    }
  }
}

/** Installs a scripted store as the boundary's default transport. */
export function scriptStore(fetchLike: FetchLike): void {
  overrideOutboundDefaultsForTests({
    resolve: async () => [{ address: PUBLIC_ADDRESS, family: 4 }],
    transport: fetchTransport(fetchLike),
  })
}

export function resetStore(): void {
  resetOutboundDefaultsForTests()
}
