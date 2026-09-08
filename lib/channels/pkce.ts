import { createHash, randomBytes } from "node:crypto"

/**
 * PKCE, for providers whose OAuth requires it.
 *
 * Provider-neutral: a verifier is 32 random bytes as base64url, and the
 * challenge is its SHA-256 as base64url, which is what RFC 7636 calls S256.
 * The verifier is minted when a flow starts, kept on the state row, and
 * presented at the token exchange; it is never in the browser.
 */

export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url")
}

export function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "utf8").digest("base64url")
}
