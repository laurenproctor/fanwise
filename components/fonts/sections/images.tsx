"use client"

import { useMemo, useRef, useState } from "react"
import { ListingImages, type ListingImage } from "@/components/channels/listing-images"
import { deleteAssetAction, reorderProductImagesAction } from "@/lib/products/actions"
import { uploadProductFile } from "@/lib/products/upload-client"
import { setImageAltTextAction } from "@/lib/fonts/actions"
import { FIELD_IDS } from "@/lib/fonts/readiness"
import {
  GRID_SHAPES,
  MIN_HERO_WIDTH,
  cropLoss,
  type SpecimenImageView,
} from "@/lib/fonts/workspace"
import { routes } from "@/lib/routes"
import type { SectionContext } from "../context"
import { INPUT_CLASS, QUIET_BUTTON_CLASS, SectionHeading, StatusIcon } from "../controls"

/**
 * Pictures of the type, which are not the type tester.
 *
 * Upload, order and deletion are the product image panel every other product
 * uses, so the first image is the cover here exactly as it is on every channel.
 * Below it, per image: how it sits in the storefront preview, how much a square
 * or 4:3 grid crops away, and alt text for buyers using a screen reader.
 *
 * The live preview on the right is set in the uploaded font and is separate
 * from these images; it is never exported as one.
 */
export function SpecimenImagesSection({ ctx }: { ctx: SectionContext }) {
  const listingImages = useMemo<ListingImage[]>(
    () =>
      ctx.images.map((image) => ({
        id: image.id,
        filename: image.filename,
        assetType: image.assetType,
        state: image.state,
        checksum: image.checksum,
      })),
    [ctx.images],
  )
  const ready = ctx.images.filter((image) => image.state === "ready")

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading
        title="Specimen images"
        description="The pictures storefronts show. Drag to reorder: the first image is the cover."
      />

      {/* The shared panel is sized for the wider product page; contained here so a
          long row of tiles scrolls inside the editor instead of under the preview. */}
      <div id={FIELD_IDS.imageDrop} tabIndex={-1} className="min-w-0 overflow-x-auto outline-none">
        <ListingImages
          workspaceSlug={ctx.workspaceSlug}
          productId={ctx.productId}
          channelName={null}
          images={listingImages}
        />
      </div>

      <div id={FIELD_IDS.imageDetails} tabIndex={-1} className="flex flex-col gap-3 outline-none">
        <h3 className="text-[14px]">Crops and descriptions</h3>
        {ready.length === 0 ? (
          <p className="text-[14px] text-[var(--color-ink-3)]">
            Upload an image to see how grids crop it and to describe it.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--color-rule-2)] border-y border-[var(--color-rule)]">
            {ready.map((image, index) => (
              <ImageDetail
                key={image.id}
                ctx={ctx}
                image={image}
                position={index}
                order={ctx.images.map((i) => i.id)}
              />
            ))}
          </ul>
        )}
        <p className="text-[12.5px] text-[var(--color-ink-3)]">
          Crops are shown for the two grid shapes storefronts commonly use. Keep lettering inside
          the middle of the image so it survives either.
        </p>
      </div>
    </div>
  )
}

function ImageDetail({
  ctx,
  image,
  position,
  order,
}: {
  ctx: SectionContext
  image: SpecimenImageView
  position: number
  order: string[]
}) {
  const [alt, setAlt] = useState(image.altText)
  const [altState, setAltState] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [altError, setAltError] = useState<string | null>(null)
  const [replacing, setReplacing] = useState(false)
  const [replaceError, setReplaceError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saved = useRef(image.altText)
  const fileRef = useRef<HTMLInputElement>(null)
  const src = routes.assetPreview(ctx.workspaceSlug, image.id)
  const altId = `image-alt-${image.id}`

  function saveAlt(value: string) {
    if (value === saved.current) return
    setAltState("saving")
    void setImageAltTextAction(ctx.workspaceSlug, image.id, value).then(
      (result) => {
        if (result.error) {
          setAltState("error")
          setAltError(result.error)
          return
        }
        saved.current = value
        setAltError(null)
        setAltState("saved")
      },
      () => {
        setAltState("error")
        setAltError("Couldn't save. Check your connection and try again.")
      },
    )
  }

  async function replace(file: File) {
    setReplacing(true)
    setReplaceError(null)
    try {
      const result = await uploadProductFile({
        workspaceSlug: ctx.workspaceSlug,
        productId: ctx.productId,
        assetType: image.assetType,
        file,
      })
      if (result.error || !result.assetId) {
        setReplaceError(result.error ?? "The upload did not complete. Try again.")
        return
      }
      // The new image takes the old one's place in the order, then the old one goes.
      const next = order.map((id) => (id === image.id ? result.assetId! : id))
      const reordered = await reorderProductImagesAction(ctx.workspaceSlug, ctx.productId, next)
      if (reordered.error) {
        setReplaceError(`Uploaded, but it could not take this image's place: ${reordered.error}`)
        return
      }
      const removed = await deleteAssetAction(ctx.workspaceSlug, image.id)
      if (removed.error) setReplaceError(`Uploaded, but the old image stays: ${removed.error}`)
      ctx.refresh()
    } catch {
      setReplaceError("The upload was interrupted. Try again.")
    } finally {
      setReplacing(false)
    }
  }

  const small = image.width !== null && image.width < MIN_HERO_WIDTH

  return (
    <li className="grid gap-4 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <div className="flex flex-col gap-2">
        <p className="flex flex-wrap items-baseline gap-x-2 text-[14px]">
          <span className="truncate" title={image.filename}>
            {image.filename}
          </span>
          <span className="text-[12.5px] text-[var(--color-ink-3)]">
            {position === 0 ? "Cover" : `Image ${position + 1}`}
            {image.width && image.height
              ? ` · ${image.width} × ${image.height}`
              : " · size unknown"}
          </span>
        </p>
        <div className="flex gap-3">
          {GRID_SHAPES.map((shape) => {
            const loss =
              image.width && image.height ? cropLoss(image.width, image.height, shape.ratio) : null
            return (
              <figure key={shape.key} className="flex w-[7.5rem] flex-col gap-1">
                <div
                  className="overflow-hidden rounded-[6px] border border-[var(--color-rule)] bg-[var(--color-paper-2)]"
                  style={{ aspectRatio: String(shape.ratio) }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- a signed, redirecting preview URL, not a static asset */}
                  <img src={src} alt="" className="h-full w-full object-cover" />
                </div>
                <figcaption className="flex items-center gap-1 text-[11.5px] text-[var(--color-ink-2)]">
                  {loss !== null && loss > 0.25 ? (
                    <StatusIcon status="attention" size={13} />
                  ) : null}
                  {shape.label}
                  {loss !== null ? ` · ${Math.round(loss * 100)}% cropped` : ""}
                </figcaption>
              </figure>
            )
          })}
        </div>
        {small ? (
          <p className="flex items-center gap-1.5 text-[12.5px] text-[var(--color-ink-2)]">
            <StatusIcon status="attention" size={14} />
            Narrower than {MIN_HERO_WIDTH}px. It will look soft when shown large.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={altId} className="text-[14px]">
          Alt text
        </label>
        <textarea
          id={altId}
          rows={2}
          maxLength={250}
          value={alt}
          aria-describedby={`${altId}-status`}
          aria-invalid={altState === "error" || undefined}
          placeholder="Blimp Display set large in black on white, spelling “Blimp”."
          onChange={(event) => {
            const value = event.target.value
            setAlt(value)
            setAltState("idle")
            if (timer.current) clearTimeout(timer.current)
            timer.current = setTimeout(() => saveAlt(value), 900)
          }}
          onBlur={() => {
            if (timer.current) clearTimeout(timer.current)
            saveAlt(alt)
          }}
          className={INPUT_CLASS}
        />
        <p id={`${altId}-status`} role="status" className="text-[12.5px] text-[var(--color-ink-3)]">
          {altState === "saving"
            ? "Saving…"
            : altState === "saved"
              ? "Saved"
              : altState === "error"
                ? altError
                : "Describe what the image shows, including any words set in it."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={QUIET_BUTTON_CLASS}
            disabled={replacing}
            onClick={() => fileRef.current?.click()}
          >
            {replacing ? "Replacing…" : "Replace image"}
            <span className="sr-only"> {image.filename}</span>
          </button>
          {altState === "error" ? (
            <button type="button" className={QUIET_BUTTON_CLASS} onClick={() => saveAlt(alt)}>
              Try again
            </button>
          ) : null}
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ""
              if (file) void replace(file)
            }}
          />
        </div>
        {replaceError ? (
          <p role="alert" className="text-[13px] text-[var(--color-danger)]">
            {replaceError}
          </p>
        ) : null}
      </div>
    </li>
  )
}
