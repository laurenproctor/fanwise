import { z } from "zod"
import { ChannelError, normalized } from "@/lib/channels/errors"
import type { GumroadClient } from "./client"
import { LIMITS } from "./config"

/**
 * The presigned multipart upload, docs/channels/gumroad.md §5 stage 1.
 *
 * Four calls per file: presign, one PUT per 100 MB part straight to the
 * seller's storage prefix, complete, and on any failure before complete,
 * abort. Complete is never retried; Gumroad's documentation says the upload
 * id works once, and a lost response means a fresh presign.
 *
 * The bytes are streamed from the asset's signed URL and never held whole:
 * a deliverable can be gigabytes, and a worker that buffered one would fall
 * over on exactly the products this exists for.
 */

const presignSchema = z.object({
  upload_id: z.string().min(1),
  key: z.string().min(1),
  file_url: z.string().min(1),
  parts: z
    .array(z.object({ part_number: z.number().int().positive(), presigned_url: z.string().min(1) }))
    .min(1),
})

const completeSchema = z.object({ file_url: z.string().min(1) })

const abortSchema = z.object({ status: z.string().optional() })

export interface UploadSource {
  filename: string
  byteSize: number
  /** Opens the bytes. Called once. */
  open(): Promise<Response>
}

export interface UploadedFile {
  /** The canonical address, which Gumroad returns only here and never again. */
  fileUrl: string
  key: string
  uploadId: string
  parts: number
}

export interface UploadOptions {
  fetchImpl?: typeof fetch
  partBytes?: number
}

/** Yields the body in parts of exactly `partBytes`, the last one shorter. */
async function* partsOf(
  body: ReadableStream<Uint8Array>,
  partBytes: number,
): AsyncGenerator<Uint8Array> {
  const reader = body.getReader()
  let pending: Uint8Array[] = []
  let pendingBytes = 0

  const take = (): Uint8Array => {
    const out = new Uint8Array(Math.min(partBytes, pendingBytes))
    let offset = 0
    const rest: Uint8Array[] = []
    for (const chunk of pending) {
      const room = out.length - offset
      if (room <= 0) {
        rest.push(chunk)
        continue
      }
      if (chunk.length <= room) {
        out.set(chunk, offset)
        offset += chunk.length
      } else {
        out.set(chunk.subarray(0, room), offset)
        offset += room
        rest.push(chunk.subarray(room))
      }
    }
    pending = rest
    pendingBytes -= out.length
    return out
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value || value.length === 0) continue
    pending.push(value)
    pendingBytes += value.length
    while (pendingBytes >= partBytes) yield take()
  }
  if (pendingBytes > 0) yield take()
}

function uploadFailed(message: string, raw: unknown): ChannelError {
  return new ChannelError(normalized("unknown", message, raw))
}

/**
 * Cancels an upload that will not complete. Gumroad says to call again while
 * the answer is `accepted` and stop at `already_gone`; three tries is enough
 * for the parts in flight to land, and past that the orphan is Gumroad's.
 */
export async function abortUpload(
  client: GumroadClient,
  upload: { uploadId: string; key: string },
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const answer = await client.request({
      method: "POST",
      path: "files/abort",
      body: { kind: "json", value: { upload_id: upload.uploadId, key: upload.key } },
      schema: abortSchema,
    })
    if (answer.status !== "accepted") return
  }
}

export async function uploadFile(
  client: GumroadClient,
  source: UploadSource,
  options: UploadOptions = {},
): Promise<UploadedFile> {
  const doFetch = options.fetchImpl ?? fetch
  const partBytes = options.partBytes ?? LIMITS.partBytes

  const presigned = await client.request({
    method: "POST",
    path: "files/presign",
    body: {
      kind: "json",
      value: { filename: source.filename, file_size: source.byteSize },
    },
    schema: presignSchema,
  })
  const upload = { uploadId: presigned.upload_id, key: presigned.key }

  try {
    const response = await source.open()
    if (!response.ok || !response.body) {
      throw uploadFailed(
        "Fanwise could not read one of the product's files to send it to Gumroad. Try again.",
        { status: response.status },
      )
    }

    const etags: { part_number: number; etag: string }[] = []
    let index = 0
    for await (const bytes of partsOf(response.body, partBytes)) {
      const part = presigned.parts[index]
      if (!part) {
        throw uploadFailed(
          "One of the product's files is larger than Fanwise recorded, so Gumroad could not take it. Upload the file again.",
          { expectedParts: presigned.parts.length, filename: source.filename },
        )
      }
      // `take` allocates each part fresh and exactly sized, so its buffer is
      // the part and nothing else.
      const put = await doFetch(part.presigned_url, {
        method: "PUT",
        headers: { "Content-Length": String(bytes.byteLength) },
        body: bytes.buffer as ArrayBuffer,
      })
      const etag = put.headers.get("etag")
      if (!put.ok || !etag) {
        throw uploadFailed(
          "Gumroad's storage did not accept part of the file. This will be retried on the next publish.",
          { status: put.status, part: part.part_number, filename: source.filename },
        )
      }
      etags.push({ part_number: part.part_number, etag })
      index += 1
    }

    if (etags.length !== presigned.parts.length) {
      throw uploadFailed(
        "One of the product's files is shorter than Fanwise recorded, so Gumroad could not take it. Upload the file again.",
        { expectedParts: presigned.parts.length, sent: etags.length, filename: source.filename },
      )
    }

    const completed = await client.request({
      method: "POST",
      path: "files/complete",
      body: {
        kind: "json",
        value: { upload_id: upload.uploadId, key: upload.key, parts: etags },
      },
      schema: completeSchema,
    })

    return {
      fileUrl: completed.file_url,
      key: upload.key,
      uploadId: upload.uploadId,
      parts: etags.length,
    }
  } catch (error) {
    // Best effort. The original failure is the one reported; an abort that
    // fails too leaves an unattached upload Gumroad expires on its own.
    await abortUpload(client, upload).catch(() => {})
    throw error
  }
}
