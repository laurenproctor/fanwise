/** The mime types the sniffer gives a font, stated once for every reader. */
const FONT_MIME_TYPES = new Set(["font/otf", "font/ttf", "font/woff", "font/woff2"])

export function isFontMimeType(mimeType: string | null | undefined): boolean {
  return mimeType !== null && mimeType !== undefined && FONT_MIME_TYPES.has(mimeType)
}
