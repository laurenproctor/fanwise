import { sanitizeFilename } from "./storage"

/**
 * The name a download arrives under when the caller asked for one.
 *
 * An assisted channel's handoff hands over renditions under names the
 * channel's editor sorts by, and a package under the name buyers will see,
 * and neither is the row's filename. The extension is kept from the row
 * whatever was asked for, so a file cannot arrive claiming to be a type it
 * is not. Nothing asked for, or nothing usable, means the row's own name.
 */
export function downloadName(filename: string, requested: string | null | undefined): string {
  if (!requested || requested.trim().length === 0) return filename
  const wanted = sanitizeFilename(requested)
  const extension = filename.match(/\.[A-Za-z0-9]+$/)?.[0] ?? ""
  const stem = wanted.replace(/\.[A-Za-z0-9]+$/, "").trim()
  return stem.length === 0 ? filename : `${stem}${extension}`
}
