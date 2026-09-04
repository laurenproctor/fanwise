import { describe, expect, it } from "vitest"
import { schemas } from "@/lib/env"

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
