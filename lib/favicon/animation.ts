/**
 * The favicon's schedule, with no DOM in it.
 *
 * The mark contracts into its source point and fans out again: nine SVG
 * frames, about a second end to end. Three things start it, and the rules for
 * each are the whole of this file.
 *
 *   - **Load.** Once, shortly after Fanwise first opens in a tab, whether or
 *     not the tab is in front. The component decides whether this page load
 *     has already had its turn, so a remount never earns a second one.
 *   - **A first publication.** Once, at once, in front or not, when a
 *     product's first listing is confirmed on a channel. The component hears
 *     that as a window event; who may send it is documented on the event.
 *   - **An inactive tab.** Every `intervalMs` while the tab stays hidden,
 *     counted from the moment it was hidden, and never while it is in front.
 *     Coming back cancels the countdown; leaving again starts a fresh one.
 *
 * Reduced motion wins over all three: the static mark, nothing else.
 *
 * Kept pure so the schedule is tested with fake timers rather than a browser.
 * The host supplies the few facts and effects the schedule needs; the React
 * component in components/ui/animated-favicon.tsx supplies a real one.
 */

/** How long each frame holds, in order. Nine frames, about a second. */
export const FAVICON_FRAME_HOLDS_MS: readonly number[] = [90, 90, 110, 120, 110, 110, 140, 120, 90]

function frameHref(index: number): string {
  return `/fanwise-favicon/frames/fanwise-${String(index).padStart(2, "0")}.svg`
}

/** The frame files, in play order. Frame 0 is the resting mark. */
export const FAVICON_FRAMES: readonly string[] = FAVICON_FRAME_HOLDS_MS.map((_, index) =>
  frameHref(index),
)

/** Frame 0: the mark at rest, identical to public/fanwise-favicon/favicon.svg. */
export const FAVICON_RESTING_FRAME: string = frameHref(0)

/** 8 minutes 32 seconds. Rare on purpose: a reminder, not a notification. */
export const FAVICON_INACTIVE_INTERVAL_MS = 512_000

/** After first paint has settled, before anyone is looking for it. */
export const FAVICON_LOAD_DELAY_MS = 450

export interface FaviconHost {
  /** Points the icon at one frame. Called with frame 0 to rest. */
  showFrame(href: string): void
  /** `document.hidden`, or the test's stand-in for it. */
  hidden(): boolean
  /** `prefers-reduced-motion: reduce`, or the test's stand-in for it. */
  reducedMotion(): boolean
  /**
   * The load sequence is about to play. The component records this at module
   * level so a remount, which builds a fresh animator, is handed
   * `loadDelayMs: null` and stays quiet.
   */
  loadSequenceStarted?(): void
  setTimeout?(callback: () => void, ms: number): unknown
  clearTimeout?(handle: unknown): void
}

export interface FaviconAnimatorOptions {
  frames?: readonly string[]
  holdsMs?: readonly number[]
  intervalMs?: number
  /** Null plays no load sequence: this page load has already had its one. */
  loadDelayMs?: number | null
}

export interface FaviconAnimator {
  /** Rests the icon, arms the inactive countdown if hidden, arms the load sequence. */
  start(): void
  /** On visibilitychange and on a motion-preference change. */
  syncWithPageActivity(): void
  /** On the product-published event. Plays at once, in front or not. */
  productPublished(): void
  /** Clears every timer. The icon is left wherever it was. */
  stop(): void
}

export function createFaviconAnimator(
  host: FaviconHost,
  options: FaviconAnimatorOptions = {},
): FaviconAnimator {
  const frames = options.frames ?? FAVICON_FRAMES
  const holds = options.holdsMs ?? FAVICON_FRAME_HOLDS_MS
  const intervalMs = options.intervalMs ?? FAVICON_INACTIVE_INTERVAL_MS
  const loadDelayMs =
    options.loadDelayMs === undefined ? FAVICON_LOAD_DELAY_MS : options.loadDelayMs
  const setTimer =
    host.setTimeout ?? ((callback: () => void, ms: number) => globalThis.setTimeout(callback, ms))
  const clearTimer =
    host.clearTimeout ??
    ((handle: unknown) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>))

  const resting = frames[0]
  if (resting === undefined) throw new Error("The favicon needs at least one frame.")

  let timer: unknown
  let loadTimer: unknown
  /*
   * Every scheduled thing belongs to a cycle, and a cancel moves the cycle on.
   * A frame callback that wakes up in a later cycle rests the icon and stops,
   * so a sequence can never keep going after the thing that started it has
   * been overtaken: a tab coming to the front mid-fan, say.
   */
  let cycle = 0

  // An arrow, not a declaration: a hoisted function cannot see the guard
  // above that proved `resting` is a string.
  const rest = () => host.showFrame(resting)

  function cancel() {
    cycle += 1
    if (timer !== undefined) clearTimer(timer)
    timer = undefined
  }

  function scheduleWhileInactive() {
    if (!host.hidden() || host.reducedMotion()) return
    timer = setTimer(() => play(false), intervalMs)
  }

  function play(allowWhileVisible: boolean) {
    if ((!allowWhileVisible && !host.hidden()) || host.reducedMotion()) {
      rest()
      return
    }

    const activeCycle = ++cycle
    let frameIndex = 0

    const advance = () => {
      if (activeCycle !== cycle || (!allowWhileVisible && !host.hidden()) || host.reducedMotion()) {
        rest()
        return
      }

      const frame = frames[frameIndex]
      const hold = holds[frameIndex]
      if (frame === undefined || hold === undefined) {
        rest()
        return
      }
      host.showFrame(frame)
      frameIndex += 1

      if (frameIndex < frames.length) {
        timer = setTimer(advance, hold)
        return
      }

      timer = setTimer(() => {
        if (activeCycle !== cycle) return
        rest()
        // A sequence that ends in a hidden tab hands over to the countdown, so
        // the load or publication fan does not cost the tab its cadence.
        if (host.hidden()) scheduleWhileInactive()
      }, hold)
    }

    advance()
  }

  function syncWithPageActivity() {
    cancel()
    rest()
    if (host.hidden() && !host.reducedMotion()) scheduleWhileInactive()
  }

  function productPublished() {
    cancel()
    rest()
    play(true)
  }

  function start() {
    syncWithPageActivity()
    if (loadDelayMs === null) return
    loadTimer = setTimer(() => {
      loadTimer = undefined
      host.loadSequenceStarted?.()
      cancel()
      play(true)
    }, loadDelayMs)
  }

  function stop() {
    cancel()
    if (loadTimer !== undefined) clearTimer(loadTimer)
    loadTimer = undefined
  }

  return { start, syncWithPageActivity, productPublished, stop }
}
