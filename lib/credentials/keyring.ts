import { z } from "zod"

/**
 * The credential encryption keyring.
 *
 * docs/security.md: "CREDENTIALS_ENCRYPTION_KEY is a base64 32-byte key.
 * Rotation plan gets written before the first real credential is stored, not
 * after." This file is that plan, expressed as code rather than as a paragraph
 * somebody has to remember.
 *
 * The variable holds one or more versioned keys:
 *
 *     CREDENTIALS_ENCRYPTION_KEY="2:<base64>,1:<base64>"
 *
 * The highest version is the active one and is what new writes are sealed with.
 * Older versions stay present only so rows sealed under them can still be
 * opened, and channel_connection_secrets.key_version is what selects between
 * them. A bare base64 key with no prefix is accepted and means version 1, which
 * is what a deployment that has never rotated looks like.
 *
 * The rotation procedure this shape supports, in full:
 *
 *   1. Generate a key:            openssl rand -base64 32
 *   2. Prepend it with the next version number, keeping the old entry:
 *      CREDENTIALS_ENCRYPTION_KEY="2:<new>,1:<old>"
 *   3. Deploy. New credentials seal under 2. Existing rows still open under 1,
 *      and are re-sealed under 2 the next time they are read.
 *   4. When no row has key_version 1 left, drop the "1:<old>" entry.
 *
 * Nothing here logs, stringifies or returns a key. A key that reaches a log line
 * is a key that has to be rotated, which is the situation this file exists to
 * make survivable rather than routine.
 */

export interface KeyringEntry {
  version: number
  key: Buffer
}

export interface Keyring {
  active: KeyringEntry
  byVersion: Map<number, KeyringEntry>
}

const KEY_BYTES = 32

const entrySchema = z.object({
  version: z.number().int().positive(),
  key: z.instanceof(Buffer).refine((b) => b.length === KEY_BYTES, {
    message: `each key must decode to exactly ${KEY_BYTES} bytes`,
  }),
})

/**
 * Parses the raw variable. Exported so a unit test can exercise it without
 * touching process.env, and so the error messages are testable: a
 * misconfigured key is found at the first connection attempt, and the message
 * has to say which entry is wrong without ever printing the entry.
 */
export function parseKeyring(raw: string): Keyring {
  const trimmed = raw.trim()
  if (trimmed === "") {
    throw new Error("CREDENTIALS_ENCRYPTION_KEY is empty. Generate one: openssl rand -base64 32")
  }

  const byVersion = new Map<number, KeyringEntry>()

  for (const [index, part] of trimmed.split(",").entries()) {
    const piece = part.trim()
    if (piece === "") continue

    // A version prefix is "<digits>:". Anything else is treated as a bare key,
    // because base64 itself never contains a colon.
    const match = /^(\d+):(.*)$/s.exec(piece)
    const versionText = match?.[1]
    const version = versionText === undefined ? 1 : Number(versionText)
    const encoded = (match?.[2] ?? piece).trim()

    const key = Buffer.from(encoded, "base64")
    const parsed = entrySchema.safeParse({ version, key })
    if (!parsed.success) {
      throw new Error(
        `CREDENTIALS_ENCRYPTION_KEY entry ${index + 1} is invalid: ` +
          `${parsed.error.issues[0]?.message ?? "unparseable"}. ` +
          `Expected "<version>:<base64 of 32 bytes>".`,
      )
    }

    if (byVersion.has(version)) {
      throw new Error(`CREDENTIALS_ENCRYPTION_KEY declares version ${version} more than once.`)
    }
    byVersion.set(version, { version, key })
  }

  if (byVersion.size === 0) {
    throw new Error("CREDENTIALS_ENCRYPTION_KEY held no usable entries.")
  }

  // Highest version wins. Ordering by position instead would make the active
  // key depend on how carefully somebody edited an environment variable.
  const active = [...byVersion.values()].reduce((a, b) => (b.version > a.version ? b : a))

  return { active, byVersion }
}

let cached: Keyring | null = null

/**
 * The process keyring.
 *
 * Read lazily rather than at boot, deliberately. lib/env.ts keeps
 * CREDENTIALS_ENCRYPTION_KEY optional so that local development, CI and every
 * step before a real connection exists can run without one; the cost of that is
 * that a missing key must fail loudly at the moment a credential is actually
 * handled, which is here.
 */
export function keyring(): Keyring {
  if (cached) return cached
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY is not set, and a marketplace credential cannot be stored " +
        "without it. Generate one: openssl rand -base64 32",
    )
  }
  cached = parseKeyring(raw)
  return cached
}

/** Test seam. Never call from application code. */
export function resetKeyringCacheForTests(): void {
  cached = null
}
