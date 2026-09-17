import { createHash } from "node:crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import { isJunkPath } from "@/lib/fonts/junk"
import { sha256 } from "./assets"
import { buildStoragePath, downloadObject, removeObjects, uploadObject } from "./storage"
import { cleanPath, listZipEntries, readZipEntryRaw } from "./zip"
import { writeZip, type ZipWriteEntry } from "./zip-write"
import type { ProductAsset } from "./types"
import { PACKAGE_LIMITS, packageSource, type PackageSpec } from "./package-spec"

export type { PackageEntry, PackageSpec } from "./package-spec"
export { PACKAGE_LIMITS, packageSource, readPackageManifest } from "./package-spec"

/**
 * The package build: the buyer's files, a README and the license documents,
 * in one zip, built once per set of inputs and cached the way an image
 * derivative is.
 *
 * Channel-neutral. An adapter names what goes in and what the archive is
 * called (`PackageSpec`); this file has no idea which marketplace asked. The
 * row it writes is a derivative of the first file in the spec, with the spec
 * hash as its cache key, so every reader that lists sources (`derived_from`
 * is null) never sees it: it is not a buyer file of the product, it is a
 * rendering of them for one handoff, and a channel that uploads deliverables
 * must not upload it. `asset_type` is `other` for the same reason.
 *
 * A file the creator already zipped is re-wrapped, not nested: its entries
 * are copied through compressed, so the buyer opens one archive and finds
 * the fonts beside the README rather than a zip inside a zip. Operating
 * system leftovers inside it are dropped, and a path that climbs is skipped.
 *
 * Bounded. The inputs are read into memory the way a derivative's source
 * is, so the total is capped well under what a worker holds and far under
 * what the format allows without ZIP64.
 *
 * Server-side only: the spec, limits and manifest reader an adapter needs
 * are in `./package-spec.ts`, which imports nothing.
 */

export interface BuildPackagePayload {
  workspaceId: string
  productId: string
  spec: PackageSpec
}

/** Canonical, order-dependent hash of a spec: the order is the archive's order. */
export function packageSpecHash(spec: PackageSpec): string {
  const canonical = JSON.stringify({
    key: spec.key,
    filename: spec.filename,
    entries: spec.entries.map((e) => [e.assetId, e.checksum, e.path]),
    readme: spec.readme ? [spec.readme.path, spec.readme.text] : null,
  })
  return createHash("sha256").update(canonical).digest("hex")
}

/** The row a package spec would have produced, if the build has run. */
export function findPackage(
  spec: PackageSpec,
  assets: readonly ProductAsset[],
): ProductAsset | null {
  const source = packageSource(spec)
  if (!source) return null
  const hash = packageSpecHash(spec)
  return (
    assets.find(
      (a) => a.derived_from === source && a.spec_hash === hash && a.asset_state === "ready",
    ) ?? null
  )
}

export interface BuildPackageResult {
  assetId: string
  cached: boolean
}

function isArchive(asset: ProductAsset): boolean {
  return (
    asset.mime_type === "application/zip" ||
    asset.mime_type === "application/x-zip-compressed" ||
    /\.zip$/i.test(asset.filename)
  )
}

/** A path with no leading slash, no `.` segments and no climb. Null when it climbs. */
function safePath(path: string): string | null {
  const cleaned = cleanPath(path)
  if (cleaned.length === 0) return null
  if (cleaned.split("/").some((segment) => segment === "..")) return null
  return cleaned
}

/** `name.ext`, `name-2.ext`, `name-3.ext`: two files with one name both arrive. */
function unique(path: string, taken: Set<string>): string {
  if (!taken.has(path)) {
    taken.add(path)
    return path
  }
  const match = /^(.*?)(\.[^./]+)?$/.exec(path)!
  const stem = match[1] ?? path
  const extension = match[2] ?? ""
  for (let n = 2; ; n += 1) {
    const candidate = `${stem}-${n}${extension}`
    if (!taken.has(candidate)) {
      taken.add(candidate)
      return candidate
    }
  }
}

/**
 * Builds the package, or returns the existing one.
 *
 * Runs as a background job, so it uses the service-role client and BYPASSES
 * RLS. Per docs/security.md rule 4 the workspace is scoped by hand on every
 * query, and the inputs must all belong to the one product the payload names.
 */
export async function buildPackage(payload: BuildPackagePayload): Promise<BuildPackageResult> {
  const admin = createAdminClient()
  const { spec } = payload
  const source = packageSource(spec)
  if (!source) throw new Error("a package needs at least one file")
  if (!/\.zip$/i.test(spec.filename)) throw new Error("a package is a zip")
  const hash = packageSpecHash(spec)

  const { data: existing } = await admin
    .from("product_assets")
    .select("id")
    .eq("derived_from", source)
    .eq("spec_hash", hash)
    .maybeSingle()
  if (existing) return { assetId: existing.id, cached: true }

  const ids = spec.entries.map((e) => e.assetId)
  const { data: rows, error } = await admin
    .from("product_assets")
    .select("*")
    .in("id", ids)
    .eq("workspace_id", payload.workspaceId) // service role bypasses RLS; scope by hand
    .eq("product_id", payload.productId)
  if (error) throw error
  const byId = new Map((rows ?? []).map((row) => [row.id, row]))

  let total = 0
  for (const entry of spec.entries) {
    const row = byId.get(entry.assetId)
    if (!row) throw new Error(`package input ${entry.assetId} is not this product's`)
    if (row.asset_state !== "ready") throw new Error(`package input ${row.filename} is not ready`)
    if (row.checksum !== entry.checksum) throw new Error(`package input ${row.filename} changed`)
    total += row.byte_size ?? 0
  }
  if (total > PACKAGE_LIMITS.maxInputBytes) {
    throw new Error(
      `package inputs are ${total} bytes, over the ${PACKAGE_LIMITS.maxInputBytes} limit`,
    )
  }

  const taken = new Set<string>()
  const zipEntries: ZipWriteEntry[] = []
  const manifest: string[] = []
  const add = (entry: ZipWriteEntry) => {
    zipEntries.push(entry)
    if (manifest.length < PACKAGE_LIMITS.maxManifestEntries) manifest.push(entry.path)
  }

  for (const entry of spec.entries) {
    const row = byId.get(entry.assetId)!
    const data = await downloadObject(row.storage_path)
    const base = safePath(entry.path) ?? safePath(row.filename)
    if (!base) continue

    if (isArchive(row)) {
      const listing = listZipEntries(data)
      if (!listing.ok) {
        // A zip Fanwise cannot read is carried as it is: nested, but delivered.
        add({ path: unique(base, taken), data })
        continue
      }
      // The creator's archive lands under the folder its name implies.
      const folder = base.replace(/\.zip$/i, "")
      for (const inner of listing.entries) {
        if (inner.isDirectory || isJunkPath(inner.path)) continue
        const innerPath = safePath(inner.path)
        if (!innerPath) continue
        add({ path: unique(`${folder}/${innerPath}`, taken), raw: readZipEntryRaw(data, inner) })
      }
      continue
    }

    add({ path: unique(base, taken), data })
  }

  if (spec.readme) {
    const path = safePath(spec.readme.path)
    if (path) add({ path: unique(path, taken), data: Buffer.from(spec.readme.text, "utf8") })
  }

  const bytes = writeZip(zipEntries)

  const assetId = crypto.randomUUID()
  const storagePath = buildStoragePath({
    workspaceId: payload.workspaceId,
    productId: payload.productId,
    assetId,
    filename: spec.filename,
  })
  await uploadObject(storagePath, bytes, "application/zip")

  const { data: inserted, error: insertError } = await admin
    .from("product_assets")
    .insert({
      id: assetId,
      workspace_id: payload.workspaceId,
      product_id: payload.productId,
      // Not a deliverable and not an archive of the product: a rendering of
      // them for one handoff. Readers that select buyer files by type never
      // see it, and readers that list sources skip it as derived.
      asset_type: "other",
      asset_state: "ready",
      storage_path: storagePath,
      filename: spec.filename,
      mime_type: "application/zip",
      byte_size: bytes.byteLength,
      checksum: sha256(bytes),
      derived_from: source,
      spec_hash: hash,
      sort_order: 0,
      metadata: {
        packageKey: spec.key,
        entryCount: zipEntries.length,
        entries: manifest,
      },
    })
    .select("id")
    .single()

  if (insertError) {
    // A concurrent build won the unique index. Clean up our object and use theirs.
    await removeObjects([storagePath]).catch(() => {})
    const { data: winner } = await admin
      .from("product_assets")
      .select("id")
      .eq("derived_from", source)
      .eq("spec_hash", hash)
      .maybeSingle()
    if (winner) return { assetId: winner.id, cached: true }
    throw insertError
  }

  return { assetId: inserted.id, cached: false }
}
