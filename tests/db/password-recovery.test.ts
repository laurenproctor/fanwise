import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { adminClient, anonClient } from "./harness"

/**
 * The recovery mechanics themselves, against the real auth server.
 *
 * These are the exact calls `/auth/confirm` and `updatePasswordAction` make, in
 * the same order, so what passes here is what the route does. The link is
 * generated through the admin API rather than read out of a mailbox: that keeps
 * the test independent of whether a local mail catcher is running, and the token
 * is the same token the email would have carried.
 */

const OLD_PASSWORD = "correct-horse-battery-staple"
const NEW_PASSWORD = "a-quite-different-passphrase"

let email = ""
let userId = ""

async function recoveryTokenHash(address: string): Promise<string> {
  const { data, error } = await adminClient().auth.admin.generateLink({
    type: "recovery",
    email: address,
  })
  if (error || !data.properties?.hashed_token) {
    throw new Error(`could not generate a recovery link: ${error?.message}`)
  }
  return data.properties.hashed_token
}

beforeAll(async () => {
  email = `recovery-${Date.now()}@fanwise.test`
  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password: OLD_PASSWORD,
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`could not create test user: ${error?.message}`)
  userId = data.user.id
})

afterAll(async () => {
  if (userId) await adminClient().auth.admin.deleteUser(userId)
})

describe("password recovery", () => {
  it("a forged token establishes no session", async () => {
    const client = anonClient()
    const { data, error } = await client.auth.verifyOtp({
      type: "recovery",
      token_hash: "not-a-real-token-hash",
    })

    expect(error).not.toBeNull()
    expect(data.session).toBeNull()
  })

  it("a real link signs the holder in, sets a new password, and cannot be spent twice", async () => {
    const tokenHash = await recoveryTokenHash(email)

    // What /auth/confirm does.
    const client = anonClient()
    const { data: verified, error: verifyError } = await client.auth.verifyOtp({
      type: "recovery",
      token_hash: tokenHash,
    })
    expect(verifyError).toBeNull()
    expect(verified.session).not.toBeNull()
    expect(verified.user?.id).toBe(userId)

    // What updatePasswordAction does, on the session that link established.
    const { error: updateError } = await client.auth.updateUser({ password: NEW_PASSWORD })
    expect(updateError).toBeNull()

    // The same link again is spent. Without this, a recovery mail sitting in a
    // mailbox stays a working key to the account for as long as it is readable.
    const replay = await anonClient().auth.verifyOtp({
      type: "recovery",
      token_hash: tokenHash,
    })
    expect(replay.error).not.toBeNull()
    expect(replay.data.session).toBeNull()

    // The password actually changed: the new one works and the old one does not.
    const withNew = await anonClient().auth.signInWithPassword({
      email,
      password: NEW_PASSWORD,
    })
    expect(withNew.error).toBeNull()
    expect(withNew.data.user?.id).toBe(userId)

    const withOld = await anonClient().auth.signInWithPassword({
      email,
      password: OLD_PASSWORD,
    })
    expect(withOld.error).not.toBeNull()
    expect(withOld.data.session).toBeNull()
  })

  it("a recovery session belongs to one account only", async () => {
    // A second account, to prove the token is bound to the address it was issued
    // for rather than to whoever presents it.
    const otherEmail = `recovery-other-${Date.now()}@fanwise.test`
    const { data: other, error } = await adminClient().auth.admin.createUser({
      email: otherEmail,
      password: OLD_PASSWORD,
      email_confirm: true,
    })
    if (error || !other.user) throw new Error(`could not create second user: ${error?.message}`)

    try {
      const tokenHash = await recoveryTokenHash(otherEmail)
      const client = anonClient()
      const { data: verified } = await client.auth.verifyOtp({
        type: "recovery",
        token_hash: tokenHash,
      })

      expect(verified.user?.id).toBe(other.user.id)
      expect(verified.user?.id).not.toBe(userId)
    } finally {
      await adminClient().auth.admin.deleteUser(other.user.id)
    }
  })
})
