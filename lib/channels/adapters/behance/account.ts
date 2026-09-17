import type { AccountHintSpec, SubmissionSpec } from "@/lib/channels/types"

/**
 * The two addresses Fanwise parses for this channel: the profile a creator
 * connects, and the project they report submitted. Both are parsed here and
 * nowhere else, because a hostname pattern in a shared util is a provider
 * name outside the adapter layer.
 */

const HOSTS = ["behance.net", "www.behance.net"]
const USERNAME = /^[A-Za-z0-9_-]{1,64}$/

function parseUrl(raw: string): URL | null {
  const trimmed = raw.trim()
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(withScheme)
    return HOSTS.includes(url.hostname.toLowerCase()) ? url : null
  } catch {
    return null
  }
}

/**
 * A username, a handle with an @, or a profile URL. What is stored is the
 * username: it is the one form that is stable across the ways it was typed.
 */
export const behanceAccountHint: AccountHintSpec = {
  label: "Behance profile",
  placeholder: "behance.net/yourname",
  parse(raw) {
    const trimmed = raw.trim().replace(/^@/, "")
    let username = trimmed
    if (/[./]/.test(trimmed)) {
      const url = parseUrl(trimmed)
      const first = url?.pathname.split("/").filter(Boolean)[0]
      if (!url || !first || first === "gallery") {
        return { ok: false, message: "Enter your Behance username or your profile's address." }
      }
      username = first
    }
    if (!USERNAME.test(username)) {
      return { ok: false, message: "Enter your Behance username or your profile's address." }
    }
    return { ok: true, value: username, name: `behance.net/${username}` }
  },
}

/**
 * A project URL: behance.net/gallery/{id}/{slug}. The numeric id is the
 * external listing id, and whether it is stable across edits is §13 item 8.
 * The stored URL is canonical, so the same project pasted two ways is one row.
 */
export const behanceSubmission: SubmissionSpec = {
  urlLabel: "Project URL",
  urlPlaceholder: "https://www.behance.net/gallery/123456789/your-project",
  parseUrl(raw) {
    const url = parseUrl(raw)
    const parts = url?.pathname.split("/").filter(Boolean) ?? []
    const id = parts[0] === "gallery" ? parts[1] : undefined
    if (!url || !id || !/^\d{1,20}$/.test(id)) {
      return {
        ok: false,
        message: "Paste the project's address on Behance. It looks like behance.net/gallery/…",
      }
    }
    const slug = parts[2] && /^[A-Za-z0-9_-]{1,200}$/.test(parts[2]) ? `/${parts[2]}` : ""
    return {
      ok: true,
      externalListingId: id,
      externalUrl: `https://www.behance.net/gallery/${id}${slug}`,
    }
  },
}
