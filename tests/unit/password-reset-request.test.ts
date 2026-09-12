import { beforeEach, describe, expect, it, vi } from "vitest"

/*
  The reset request action, run for real. The auth client is replaced with one
  that records whether it was asked anything, because "nothing was sent" is the
  claim: a malformed address must be answered without the auth server hearing
  about it at all.
*/
const auth = vi.hoisted(() => ({ calls: [] as string[] }))

vi.mock("next/navigation", () => ({ redirect: () => {} }))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("@/lib/env", () => ({
  clientEnv: () => ({ NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3399" }),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      resetPasswordForEmail: async (email: string) => {
        auth.calls.push(email)
        return { data: {}, error: null }
      },
    },
  }),
}))

import { requestPasswordResetAction } from "@/lib/auth/actions"

/**
 * A malformed address is rejected without claiming anything was sent.
 *
 * The browser test this replaces had to switch off the form's own constraint
 * checking to reach the server at all, because the server is what was under
 * test. So the server action is called directly. The page's answer for a real
 * address, registered or not, is still password-recovery.spec.ts.
 */
function form(email: string): FormData {
  const data = new FormData()
  data.set("email", email)
  return data
}

describe("requesting a password reset", () => {
  beforeEach(() => {
    auth.calls = []
  })

  it.each(["not-an-address", "", "   ", "two@@signs.test"])(
    "refuses %j, says so, and sends nothing",
    async (email) => {
      await expect(
        requestPasswordResetAction({ error: null, sent: false }, form(email)),
      ).resolves.toEqual({ error: "Enter a valid email address.", sent: false })
      expect(auth.calls).toEqual([])
    },
  )

  it("acknowledges a well-formed address the same way whether or not it has an account", async () => {
    await expect(
      requestPasswordResetAction({ error: null, sent: false }, form("someone@fanwise.test")),
    ).resolves.toEqual({ error: null, sent: true })
    expect(auth.calls).toEqual(["someone@fanwise.test"])
  })
})
