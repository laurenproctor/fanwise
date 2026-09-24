import { z } from "zod"
import { ChannelError, normalized } from "@/lib/channels/errors"
import type { PolarClient } from "./client"
import { LIMITS } from "./config"

/**
 * The presigned multipart upload, docs/channels/polar.md §5 stage 1.
 *
 * Polar wants the parts declared before a byte moves: `POST /files` takes
 * the size and one `{ number, chunk_start, chunk_end }` per part (end
 * exclusive, as Polar's own client sends it) and answers with one presigned
 * URL per part, each with the headers S3 expects. The worker `PUT`s each part
 * straight to storage, keeps the ETag, and `POST /files/{id}/uploaded`
 * closes the upload. Nothing here is retried past the client's own in-call
 * tier: a lost completion means a fresh create, and the orphan is Polar's.
 *
 * Two services share the code. A downloadable is streamed from its signed
 * URL and never held whole, because a deliverable can be gigabytes. An image
 * is read whole first, because its size is only known once the rendition
 * exists and Polar needs the size to presign; ten megabytes is the ceiling.
 */

const partSchema = z.object({
  number: z.number().int().positive(),
  chunk_start: z.number().int().nonnegative(),
  chunk_end: z.number().int().positive(),
  url: z.string().min(1),
  headers: z.record(z.string(), z.string()).default({}),
})

const createdSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  upload: z.object({
    id: z.string().min(1),
    path: z.string().min(1),
    parts: z.array(partSchema).min(1),
  }),
})

const completedSchema = z.object({
  id: z.string().min(1),
  is_uploaded: z.boolean().optional(),
})

export type UploadService = "downloadable" | "product_media"

export interface UploadSource {
  filename: string
  mimeType: string
  byteSize: number
  /** Opens the bytes. Called once. */
  open(): Promise<Response>
}

export interface UploadedFile {
  fileId: string
  path: string
  parts: number
}

export interface UploadOptions {
  fetchImpl?: typeof fetch
  partBytes?: number
}

/** Polar's shape for one part: `[start, end)` byte offsets, numbered from 1. */
export function declareParts(
  byteSize: number,
  partBytes: number,
): { number: number; chunk_start: number; chunk_end: number }[] {
  const count = Math.max(1, Math.ceil(byteSize / partBytes))
  return Array.from({ length: count }, (_, i) => ({
    number: i + 1,
    chunk_start: i * partBytes,
    chunk_end: Math.min((i + 1) * partBytes, byteSize),
  }))
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

export async function uploadFile(
  client: PolarClient,
  organizationId: string,
  service: UploadService,
  source: UploadSource,
  options: UploadOptions = {},
): Promise<UploadedFile> {
  const doFetch = options.fetchImpl ?? fetch
  const partBytes = options.partBytes ?? LIMITS.partBytes

  const created = await client.request({
    method: "POST",
    path: "files",
    body: {
      kind: "json",
      value: {
        organization_id: organizationId,
        service,
        name: source.filename,
        mime_type: source.mimeType,
        size: source.byteSize,
        upload: { parts: declareParts(source.byteSize, partBytes) },
      },
    },
    schema: createdSchema,
  })

  const response = await source.open()
  if (!response.ok || !response.body) {
    throw uploadFailed(
      "Fanwise could not read one of the product's files to send it to Polar. Try again.",
      { status: response.status, filename: source.filename },
    )
  }

  const etags: { number: number; checksum_etag: string; checksum_sha256_base64: null }[] = []
  let index = 0
  for await (const bytes of partsOf(response.body, partBytes)) {
    const part = created.upload.parts[index]
    if (!part) {
      throw uploadFailed(
        "One of the product's files is larger than Fanwise recorded, so Polar could not take it. Upload the file again.",
        { expectedParts: created.upload.parts.length, filename: source.filename },
      )
    }
    // `take` allocates each part fresh and exactly sized, so its buffer is
    // the part and nothing else.
    const put = await doFetch(part.url, {
      method: "PUT",
      headers: { ...part.headers, "Content-Length": String(bytes.byteLength) },
      body: bytes.buffer as ArrayBuffer,
    })
    const etag = put.headers.get("etag")
    if (!put.ok || !etag) {
      throw uploadFailed(
        "Polar's storage did not accept part of the file. This will be retried on the next publish.",
        { status: put.status, part: part.number, filename: source.filename },
      )
    }
    etags.push({ number: part.number, checksum_etag: etag, checksum_sha256_base64: null })
    index += 1
  }

  if (etags.length !== created.upload.parts.length) {
    throw uploadFailed(
      "One of the product's files is shorter than Fanwise recorded, so Polar could not take it. Upload the file again.",
      { expectedParts: created.upload.parts.length, sent: etags.length, filename: source.filename },
    )
  }

  const completed = await client.request({
    method: "POST",
    path: `files/${encodeURIComponent(created.id)}/uploaded`,
    body: {
      kind: "json",
      value: { id: created.upload.id, path: created.upload.path, parts: etags },
    },
    schema: completedSchema,
  })

  return { fileId: completed.id, path: created.path, parts: etags.length }
}
