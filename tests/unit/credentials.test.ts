import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { randomBytes } from "node:crypto"
import { parseKeyring, resetKeyringCacheForTests } from "@/lib/credentials/keyring"
import { isStale, open, seal } from "@/lib/credentials/seal"

/**
 * The credentials service, and the rotation plan from ADR 0003.
 *
 * These tests are the reason the plan is written down rather than remembered.
 * Every one of them describes a way a rotation could destroy every marketplace
 * connection Fanwise holds, which is unrecoverable: the tokens are not in a
 * backup that is readable without the key that was thrown away.
 */

const KEY_A = randomBytes(32).toString("base64")
const KEY_B = randomBytes(32).toString("base64")
const CONTEXT = "channel_connection:ws-1:conn-1"

function useKeyring(value: string) {
  process.env.CREDENTIALS_ENCRYPTION_KEY = value
  resetKeyringCacheForTests()
}

const original = process.env.CREDENTIALS_ENCRYPTION_KEY

beforeEach(() => resetKeyringCacheForTests())
afterEach(() => {
  if (original === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY
  else process.env.CREDENTIALS_ENCRYPTION_KEY = original
  resetKeyringCacheForTests()
})

describe("keyring parsing", () => {
  it("reads a bare key as version 1, which is what a deployment that never rotated looks like", () => {
    const ring = parseKeyring(KEY_A)
    expect(ring.active.version).toBe(1)
    expect(ring.byVersion.size).toBe(1)
  })

  it("reads versioned entries and makes the highest version active", () => {
    const ring = parseKeyring(`2:${KEY_B},1:${KEY_A}`)
    expect(ring.active.version).toBe(2)
    expect(ring.byVersion.size).toBe(2)
  })

  it("picks the highest version regardless of the order they were written in", () => {
    // Ordering by position would make the active key depend on how carefully
    // somebody edited an environment variable.
    const ring = parseKeyring(`1:${KEY_A},2:${KEY_B}`)
    expect(ring.active.version).toBe(2)
  })

  it("refuses a key that is not 32 bytes", () => {
    expect(() => parseKeyring(randomBytes(16).toString("base64"))).toThrow(/32 bytes/)
  })

  it("refuses a duplicated version rather than silently preferring one", () => {
    expect(() => parseKeyring(`1:${KEY_A},1:${KEY_B}`)).toThrow(/more than once/)
  })

  it("refuses an empty value", () => {
    expect(() => parseKeyring("   ")).toThrow(/empty/)
  })

  it("never puts key material in an error message", () => {
    try {
      parseKeyring(`1:${randomBytes(16).toString("base64")}`)
      throw new Error("should have thrown")
    } catch (error) {
      expect((error as Error).message).not.toContain(KEY_A)
      expect((error as Error).message).not.toContain(KEY_B)
    }
  })
})

describe("sealing", () => {
  it("round trips", () => {
    useKeyring(KEY_A)
    const sealed = seal("shpat-secret-token", CONTEXT)
    expect(sealed.ciphertext).not.toContain("shpat-secret-token")
    expect(open(sealed, CONTEXT)).toBe("shpat-secret-token")
  })

  it("produces a different ciphertext every time, so equal tokens are not detectable", () => {
    useKeyring(KEY_A)
    expect(seal("same", CONTEXT).ciphertext).not.toBe(seal("same", CONTEXT).ciphertext)
  })

  it("refuses to open under a different context", () => {
    // The property that makes a stolen ciphertext useless in another row: a
    // blob copied between connections, or between workspaces, does not open.
    useKeyring(KEY_A)
    const sealed = seal("token", CONTEXT)
    expect(() => open(sealed, "channel_connection:ws-2:conn-2")).toThrow()
  })

  it("refuses to open under a different key", () => {
    useKeyring(KEY_A)
    const sealed = seal("token", CONTEXT)
    useKeyring(KEY_B)
    expect(() => open({ ...sealed, keyVersion: 1 }, CONTEXT)).toThrow()
  })

  it("detects a tampered ciphertext rather than returning altered plaintext", () => {
    useKeyring(KEY_A)
    const sealed = seal("token", CONTEXT)
    const [iv, tag, body] = sealed.ciphertext.split(".")
    const flipped = Buffer.from(body!, "base64")
    flipped[0] = flipped[0]! ^ 0xff
    expect(() =>
      open({ ...sealed, ciphertext: [iv, tag, flipped.toString("base64")].join(".") }, CONTEXT),
    ).toThrow()
  })

  it("rejects a malformed stored value", () => {
    useKeyring(KEY_A)
    expect(() => open({ ciphertext: "nonsense", keyVersion: 1 }, CONTEXT)).toThrow(/malformed/)
  })
})

describe("rotation, as ADR 0003 describes it", () => {
  it("opens a row sealed under an older key while the old entry is still present", () => {
    useKeyring(KEY_A)
    const sealedUnderOne = seal("token", CONTEXT)
    expect(sealedUnderOne.keyVersion).toBe(1)

    // Step 2 of the procedure: prepend the new key, keep the old entry.
    useKeyring(`2:${KEY_B},1:${KEY_A}`)
    expect(open(sealedUnderOne, CONTEXT)).toBe("token")
    expect(seal("token", CONTEXT).keyVersion).toBe(2)
  })

  it("reports an old row as stale so the read path re-seals it", () => {
    useKeyring(`2:${KEY_B},1:${KEY_A}`)
    expect(isStale(1)).toBe(true)
    expect(isStale(2)).toBe(false)
  })

  it("names the missing version when a key is retired too early", () => {
    // Step 6 done before step 5. The error has to say which version is gone,
    // because "decryption failed" would send someone hunting for corruption.
    useKeyring(KEY_A)
    expect(() => open({ ciphertext: "a.b.c", keyVersion: 7 }, CONTEXT)).toThrow(
      /no encryption key for version 7/,
    )
  })
})
