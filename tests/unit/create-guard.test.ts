import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { carriesStamp, listingStamp } from "@/lib/channels/stamp"
import { createEtsyClient } from "@/lib/channels/adapters/etsy/client"
import { createGumroadClient } from "@/lib/channels/adapters/gumroad/client"
import { createShopifyClient } from "@/lib/channels/adapters/shopify/client"
import { createWooClient } from "@/lib/channels/adapters/woocommerce/client"
import { IN_CALL_MAX_ATTEMPTS } from "@/lib/channels/errors"
import { PUBLIC_ADDRESS, fetchTransport } from "./outbound-support"

/**
 * The create guard's shared parts, ADR 0005.
 *
 * The stamp is one function, so every adapter that writes one writes the
 * same thing. And the one request that creates an external object is sent
 * once: a transport failure on it is not retried inside the call, because the
 * request may have landed and a repeat would create twice. Every client used
 * to retry every request three times, creates included, which is the
 * duplicate the guard exists to prevent.
 */

describe("the listing stamp", () => {
  it("is the listing id, prefixed so a person can tell where it came from", () => {
    expect(listingStamp("3f9a1c2b-7d4e-4c11-9a2e-0b1c2d3e4f50")).toBe(
      "fanwise-3f9a1c2b-7d4e-4c11-9a2e-0b1c2d3e4f50",
    )
  })

  it("is recognised only as an exact match, whitespace aside", () => {
    expect(carriesStamp("fanwise-abc", "abc")).toBe(true)
    expect(carriesStamp("  fanwise-abc ", "abc")).toBe(true)
    expect(carriesStamp("fanwise-abcd", "abc")).toBe(false)
    expect(carriesStamp("fanwise-ab", "abc")).toBe(false)
    expect(carriesStamp(null, "abc")).toBe(false)
    expect(carriesStamp(undefined, "abc")).toBe(false)
  })
})

describe("a create is sent once", () => {
  const sleep = async () => {}
  const schema = z.unknown()
  const lostOnTheWire = () =>
    vi.fn(async () => {
      throw new Error("ECONNRESET")
    })

  it("Shopify retries a transport failure on a repeatable request, and not on a create", async () => {
    const repeatable = lostOnTheWire()
    const client = createShopifyClient({
      shopDomain: "s.myshopify.com",
      accessToken: "t",
      fetchImpl: repeatable as unknown as typeof fetch,
      sleep,
    })
    await expect(client.request({ query: "q", variables: {}, schema })).rejects.toMatchObject({
      normalized: { code: "network" },
    })
    expect(repeatable).toHaveBeenCalledTimes(IN_CALL_MAX_ATTEMPTS)

    const create = lostOnTheWire()
    const once = createShopifyClient({
      shopDomain: "s.myshopify.com",
      accessToken: "t",
      fetchImpl: create as unknown as typeof fetch,
      sleep,
    })
    await expect(
      once.request({ query: "q", variables: {}, schema, idempotent: false }),
    ).rejects.toMatchObject({ normalized: { code: "network" } })
    expect(create).toHaveBeenCalledTimes(1)
  })

  it("Etsy retries a transport failure on a repeatable request, and not on a create", async () => {
    const repeatable = lostOnTheWire()
    const client = createEtsyClient({
      apiKey: "k",
      accessToken: "t",
      fetchImpl: repeatable as unknown as typeof fetch,
      sleep,
    })
    await expect(client.request({ method: "GET", path: "x", schema })).rejects.toMatchObject({
      normalized: { code: "network" },
    })
    expect(repeatable).toHaveBeenCalledTimes(IN_CALL_MAX_ATTEMPTS)

    const create = lostOnTheWire()
    const once = createEtsyClient({
      apiKey: "k",
      accessToken: "t",
      fetchImpl: create as unknown as typeof fetch,
      sleep,
    })
    await expect(
      once.request({ method: "POST", path: "x", schema, idempotent: false }),
    ).rejects.toMatchObject({ normalized: { code: "network" } })
    expect(create).toHaveBeenCalledTimes(1)
  })

  it("Gumroad retries a transport failure on a repeatable request, and not on a create", async () => {
    const repeatable = lostOnTheWire()
    const client = createGumroadClient({
      accessToken: "t",
      fetchImpl: repeatable as unknown as typeof fetch,
      sleep,
    })
    await expect(client.request({ method: "GET", path: "x", schema })).rejects.toMatchObject({
      normalized: { code: "network" },
    })
    expect(repeatable).toHaveBeenCalledTimes(IN_CALL_MAX_ATTEMPTS)

    const create = lostOnTheWire()
    const once = createGumroadClient({
      accessToken: "t",
      fetchImpl: create as unknown as typeof fetch,
      sleep,
    })
    await expect(
      once.request({ method: "POST", path: "x", schema, idempotent: false }),
    ).rejects.toMatchObject({ normalized: { code: "network" } })
    expect(create).toHaveBeenCalledTimes(1)
  })

  it("WooCommerce retries a transport failure on a repeatable request, and not on a create", async () => {
    const wooClient = (fetchLike: ReturnType<typeof lostOnTheWire>) =>
      createWooClient({
        storeUrl: "https://shop.example.com",
        consumerKey: "ck",
        consumerSecret: "cs",
        sleep,
        outbound: {
          resolve: async () => [{ address: PUBLIC_ADDRESS, family: 4 }],
          transport: fetchTransport(fetchLike as unknown as (url: string) => Promise<Response>),
        },
      })

    const repeatable = lostOnTheWire()
    await expect(
      wooClient(repeatable).request({ method: "GET", path: "products", schema }),
    ).rejects.toMatchObject({ normalized: { code: "network" } })
    expect(repeatable).toHaveBeenCalledTimes(IN_CALL_MAX_ATTEMPTS)

    const create = lostOnTheWire()
    await expect(
      wooClient(create).request({ method: "POST", path: "products", schema, idempotent: false }),
    ).rejects.toMatchObject({ normalized: { code: "network" } })
    expect(create).toHaveBeenCalledTimes(1)
  })
})
