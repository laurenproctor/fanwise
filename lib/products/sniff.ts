/**
 * Content-type sniffing from magic numbers.
 *
 * The browser-supplied type is a hint, not evidence: it is trivially spoofed and
 * frequently just wrong. The finalize job records what the bytes actually are.
 *
 * Deliberately a short table rather than a dependency. It covers what creators
 * upload, and anything unrecognised degrades to application/octet-stream, which
 * is honest.
 */

interface Signature {
  mime: string
  offset: number
  bytes: number[]
}

const SIGNATURES: Signature[] = [
  { mime: "image/jpeg", offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png", offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/gif", offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: "application/pdf", offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] },
  // zip, and everything built on it. Also matches .docx, .xlsx and friends.
  { mime: "application/zip", offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] },
  { mime: "application/zip", offset: 0, bytes: [0x50, 0x4b, 0x05, 0x06] },
  { mime: "font/otf", offset: 0, bytes: [0x4f, 0x54, 0x54, 0x4f] },
  { mime: "font/ttf", offset: 0, bytes: [0x00, 0x01, 0x00, 0x00, 0x00] },
  { mime: "font/woff", offset: 0, bytes: [0x77, 0x4f, 0x46, 0x46] },
  { mime: "font/woff2", offset: 0, bytes: [0x77, 0x4f, 0x46, 0x32] },
]

const RIFF = [0x52, 0x49, 0x46, 0x46]
const WEBP = [0x57, 0x45, 0x42, 0x50]

function matches(data: Buffer, offset: number, bytes: number[]): boolean {
  if (data.length < offset + bytes.length) return false
  return bytes.every((byte, i) => data[offset + i] === byte)
}

export const FALLBACK_MIME = "application/octet-stream"

export function sniffMimeType(data: Buffer): string {
  // webp needs two windows: RIFF....WEBP
  if (matches(data, 0, RIFF) && matches(data, 8, WEBP)) return "image/webp"

  // svg is text and has no magic number worth trusting. Look for the root
  // element inside the opening bytes only.
  const head = data.subarray(0, 512).toString("utf8").trimStart()
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) {
    return "image/svg+xml"
  }

  for (const signature of SIGNATURES) {
    if (matches(data, signature.offset, signature.bytes)) return signature.mime
  }

  return FALLBACK_MIME
}

/**
 * Raster formats sharp can decode and therefore derive from. svg is deliberately
 * absent: it is an image, but rasterising untrusted svg is a different risk
 * conversation than resizing a jpeg, and A2 does not need it.
 */
const DERIVABLE = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"])

export function isDerivableImage(mimeType: string): boolean {
  return DERIVABLE.has(mimeType)
}
