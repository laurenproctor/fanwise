"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { FormError } from "@/components/ui/form-error"
import { createUploadIntent, deleteAssetAction, finalizeUploadAction } from "@/lib/products/actions"
import {
  ASSET_STATE_LABELS,
  ASSET_TYPES,
  ASSET_TYPE_LABELS,
  type AssetState,
  type AssetType,
  type ProductAsset,
} from "@/lib/products/types"
import { routes } from "@/lib/routes"

/**
 * Upload goes straight from the browser to storage using a signed URL the
 * server minted. The bytes never pass through a serverless function, which is
 * what makes a 4 GB deliverable possible at all.
 */

const STATE_STYLES: Record<AssetState, string> = {
  pending: "border-[var(--color-warn)] text-[var(--color-ink-2)]",
  ready: "border-[var(--color-ok)] text-[var(--color-ok)]",
  failed: "border-[var(--color-bad)] text-[var(--color-ink)]",
}

function StatePill({ state }: { state: AssetState }) {
  // Readable from form as well as colour: dot plus label, never colour alone.
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${STATE_STYLES[state]}`}
    >
      <span className="h-[5px] w-[5px] rounded-full bg-current" aria-hidden />
      {ASSET_STATE_LABELS[state]}
    </span>
  )
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—"
  const units = ["B", "KB", "MB", "GB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

export function AssetManager({
  workspaceSlug,
  productId,
  sources,
  derivativesBySource,
}: {
  workspaceSlug: string
  productId: string
  sources: ProductAsset[]
  derivativesBySource: Record<string, ProductAsset[]>
}) {
  const router = useRouter()
  const [assetType, setAssetType] = useState<AssetType>("deliverable")
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [isPending, startTransition] = useTransition()

  async function upload(file: File) {
    setError(null)
    setUploading(true)
    try {
      const result = await createUploadIntent(workspaceSlug, {
        productId,
        assetType,
        filename: file.name,
        byteSize: file.size,
      })

      if ("error" in result) {
        setError(result.error)
        return
      }

      const response = await fetch(result.intent.signedUrl, {
        method: "PUT",
        body: file,
        headers: { "content-type": file.type || "application/octet-stream" },
      })

      if (!response.ok) {
        setError("The upload did not complete. Try again.")
        return
      }

      await finalizeUploadAction(workspaceSlug, result.intent.assetId)
      // Re-fetch the server components, rather than reloading the document.
      // A full reload here raced React's transition and blanked the page.
      router.refresh()
    } catch {
      setError("The upload did not complete. Try again.")
    } finally {
      setUploading(false)
    }
  }

  function remove(assetId: string) {
    startTransition(async () => {
      const result = await deleteAssetAction(workspaceSlug, assetId)
      if (result.error) setError(result.error)
      else router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <FormError message={error} />

      <div className="flex flex-wrap items-end gap-4 rounded-[14px] border border-[var(--color-rule)] p-5">
        <label className="flex flex-col gap-2">
          <span className="label-mono">File type</span>
          <select
            value={assetType}
            onChange={(event) => setAssetType(event.target.value as AssetType)}
            className="rounded-[10px] border border-[var(--color-rule)] bg-[var(--color-card)] px-3 py-2.5 text-[15px] outline-none focus:border-[var(--color-accent)]"
          >
            {ASSET_TYPES.map((type) => (
              <option key={type} value={type}>
                {ASSET_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-2">
          <span className="label-mono">Add a file</span>
          <input
            type="file"
            disabled={uploading || isPending}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void upload(file)
              event.target.value = ""
            }}
            className="text-[14px] text-[var(--color-ink-2)] file:mr-3 file:rounded-[var(--radius-pill)] file:border file:border-[var(--color-rule)] file:bg-transparent file:px-4 file:py-2 file:text-[13px]"
          />
        </label>

        {uploading ? (
          <span className="label-mono" aria-live="polite">
            Uploading…
          </span>
        ) : null}
      </div>

      {sources.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-[14px] border border-dashed border-[var(--color-rule)] p-8">
          <span className="label-mono">No files yet</span>
          <p className="max-w-prose text-[15px] text-[var(--color-ink-2)]">
            Add the deliverable your buyer receives, and the images you want channels to show.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[14px] border border-[var(--color-rule)]">
          <table className="w-full border-collapse bg-[var(--color-card)] text-left">
            <thead>
              <tr className="border-b border-[var(--color-rule)]">
                <th className="label-mono p-4 font-normal">File</th>
                <th className="label-mono p-4 font-normal">Type</th>
                <th className="label-mono p-4 font-normal">State</th>
                <th className="label-mono p-4 font-normal">Size</th>
                <th className="label-mono p-4 font-normal">Derivatives</th>
                <th className="label-mono p-4 font-normal" />
              </tr>
            </thead>
            <tbody>
              {sources.map((asset) => {
                const derivatives = derivativesBySource[asset.id] ?? []
                return (
                  <tr
                    key={asset.id}
                    className="border-b border-[var(--color-rule-2)] last:border-b-0 align-top"
                  >
                    <td className="p-4">
                      <div className="font-display text-[17px] font-normal">{asset.filename}</div>
                      {asset.failure_reason ? (
                        <div className="mt-1 text-[13px] text-[var(--color-ink-2)]">
                          {asset.failure_reason}
                        </div>
                      ) : null}
                    </td>
                    <td className="p-4 font-mono text-[13px] text-[var(--color-ink-2)]">
                      {ASSET_TYPE_LABELS[asset.asset_type]}
                    </td>
                    <td className="p-4">
                      <StatePill state={asset.asset_state} />
                    </td>
                    <td className="tabular p-4 font-mono text-[13px] text-[var(--color-ink-2)]">
                      {formatBytes(asset.byte_size)}
                    </td>
                    <td className="p-4 font-mono text-[13px] text-[var(--color-ink-2)]">
                      {derivatives.length === 0 ? (
                        "—"
                      ) : (
                        <ul className="flex flex-col gap-1">
                          {derivatives.map((derivative) => (
                            <li key={derivative.id}>
                              <a
                                href={routes.assetDownload(workspaceSlug, derivative.id)}
                                className="underline underline-offset-4 hover:text-[var(--color-accent)]"
                              >
                                {derivative.filename}
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        {asset.asset_state === "ready" ? (
                          <a
                            href={routes.assetDownload(workspaceSlug, asset.id)}
                            className="text-[14px] underline underline-offset-4 hover:text-[var(--color-accent)]"
                          >
                            Download
                          </a>
                        ) : null}
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => remove(asset.id)}
                          className="text-[14px] text-[var(--color-ink-2)] underline underline-offset-4 hover:text-[var(--color-ink)]"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
