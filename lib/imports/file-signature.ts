import type { ImportSourceType } from "./types"

/**
 * What a stored file actually is, from its first bytes.
 *
 * The browser's MIME type and the file's extension are both things a person
 * can change by renaming a file, so neither decides. The migration holds the
 * extension to the declared type; this holds the bytes to it.
 */

export type SniffedType =
  | { type: "pdf"; mimeType: "application/pdf" }
  | { type: "html"; mimeType: "text/html" }
  | {
      type: "audio"
      mimeType: "audio/webm" | "audio/ogg" | "audio/mp4" | "audio/wav"
      extension: AudioExtension
    }

export type AudioExtension = "webm" | "ogg" | "m4a" | "wav"

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false
  return signature.every((byte, index) => bytes[offset + index] === byte)
}

export function sniffAudio(bytes: Uint8Array): SniffedType | null {
  // EBML header: Matroska and WebM.
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    return { type: "audio", mimeType: "audio/webm", extension: "webm" }
  }
  // "OggS"
  if (startsWith(bytes, [0x4f, 0x67, 0x67, 0x53])) {
    return { type: "audio", mimeType: "audio/ogg", extension: "ogg" }
  }
  // "ftyp" at offset 4: the ISO base media family a browser records AAC into.
  if (startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
    return { type: "audio", mimeType: "audio/mp4", extension: "m4a" }
  }
  // "RIFF" .... "WAVE"
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x41, 0x56, 0x45], 8)
  ) {
    return { type: "audio", mimeType: "audio/wav", extension: "wav" }
  }
  return null
}

/**
 * Whether bytes are what their row says they are.
 *
 * HTML has no signature, so it is held to the next best thing: valid UTF-8 text
 * with no NUL byte in its first kilobytes and something tag-shaped in it. A
 * binary renamed `.html` fails the first two; a text file renamed fails the
 * third.
 */
export function sniff(
  declared: Exclude<ImportSourceType, "public_url" | "pasted_text">,
  bytes: Uint8Array,
): SniffedType | null {
  if (declared === "pdf") {
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024))
    return head.includes("%PDF-") ? { type: "pdf", mimeType: "application/pdf" } : null
  }
  if (declared === "audio") return sniffAudio(bytes)

  const head = bytes.subarray(0, 8192)
  if (head.includes(0)) return null
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(
      head.length === bytes.length ? head : trimPartialUtf8(head),
    )
  } catch {
    return null
  }
  return /<[a-z!/][^>]*>/i.test(text) ? { type: "html", mimeType: "text/html" } : null
}

/** A prefix cut mid-character is not invalid UTF-8; drop the partial tail. */
function trimPartialUtf8(bytes: Uint8Array): Uint8Array {
  let end = bytes.length
  for (let back = 1; back <= 3 && end - back >= 0; back += 1) {
    const byte = bytes[end - back]!
    if ((byte & 0xc0) === 0x80) continue
    if ((byte & 0xc0) === 0xc0) end -= back
    break
  }
  return bytes.subarray(0, end)
}
