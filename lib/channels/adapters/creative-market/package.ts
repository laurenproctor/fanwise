import type { AdapterSubject } from "@/lib/channels/types"
import type { PackageSpec } from "@/lib/products/package-spec"
import type { ProductAsset } from "@/lib/products/types"

/**
 * What goes in the Creative Market package, docs/channels/creative-market.md §7.
 *
 * Every ready buyer file, in the creator's order; the documentation and
 * license files as attachments; and a README written from the canonical
 * record alone, no model anywhere near it. A file the creator already zipped
 * is re-wrapped by the build so the buyer never opens a zip inside a zip.
 */

const BUYER_TYPES: readonly string[] = ["deliverable", "archive"]
const ATTACHMENT_TYPES: readonly string[] = ["documentation", "license"]

export function buyerFiles(assets: readonly ProductAsset[]): ProductAsset[] {
  return assets.filter(
    (a) =>
      a.derived_from === null && a.asset_state === "ready" && BUYER_TYPES.includes(a.asset_type),
  )
}

export function attachmentFiles(assets: readonly ProductAsset[]): ProductAsset[] {
  return assets.filter(
    (a) =>
      a.derived_from === null &&
      a.asset_state === "ready" &&
      ATTACHMENT_TYPES.includes(a.asset_type),
  )
}

export function packageFilename(slug: string): string {
  return `${slug}-creative-market.zip`
}

/** Plain text a buyer can read in any editor. Facts from the record only. */
export function readmeText(subject: AdapterSubject, files: readonly ProductAsset[]): string {
  const { product } = subject
  const lines: string[] = []
  lines.push(product.canonical_title?.trim() || product.name)
  lines.push("=".repeat(Math.min(72, (product.canonical_title?.trim() || product.name).length)))
  lines.push("")
  if (product.brand_name?.trim()) lines.push(`By ${product.brand_name.trim()}`)
  if (product.version?.trim()) lines.push(`Version ${product.version.trim()}`)
  if (product.brand_name?.trim() || product.version?.trim()) lines.push("")
  if (product.short_description?.trim()) {
    lines.push(product.short_description.trim(), "")
  }
  lines.push("Files")
  lines.push("-----")
  for (const file of files) lines.push(`  ${file.filename}`)
  lines.push("")
  if (product.license_summary?.trim()) {
    lines.push("License", "-------", product.license_summary.trim(), "")
  }
  if (product.support_url?.trim() || product.documentation_url?.trim()) {
    lines.push("Links", "-----")
    if (product.documentation_url?.trim())
      lines.push(`  Documentation: ${product.documentation_url.trim()}`)
    if (product.support_url?.trim()) lines.push(`  Support: ${product.support_url.trim()}`)
    lines.push("")
  }
  return lines.join("\n")
}

export function creativeMarketPackage(subject: AdapterSubject): PackageSpec | null {
  const files = buyerFiles(subject.assets)
  if (files.length === 0) return null
  const attachments = attachmentFiles(subject.assets)
  const entries = [...files, ...attachments]
    .filter((a) => a.checksum !== null)
    .map((a) => ({ assetId: a.id, checksum: a.checksum!, path: a.filename }))
  if (entries.length === 0) return null
  return {
    key: "buyer-files-readme",
    filename: packageFilename(subject.product.slug),
    entries,
    readme: { path: "README.txt", text: readmeText(subject, [...files, ...attachments]) },
  }
}
