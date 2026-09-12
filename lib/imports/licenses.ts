import type { LicenseSelection } from "./types"

/**
 * The licenses offered before a license model exists.
 *
 * `products.license_summary` is one free-text column today, and a license
 * catalog is its own feature. These three are the summaries that column would
 * hold, offered as presets so that the common case is one click and the
 * uncommon case is still typing. Choosing "Write my own" and leaving it empty
 * does not satisfy the step; `readiness.ts` checks the summary, not the choice.
 */
export const LICENSE_PRESETS: readonly LicenseSelection[] = [
  {
    id: "personal",
    name: "Personal use",
    summary: "For personal projects only. No commercial use, and no redistribution.",
  },
  {
    id: "commercial",
    name: "Commercial use",
    summary:
      "For personal and commercial projects by the buyer. No redistribution and no resale of the files themselves.",
  },
  {
    id: "extended",
    name: "Extended commercial",
    summary:
      "For personal and commercial projects, including work sold to the buyer's own clients and use in products for sale. No redistribution of the files themselves.",
  },
]

export const CUSTOM_LICENSE_ID = "custom"

/** A license the creator wrote. Empty summary in, incomplete step out. */
export function customLicense(summary: string): LicenseSelection {
  return { id: CUSTOM_LICENSE_ID, name: "Your own terms", summary }
}
