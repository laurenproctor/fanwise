"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { FormError } from "@/components/ui/form-error"
import {
  createUploadIntent,
  deleteAssetAction,
  finalizeUploadAction,
  reorderProductImagesAction,
} from "@/lib/products/actions"

/**
 * The images this channel will receive, in the order it will receive them.
 *
 * **Position is the whole model.** The first image is the cover, and there is
 * no control for choosing one: dragging a picture to the front is already the
 * creator saying "lead with this", and a separate cover picker would ask the
 * same question twice and then have to reconcile the two answers. The first
 * tile is rendered larger for the same reason — it is not decoration, it is the
 * only thing on screen that says which image a storefront grid will show.
 *
 * Two structural notes, both easy to undo by accident later.
 *
 * It uploads to the **product**, not the listing. Architecture invariant 1: an
 * image is a fact about the product that several channels want, not a
 * channel-specific field, so it lands in product_assets like every other file.
 * This panel is a convenient doorway to the same place the product page writes
 * to, not a second store.
 *
 * It says what publishing will do to the channel. `productSet` is a set
 * operation, so the next update replaces the channel's media with this list.
 * That follows from invariant 1 and is what a creator managing images here
 * should get, but it silently discards an image added in the channel's own
 * admin, so the panel says so rather than letting someone find out.
 */

export interface ListingImage {
  id: string
  filename: string
  assetType: "cover_image" | "preview_image"
  state: "pending" | "ready" | "failed"
}

export function ListingImages({
  workspaceSlug,
  productId,
  channelName,
  images,
  published,
}: {
  workspaceSlug: string
  productId: string
  channelName: string
  images: ListingImage[]
  /** True once the channel holds a product, which changes what a change means. */
  published: boolean
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [pending, startTransition] = useTransition()

  /*
   * A local copy, so a drag reorders the grid on release rather than after a
   * round trip. The server is still the authority: `images` replacing this on
   * every refresh is what makes a rejected reorder snap back rather than
   * leaving the screen disagreeing with the database.
   */
  const [order, setOrder] = useState(images)
  const [dragging, setDragging] = useState<string | null>(null)

  /*
   * Re-sync during render rather than in an effect. React's own guidance for
   * adjusting state when a prop changes: an effect would paint the stale order
   * first and then correct it, which is a visible flicker on exactly the
   * interaction this component exists for.
   */
  const [lastSeen, setLastSeen] = useState(images)
  if (lastSeen !== images) {
    setLastSeen(images)
    setOrder(images)
  }

  function persist(next: ListingImage[]) {
    const previous = order
    setOrder(next)
    startTransition(async () => {
      const result = await reorderProductImagesAction(
        workspaceSlug,
        productId,
        next.map((image) => image.id),
      )
      if (result.error) {
        setError(result.error)
        setOrder(previous)
        return
      }
      router.refresh()
    })
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= order.length || from === to) return
    const next = [...order]
    const [moved] = next.splice(from, 1)
    if (moved) next.splice(to, 0, moved)
    persist(next)
  }

  async function upload(file: File) {
    setError(null)
    setUploading(true)
    try {
      const result = await createUploadIntent(workspaceSlug, {
        productId,
        // The first image a product gets is its cover; everything after it is a
        // preview until someone drags it to the front. Uploading is not a place
        // to make a creator answer a question the order already answers.
        assetType: order.length === 0 ? "cover_image" : "preview_image",
        filename: file.name,
        byteSize: file.size,
      })

      if ("error" in result) {
        setError(result.error)
        return
      }

      // Straight to storage, never through a server function. The signed URL is
      // a bearer capability and the server chose the path it points at, so the
      // browser cannot aim it anywhere else. See docs/security.md.
      const response = await fetch(result.intent.signedUrl, {
        method: "PUT",
        body: file,
        headers: { "content-type": file.type || "application/octet-stream" },
      })

      if (!response.ok) {
        setError("The upload did not complete. Try again.")
        return
      }

      // The row stays pending until a background job has measured the stored
      // bytes; nothing the browser said about the file is trusted.
      await finalizeUploadAction(workspaceSlug, result.intent.assetId)
      router.refresh()
    } catch {
      setError("The upload did not complete. Try again.")
    } finally {
      setUploading(false)
    }
  }

  function remove(assetId: string) {
    setError(null)
    startTransition(async () => {
      const result = await deleteAssetAction(workspaceSlug, assetId)
      if (result.error) setError(result.error)
      else router.refresh()
    })
  }

  return (
    <section className="grid gap-5 rounded-[14px] border border-[var(--color-rule)] bg-[var(--color-card)] p-6">
      <div className="grid gap-1.5">
        <h2 className="label-mono">Images</h2>
        <p className="max-w-prose text-[15px] text-[var(--color-ink-2)]">
          The first image is the cover, and it is the one {channelName} shows in its grid. Drag to
          reorder.
          {published
            ? ` Sending changes replaces the images on ${channelName} with this list, including any added there directly.`
            : ` These go to ${channelName} when you publish.`}
        </p>
      </div>

      <FormError message={error} />

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {order.map((image, index) => {
          const isCover = index === 0
          return (
            <li
              key={image.id}
              draggable={!pending}
              onDragStart={() => setDragging(image.id)}
              onDragEnd={() => setDragging(null)}
              // Without preventDefault a drop never fires. This is the single
              // most common way a native drag-and-drop list silently does
              // nothing at all.
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                const from = order.findIndex((candidate) => candidate.id === dragging)
                setDragging(null)
                if (from !== -1) move(from, index)
              }}
              className={`group relative grid cursor-grab gap-2 rounded-[10px] border p-2 transition-opacity ${
                isCover
                  ? "col-span-2 row-span-2 border-[var(--color-accent)]"
                  : "border-[var(--color-rule)]"
              } ${dragging === image.id ? "opacity-40" : ""}`}
            >
              <div
                className={`relative overflow-hidden rounded-[6px] bg-[var(--color-paper-2)] ${
                  isCover ? "aspect-[16/10]" : "aspect-[4/3]"
                }`}
              >
                {image.state === "ready" ? (
                  /*
                    A plain <img>, not next/image. The source 307s to a
                    short-lived signed URL on a private bucket, so there is
                    nothing for the optimizer to cache and a stale optimized
                    copy would outlive the signature it was fetched with.
                  */
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/w/${workspaceSlug}/assets/${image.id}/preview`}
                    alt={image.filename}
                    draggable={false}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="label-mono absolute inset-0 grid place-items-center">
                    {image.state === "failed" ? "Failed" : "Uploading"}
                  </span>
                )}

                {isCover ? (
                  <span className="absolute left-2 top-2 rounded-[var(--radius-pill)] bg-[var(--color-accent)] px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-white">
                    Cover
                  </span>
                ) : null}
              </div>

              <span className="truncate text-[12px] text-[var(--color-ink-2)]">
                {image.filename}
              </span>

              {/*
                Dragging is not reachable from a keyboard, so the same two moves
                exist as buttons. An ordering control that only works with a
                mouse is an ordering control some people cannot use at all.
              */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => move(index, index - 1)}
                  disabled={pending || index === 0}
                  aria-label={`Move ${image.filename} earlier`}
                  className="rounded-[4px] px-1 text-[13px] text-[var(--color-ink-3)] hover:text-[var(--color-ink)] disabled:opacity-30"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => move(index, index + 1)}
                  disabled={pending || index === order.length - 1}
                  aria-label={`Move ${image.filename} later`}
                  className="rounded-[4px] px-1 text-[13px] text-[var(--color-ink-3)] hover:text-[var(--color-ink)] disabled:opacity-30"
                >
                  →
                </button>
                <button
                  type="button"
                  onClick={() => remove(image.id)}
                  disabled={pending}
                  className="ml-auto text-[12px] text-[var(--color-ink-3)] underline underline-offset-2 hover:text-[var(--color-ink)] disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </li>
          )
        })}

        {/*
          The uploader is a tile in the same grid rather than a separate row, so
          "add another" sits where the images are instead of somewhere the eye
          has to go looking for it.
        */}
        <li className="grid">
          <label
            className={`grid cursor-pointer place-items-center gap-1 rounded-[10px] border border-dashed border-[var(--color-rule)] p-4 text-center hover:border-[var(--color-accent)] ${
              order.length === 0 ? "col-span-2 aspect-[16/10]" : "aspect-[4/3]"
            }`}
          >
            <span className="label-mono">{uploading ? "Uploading…" : "Add image"}</span>
            <span className="text-[12px] text-[var(--color-ink-3)]">
              {order.length === 0 ? "The first one becomes the cover" : "JPG or PNG"}
            </span>
            <input
              type="file"
              accept="image/*"
              disabled={uploading || pending}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void upload(file)
                // Cleared so choosing the same file twice fires change again.
                event.target.value = ""
              }}
              className="sr-only"
            />
          </label>
        </li>
      </ul>
    </section>
  )
}
