import { afterEach, describe, expect, it } from "vitest"
import { appUrl, schemas } from "@/lib/env"

describe("environment schemas", () => {
  it("rejects a missing supabase url", () => {
    const result = schemas.clientSchema.safeParse({
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    })
    expect(result.success).toBe(false)
  })

  it("rejects a non-url supabase url", () => {
    const result = schemas.clientSchema.safeParse({
      NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    })
    expect(result.success).toBe(false)
  })

  it("accepts a complete public environment", () => {
    const result = schemas.clientSchema.safeParse({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    })
    expect(result.success).toBe(true)
  })

  it("requires the service role key on the server", () => {
    const result = schemas.serverSchema.safeParse({ NODE_ENV: "test" })
    expect(result.success).toBe(false)
  })
})

describe("appUrl", () => {
  const original = { ...process.env }

  afterEach(() => {
    process.env = { ...original }
  })

  // The reason this function exists. Vercel's Preview environment carries
  // NEXT_PUBLIC_APP_URL and not the Supabase pair, and robots.txt is
  // prerendered; clientEnv() would fail the export over two variables that
  // route never reads.
  it("resolves with the supabase variables absent", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    process.env.NEXT_PUBLIC_APP_URL = "https://fanwise.vercel.app"

    expect(appUrl()).toBe("https://fanwise.vercel.app")
  })

  it("throws when the app url is missing", () => {
    delete process.env.NEXT_PUBLIC_APP_URL

    expect(() => appUrl()).toThrow(/NEXT_PUBLIC_APP_URL/)
  })

  it("throws when the app url is not a url", () => {
    process.env.NEXT_PUBLIC_APP_URL = "fanwise.vercel.app"

    expect(() => appUrl()).toThrow(/NEXT_PUBLIC_APP_URL/)
  })
})
