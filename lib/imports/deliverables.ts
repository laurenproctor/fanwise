import type { BuyerDeliverable, LicenseSelection } from "./types"

/**
 * Where the buyer's files come from, behind an interface.
 *
 * The same shape of boundary as `service.ts`, for the same reason: the screen
 * is built now and the storage under it lands later. The real implementation
 * mints a signed upload URL with `createUploadIntent`, the browser PUTs to it,
 * and the `finalize_asset` job measures the stored object and writes `ready`.
 * Nothing the browser said about the file survives that.
 *
 * **The fixture implementation below cannot measure anything**, because there
 * is no server in this phase. It records what the browser reported and marks
 * the row `ready` so the five-step readiness can be exercised end to end. The
 * screen says "not verified yet" next to such a row, so nothing on it claims
 * more than it knows, and the rule readiness applies — only a `ready` row
 * counts — is the real rule and is unchanged when the server arrives.
 */

export interface ChosenFile {
  readonly name: string
  readonly size: number
}

export interface DeliverableStore {
  add(file: ChosenFile): Promise<BuyerDeliverable>
}

export function createFixtureDeliverableStore(
  newId: () => string = () => `deliverable-${Math.random().toString(36).slice(2, 10)}`,
): DeliverableStore {
  return {
    async add(file: ChosenFile): Promise<BuyerDeliverable> {
      return {
        id: newId(),
        filename: file.name,
        byteSize: file.size,
        state: "ready",
      }
    },
  }
}

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
