import { describe, expect, it } from "vitest"
import {
  PASSWORD_RESET_PATH,
  RECOVERY_FAILURE_PATH,
  safeRedirectTarget,
} from "@/lib/auth/redirect-target"
import { newPasswordSchema, passwordResetRequestSchema } from "@/lib/workspaces/schemas"

const FALLBACK = PASSWORD_RESET_PATH

const LF = String.fromCharCode(10)
const CR = String.fromCharCode(13)
const TAB = String.fromCharCode(9)
const NUL = String.fromCharCode(0)

describe("safeRedirectTarget", () => {
  it("keeps an ordinary same-origin path", () => {
    expect(safeRedirectTarget("/reset-password", FALLBACK)).toBe("/reset-password")
    expect(safeRedirectTarget("/w/northbound/products", FALLBACK)).toBe("/w/northbound/products")
  })

  it("falls back when nothing was supplied", () => {
    expect(safeRedirectTarget(null, FALLBACK)).toBe(FALLBACK)
    expect(safeRedirectTarget("", FALLBACK)).toBe(FALLBACK)
  })

  it("refuses another origin, however it is spelled", () => {
    // Each of these resolves to another origin under `new URL(value, base)`, or
    // does so after a browser normalizes it. Accepting one would let an emailed
    // link that has just established a session hand its landing page to someone
    // else.
    const hostile = [
      "https://evil.example/steal",
      "http://evil.example",
      "//evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
    ]
    for (const value of hostile) {
      expect(safeRedirectTarget(value, FALLBACK), value).toBe(FALLBACK)
    }
  })

  it("refuses whitespace and control characters", () => {
    const hostile = [
      "/reset password",
      "/reset" + LF + "password",
      "/reset" + CR + LF + "Location: https://evil.example",
      "/reset" + TAB + "password",
      "/reset" + NUL,
      " /reset-password",
    ]
    for (const value of hostile) {
      expect(safeRedirectTarget(value, FALLBACK), JSON.stringify(value)).toBe(FALLBACK)
    }
  })

  it("sends a failed verification somewhere that explains itself", () => {
    expect(RECOVERY_FAILURE_PATH.startsWith("/forgot-password")).toBe(true)
    expect(safeRedirectTarget(RECOVERY_FAILURE_PATH, FALLBACK)).toBe(RECOVERY_FAILURE_PATH)
  })
})

describe("passwordResetRequestSchema", () => {
  it("accepts an address", () => {
    expect(passwordResetRequestSchema.safeParse({ email: "creator@studio.com" }).success).toBe(true)
  })

  it("rejects one that is not an address", () => {
    expect(passwordResetRequestSchema.safeParse({ email: "creator" }).success).toBe(false)
    expect(passwordResetRequestSchema.safeParse({ email: null }).success).toBe(false)
  })
})

describe("newPasswordSchema", () => {
  it("accepts a matching pair", () => {
    const result = newPasswordSchema.safeParse({
      password: "correct-horse-battery-staple",
      confirm: "correct-horse-battery-staple",
    })
    expect(result.success).toBe(true)
  })

  it("rejects a mismatch, and says which field is wrong", () => {
    const result = newPasswordSchema.safeParse({
      password: "correct-horse-battery-staple",
      confirm: "correct-horse-battery-stapl",
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0]?.path).toEqual(["confirm"])
    expect(result.error.issues[0]?.message).toBe("Those passwords do not match.")
  })

  it("holds the same floor as signup, so recovery cannot set a weaker password", () => {
    const short = "nine-char"
    expect(short.length).toBeLessThan(10)
    expect(newPasswordSchema.safeParse({ password: short, confirm: short }).success).toBe(false)
  })
})
