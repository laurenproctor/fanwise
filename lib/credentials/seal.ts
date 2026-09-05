import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { keyring } from "./keyring"

/**
 * Authenticated encryption for marketplace credentials.
 *
 * AES-256-GCM. The stored form is three base64 fields joined by dots:
 *
 *     <iv>.<authTag>.<ciphertext>
 *
 * and the key version lives in its own column rather than in this string, so
 * rotation is a query (`where key_version = 1`) rather than a parse.
 *
 * Every seal is bound to a **context** string, passed to GCM as additional
 * authenticated data. The context is the connection the credential belongs to,
 * so a sealed blob copied from one row to another fails to open rather than
 * opening into the wrong tenant's connection. It costs nothing and closes a gap
 * that encryption alone does not: ciphertext with no binding is portable.
 */

const ALGORITHM = "aes-256-gcm"
const IV_BYTES = 12
const TAG_BYTES = 16

export interface Sealed {
  ciphertext: string
  keyVersion: number
}

export function seal(plaintext: string, context: string): Sealed {
  const { active } = keyring()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, active.key, iv)
  cipher.setAAD(Buffer.from(context, "utf8"))

  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()

  return {
    ciphertext: [iv.toString("base64"), tag.toString("base64"), body.toString("base64")].join("."),
    keyVersion: active.version,
  }
}

export function open(sealed: Sealed, context: string): string {
  const ring = keyring()
  const entry = ring.byVersion.get(sealed.keyVersion)
  if (!entry) {
    throw new Error(
      `no encryption key for version ${sealed.keyVersion}. ` +
        `Restore that entry to CREDENTIALS_ENCRYPTION_KEY before dropping it.`,
    )
  }

  const parts = sealed.ciphertext.split(".")
  if (parts.length !== 3) throw new Error("sealed credential is malformed")

  const [ivPart, tagPart, bodyPart] = parts as [string, string, string]
  const iv = Buffer.from(ivPart, "base64")
  const tag = Buffer.from(tagPart, "base64")
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("sealed credential is malformed")
  }

  const decipher = createDecipheriv(ALGORITHM, entry.key, iv)
  decipher.setAAD(Buffer.from(context, "utf8"))
  decipher.setAuthTag(tag)

  // GCM raises here when the key, the tag or the context is wrong. All three
  // are the same answer to the caller: this is not a credential you may use.
  return Buffer.concat([
    decipher.update(Buffer.from(bodyPart, "base64")),
    decipher.final(),
  ]).toString("utf8")
}

/** True when a row is sealed under an older key and is worth re-sealing. */
export function isStale(keyVersion: number): boolean {
  return keyVersion < keyring().active.version
}
