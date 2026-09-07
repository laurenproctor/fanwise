# ADR 0003: Credential encryption key rotation

**Status:** accepted, 4 September 2026
**Blocks:** A5 (the first real marketplace credential)
**Answers:** `docs/decisions/0002` entry 5

---

## Context

`docs/security.md` states the rule this document exists to satisfy:

> `CREDENTIALS_ENCRYPTION_KEY` is a base64 32-byte key. Rotation plan gets written before
> the first real credential is stored, not after.

A5 stores the first one. The clock has run out.

The schema has been ready since A3: `channel_connection_secrets.key_version` exists
precisely so that rotation is a query rather than a guess. What was missing was the
procedure, and a procedure that lives only in someone's head is not a procedure.

The failure this guards against is specific and unrecoverable. A key that is replaced
without a way to read rows sealed under the old one turns every connected store into a
reconnection request, silently, at the moment the deploy lands. Marketplace tokens are not
recoverable from a backup that is also encrypted with the key that was thrown away.

---

## Decision

**`CREDENTIALS_ENCRYPTION_KEY` holds a keyring, not a key.** Rows are re-sealed lazily, on
read. A key version is retired only when no row references it.

The variable holds one or more versioned entries, newest first:

```
CREDENTIALS_ENCRYPTION_KEY="2:<base64 32 bytes>,1:<base64 32 bytes>"
```

The highest version is **active** and seals every new write. Older entries exist only so
rows written under them can still be opened. A bare base64 key with no version prefix is
accepted and means version 1, so a deployment that has never rotated needs no migration and
no change to `.env`.

Implemented in `lib/credentials/keyring.ts`, and the parser is unit tested against every
shape below, including the malformed ones.

---

## The procedure

1. **Generate.** `openssl rand -base64 32`
2. **Prepend, keeping the old entry.**
   `CREDENTIALS_ENCRYPTION_KEY="2:<new>,1:<old>"`
3. **Deploy.** New credentials seal under 2 immediately. Existing rows still open under 1.
4. **Drain.** Each connection re-seals under 2 the next time it is read, which for a
   connected store is its next publish.
5. **Force the tail, if it matters.** `select count(*) from channel_connection_secrets
   where key_version = 1` names the stragglers: connections nobody has published to since
   the rotation. Reading each one re-seals it.
6. **Retire.** When that count is zero, drop `1:<old>` from the variable and deploy.

Step 6 is the only irreversible step, and step 5 is how you know it is safe.

---

## Why re-seal on read rather than in a migration or a cron job

**A migration cannot do it.** The keys live in the environment, not in the database. A SQL
migration has no access to either key and could not decrypt a row if it wanted to.

**A backfill job could, and is worse.** It would need every credential in memory at once, on
a schedule, for a benefit that lazy re-sealing gets for free. Rotation is not urgent per
row; it is urgent only for the rows actually in use, and the read path is exactly the set of
rows actually in use.

**The read path already holds both halves.** It is the only place in the system guaranteed
to have the plaintext and the active key at the same moment. Re-sealing anywhere else means
decrypting somewhere new, which means one more place a credential exists in the clear.

The re-seal is deliberately **best effort**. If the write fails, the read still returns the
credential and the publish still happens. Failing a creator's publication in order to
rotate a key that is working is the wrong trade, and the row will be caught on the next read
or by step 5.

---

## What is bound into the ciphertext

AES-256-GCM, with the connection identity passed as additional authenticated data:

```
channel_connection:<workspace_id>:<connection_id>
```

So a sealed blob is not portable. A ciphertext copied from one connection row to another, or
from one workspace to another, fails to open rather than opening into the wrong tenant's
connection. Encryption alone does not give this: ciphertext with no binding is just bytes
that decrypt anywhere the key is.

This has a consequence worth knowing before someone meets it at 2am: **a credential row
cannot be moved between connections.** Re-parenting a connection means re-authorizing it.
That is correct, and it is also not obvious from looking at the table.

---

## Consequences

**Good.** Rotation is a two-line environment change and a deploy. No downtime, no
reconnection prompts, no migration, no backfill job, and no window in which some rows are
readable and others are not.

**Bad.** A retired key version that still has rows is an outage for those connections, which
is why step 5 exists and why `open()` names the missing version in its error instead of
saying "decryption failed". The count query is the gate, and skipping it is the one way to
get this wrong.

**Neutral.** The keyring is unbounded in principle. In practice more than two live versions
means a rotation that never drained, which is a signal rather than a state to design for.

---

## When to revisit

1. A key is suspected compromised. The lazy drain is too slow for that: rotate, then read
   every row deliberately rather than waiting for traffic, and treat step 6 as urgent.
2. Credentials that expire and refresh arrive. An offline Shopify token does not, but Etsy's
   does at A6, and a refresh writes the row anyway — which drains the tail as a side effect
   and makes step 5 mostly unnecessary for that channel.
3. A managed KMS replaces the environment variable. The keyring shape survives that: a
   version becomes a key ARN rather than base64, and nothing above step 1 changes.
