"use client"

import { useEffect } from "react"

/**
 * Stops a file dropped on the page from navigating the browser away.
 *
 * A browser handed a file it was not offered treats it as a request to open
 * it, and replaces the document. There is no warning and no way back to what
 * was on screen: an unsaved edit in the product form is simply gone, because
 * someone missed a drop zone by an inch. The images panel is generous about
 * what counts as a hit for exactly this reason, but a panel can only defend
 * its own bounds, and the rest of the page is where a miss lands.
 *
 * Three deliberate exemptions, in the order they are checked.
 *
 * A drag carrying no file is left alone entirely. Reordering images is a drag,
 * and swallowing it here would break the gesture this guard sits next to.
 *
 * A drag something has already claimed is left alone. `defaultPrevented` is the
 * signal that a real drop zone took it, and it matters for the cursor as much
 * as the drop: window is the last stop in the bubble, so setting dropEffect
 * unconditionally would overwrite the panel's "copy" with "none" and show a
 * refusal over a target that in fact accepts the file.
 *
 * A native file input is left alone. Dropping onto `<input type="file">` fills
 * it, with no JavaScript involved anywhere — the Files section relies on this —
 * and that happens as the default action, which is precisely what a
 * preventDefault here would cancel. Fixing one silent failure by introducing
 * another is not a trade worth making.
 *
 * Both listeners are needed. Skipping dragover is the tempting simplification
 * and it does not work: without preventDefault there, the specification says
 * the drop event never fires at all and the browser goes straight to
 * navigating, so there is nothing left to intercept.
 */
export function StrayFileDropGuard() {
  useEffect(() => {
    function carriesFiles(event: DragEvent) {
      return event.dataTransfer?.types.includes("Files") ?? false
    }

    function boundForAFileInput(target: EventTarget | null) {
      return target instanceof Element && target.closest('input[type="file"]') !== null
    }

    function unclaimed(event: DragEvent) {
      return (
        carriesFiles(event) && !event.defaultPrevented && !boundForAFileInput(event.target)
      )
    }

    function onDragOver(event: DragEvent) {
      if (!unclaimed(event)) return
      event.preventDefault()
      // Says "you cannot drop that here" while the file is still in the air,
      // rather than accepting it and quietly doing nothing with it.
      if (event.dataTransfer) event.dataTransfer.dropEffect = "none"
    }

    function onDrop(event: DragEvent) {
      if (!unclaimed(event)) return
      event.preventDefault()
    }

    window.addEventListener("dragover", onDragOver)
    window.addEventListener("drop", onDrop)
    return () => {
      window.removeEventListener("dragover", onDragOver)
      window.removeEventListener("drop", onDrop)
    }
  }, [])

  return null
}
