"use client"

import { useId, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { FormError } from "@/components/ui/form-error"
import {
  createUploadIntent,
  deleteAssetAction,
  finalizeUploadAction,
  reorderProductImagesAction,
} from "@/lib/products/actions"
import { routes } from "@/lib/routes"
import { useBackgroundRefresh } from "@/lib/use-background-refresh"
import { planImageDrop } from "@/lib/products/image-drop"

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
 * Files can be dropped anywhere on the panel, not only on the dashed tile.
 * A miss would otherwise hit the page, and a browser handed a file it was not
 * offered navigates away to it, taking any unsaved edit on the screen with it.
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
  /**
   * The channel this panel is speaking for, or null on the product page, where
   * the same images are being managed for every channel at once.
   *
   * Optional rather than a second component: the images are product assets
   * either way, the ordering is the same ordering, and two grids that drift
   * apart would be a worse outcome than one sentence that changes.
   */
  channelName: string | null
  images: ListingImage[]
  /** True once the channel holds a product, which changes what a change means. */
  published?: boolean
}) {
  const router = useRouter()
  /*
   * Naming the section off its own heading makes it a landmark rather than an
   * anonymous <section>, which is what a screen reader needs to announce a drop
   * target that is now the whole panel rather than one visible tile.
   */
  const headingId = useId()
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
   * Two different drags land in this section and they must not be confused. A
   * tile being dragged to a new position carries text/plain; a file coming from
   * the desktop carries Files. `types` is the only part of a dataTransfer
   * readable during dragover — `files` is empty until the drop itself, by
   * design, so that a page cannot read what is being dragged over it — so it is
   * what both handlers key on.
   */
  const [fileOver, setFileOver] = useState(false)

  /*
   * dragenter and dragleave fire for every child the cursor crosses, so a
   * boolean flipped by dragleave goes dark the moment the pointer passes over a
   * tile inside the drop zone. Counting depth is the standard fix; a ref rather
   * than state because it changes several times per second and nothing renders
   * from it directly.
   */
  const dragDepth = useRef(0)

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

  /*
   * A tile says "Uploading" until the finalize job has measured the stored
   * bytes, and that job finishes after the refresh which followed the upload.
   * Without this the tile stays wrong until someone reloads.
   */
  useBackgroundRefresh(order.some((image) => image.state === "pending"))

  function isFileDrag(transfer: DataTransfer) {
    return transfer.types.includes("Files")
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

  /**
   * One file, all the way to storage. Returns false once something has gone
   * wrong and the error is already on screen, so a batch stops rather than
   * pushing the rest of a drop at a failing storage endpoint.
   *
   * The caller decides `assetType` rather than this function reading `order`,
   * because a batch has to number its own files: four images dropped onto an
   * empty product are one cover and three previews, and `order` does not move
   * until the refresh at the end.
   */
  async function uploadOne(file: File, assetType: "cover_image" | "preview_image") {
    const result = await createUploadIntent(workspaceSlug, {
      productId,
      assetType,
      filename: file.name,
      byteSize: file.size,
    })

    if ("error" in result) {
      setError(result.error)
      return false
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
      return false
    }

    // The row stays pending until a background job has measured the stored
    // bytes; nothing the browser said about the file is trusted.
    await finalizeUploadAction(workspaceSlug, result.intent.assetId)
    return true
  }

  /**
   * The one path both the file picker and a drop take.
   *
   * Sequential rather than parallel: each file needs its own intent row minted
   * before its bytes go anywhere, and ten photographs dropped at once opening
   * ten concurrent uploads is how a creator on a domestic connection gets ten
   * timeouts instead of one working batch. One refresh at the end, so the grid
   * does not reshuffle under the cursor between files.
   */
  async function upload(files: readonly File[]) {
    const plan = planImageDrop(files, order.length)
    if (!plan.ok) {
      setError(
        plan.reason === "no_files"
          ? "That did not carry a file. Drop an image, or click to choose one."
          : "Only images can go here. Try a JPG, PNG, GIF or WebP.",
      )
      return
    }

    setError(null)
    setUploading(true)
    try {
      for (const item of plan.uploads) {
        if (!(await uploadOne(item.file, item.assetType))) return
      }
      if (plan.skipped > 0) {
        // Not an error: the images that were images did land. Saying nothing
        // would leave a creator counting tiles to work out what happened.
        setError(
          plan.skipped === 1
            ? "One file was not an image and was skipped."
            : `${plan.skipped} files were not images and were skipped.`,
        )
      }
    } catch {
      setError("The upload did not complete. Try again.")
    } finally {
      setUploading(false)
      router.refresh()
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
    <section
      aria-labelledby={headingId}
      /*
        The whole panel is the drop target, not just the dashed tile. Aiming a
        file at one small square is a fiddly gesture, and a file dropped an inch
        wide of it would otherwise hit the page and navigate the browser away to
        the file — losing unsaved edits elsewhere on the screen. Accepting the
        whole section makes the miss impossible rather than merely unlikely.
      */
      onDragEnter={(event) => {
        if (!isFileDrag(event.dataTransfer)) return
        dragDepth.current += 1
        setFileOver(true)
      }}
      onDragOver={(event) => {
        if (!isFileDrag(event.dataTransfer)) return
        // Without preventDefault on dragover the drop never fires and the
        // browser navigates to the file instead. This is the single most
        // common way a drop zone silently does nothing at all.
        event.preventDefault()
        event.dataTransfer.dropEffect = "copy"
      }}
      onDragLeave={(event) => {
        if (!isFileDrag(event.dataTransfer)) return
        dragDepth.current -= 1
        if (dragDepth.current <= 0) {
          dragDepth.current = 0
          setFileOver(false)
        }
      }}
      onDrop={(event) => {
        if (!isFileDrag(event.dataTransfer)) return
        event.preventDefault()
        dragDepth.current = 0
        setFileOver(false)
        if (uploading || pending) return
        void upload(Array.from(event.dataTransfer.files))
      }}
      className={`grid gap-5 rounded-[14px] border p-6 transition-colors ${
        fileOver
          ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
          : "border-[var(--color-rule)] bg-[var(--color-card)]"
      }`}
    >
      <div className="grid gap-1.5">
        <h2 id={headingId} className="label-mono">
          Images
        </h2>
        <p className="max-w-prose text-[15px] text-[var(--color-ink-2)]">
          The first image is the cover, and it is the one {channelName ?? "a storefront"} shows in
          its grid. Drop files anywhere here to add them, and drag to reorder.
          {channelName === null
            ? " Every channel receives this list, in this order."
            : published
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
              onDragStart={(event) => {
                setDragging(image.id)
                /*
                  Firefox refuses to begin a drag whose dataTransfer carries
                  nothing, and the failure is silent: the element simply does
                  not lift. The id is the honest payload, and setting an
                  explicit move effect stops the cursor promising a copy.
                */
                event.dataTransfer.setData("text/plain", image.id)
                event.dataTransfer.effectAllowed = "move"
              }}
              onDragEnd={() => setDragging(null)}
              /*
                A file dragged from the desktop passes straight through to the
                section, which uploads it. Claiming it here would mean a photo
                dropped on an existing tile — the most natural place to aim
                one — landing on a handler that has no index to reorder to and
                therefore does nothing, silently.
              */
              onDragOver={(event) => {
                if (isFileDrag(event.dataTransfer)) return
                // Without preventDefault a drop never fires. This is the single
                // most common way a native drag-and-drop list silently does
                // nothing at all.
                event.preventDefault()
                event.dataTransfer.dropEffect = "move"
              }}
              onDrop={(event) => {
                if (isFileDrag(event.dataTransfer)) return
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
                    src={routes.assetPreview(workspaceSlug, image.id)}
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
        {/*
          The column span belongs on the <li>, which is the grid item the <ul>
          lays out. On the <label> it did nothing: the label is a child of the
          li's own single-column grid, so it was spanning one column of one.
          The empty-state tile has been full width in intent and one column in
          fact since it was written.
        */}
        <li className={`grid ${order.length === 0 ? "col-span-2" : ""}`}>
          <label
            /*
              w-full pins the width to the column. Without it the aspect ratio
              was free to derive width from height, and height is whatever the
              row happens to be — which, next to a cover spanning two rows, is
              tall. The tile then computed itself wider than its column and hung
              out past the panel. An aspect ratio needs one side nailed down or
              it will pick the wrong one.
            */
            className={`grid w-full cursor-pointer place-items-center gap-1 rounded-[10px] border border-dashed border-[var(--color-rule)] p-4 text-center hover:border-[var(--color-accent)] ${
              order.length === 0 ? "aspect-[16/10]" : "aspect-[4/3]"
            }`}
          >
            <span className="label-mono">
              {uploading ? "Uploading…" : fileOver ? "Drop to add" : "Add images"}
            </span>
            <span className="text-[12px] text-[var(--color-ink-3)]">
              {order.length === 0
                ? "Drop them here, or click. The first becomes the cover"
                : "Drop them here, or click"}
            </span>
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={uploading || pending}
              onChange={(event) => {
                // A cancelled picker should say nothing at all, so an empty
                // selection never reaches upload's "that carried no file".
                const picked = Array.from(event.target.files ?? [])
                if (picked.length > 0) void upload(picked)
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
