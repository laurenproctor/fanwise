"use client"

import { useState } from "react"
import { PublicImage } from "./public-image"

/**
 * The product's images: one large, the rest as thumbnails beneath it.
 *
 * Implemented as a tablist rather than a carousel. A carousel hides most of
 * its content behind a control the visitor has to discover, animates by
 * default, and is the single most common place a page traps a keyboard. A row
 * of thumbnails shows what there is, and arrow keys move between them because
 * the tab pattern gives that for free.
 *
 * A single image renders as a single image, with no tablist at all: a set of
 * one is not a choice.
 */
export function ProductGallery({ assetIds, title }: { assetIds: string[]; title: string }) {
  const [active, setActive] = useState(0)

  if (assetIds.length === 0) {
    return (
      <div
        style={{ aspectRatio: "4 / 3" }}
        className="flex w-full items-center justify-center rounded-[16px] border border-[var(--color-rule)] bg-[var(--color-paper-2)]"
      >
        <span className="label-mono">No images yet</span>
      </div>
    )
  }

  if (assetIds.length === 1) {
    return (
      <div className="overflow-hidden rounded-[16px] border border-[var(--color-rule)]">
        <PublicImage
          assetId={assetIds[0]!}
          alt={title}
          priority
          ratio="4 / 3"
          sizes="(max-width: 1024px) 100vw, 58vw"
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-[16px] border border-[var(--color-rule)]">
        {/*
          Every panel is rendered and all but one hidden, rather than
          swapping the src on one <img>. Swapping means the new image decodes
          after the click, so the frame goes blank and then jumps; keeping them
          mounted means each is decoded once and switching is instant. `hidden`
          rather than a class, so a hidden panel is out of the accessibility
          tree too.
        */}
        {assetIds.map((assetId, index) => (
          <div
            key={assetId}
            role="tabpanel"
            id={`gallery-panel-${index}`}
            aria-labelledby={`gallery-tab-${index}`}
            hidden={index !== active}
          >
            <PublicImage
              assetId={assetId}
              alt={index === 0 ? title : `${title}, image ${index + 1} of ${assetIds.length}`}
              priority={index === 0}
              ratio="4 / 3"
              sizes="(max-width: 1024px) 100vw, 58vw"
            />
          </div>
        ))}
      </div>

      <div
        role="tablist"
        aria-label={`${title} images`}
        className="flex gap-3 overflow-x-auto pb-1"
        onKeyDown={(event) => {
          // Arrow keys move between tabs, which is what makes this a tablist
          // rather than a row of buttons that happens to look like one.
          const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0
          if (delta === 0) return
          event.preventDefault()
          const next = (active + delta + assetIds.length) % assetIds.length
          setActive(next)
          document.getElementById(`gallery-tab-${next}`)?.focus()
        }}
      >
        {assetIds.map((assetId, index) => (
          <button
            key={assetId}
            id={`gallery-tab-${index}`}
            role="tab"
            type="button"
            aria-selected={index === active}
            aria-controls={`gallery-panel-${index}`}
            // Only the active tab is in the tab order; the arrow keys reach
            // the others. This is the roving tabindex the pattern requires.
            tabIndex={index === active ? 0 : -1}
            onClick={() => setActive(index)}
            className={`w-[96px] shrink-0 overflow-hidden rounded-[10px] border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${
              index === active
                ? "border-[var(--color-ink)]"
                : "border-[var(--color-rule)] hover:border-[var(--color-ink-3)]"
            }`}
          >
            <PublicImage assetId={assetId} alt="" ratio="1 / 1" sizes="96px" />
            <span className="sr-only">
              Image {index + 1} of {assetIds.length}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
