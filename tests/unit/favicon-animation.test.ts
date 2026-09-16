import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { vi } from "vitest"
import {
  createFaviconAnimator,
  FAVICON_FRAME_HOLDS_MS,
  FAVICON_FRAMES,
  type FaviconHost,
} from "@/lib/favicon/animation"

/**
 * The favicon's schedule, driven with fake timers and a host that records
 * every frame it is shown. No DOM: the component supplies that, and what it
 * supplies is five lines that a browser test would cover if one were ever
 * worth it.
 */

const SEQUENCE_MS = FAVICON_FRAME_HOLDS_MS.reduce((sum, hold) => sum + hold, 0)
const INTERVAL_MS = 10_000
const LOAD_DELAY_MS = 450
const RESTING = FAVICON_FRAMES[0]

function host(state: { hidden: boolean; reducedMotion: boolean }) {
  const shown: string[] = []
  let loadSequences = 0
  const h: FaviconHost = {
    showFrame: (href) => {
      shown.push(href)
    },
    hidden: () => state.hidden,
    reducedMotion: () => state.reducedMotion,
    loadSequenceStarted: () => {
      loadSequences += 1
    },
  }
  return {
    host: h,
    shown,
    /** Frames shown since the last look, with the resting frame filtered out. */
    fansSince(from: number) {
      return shown.slice(from).filter((href) => href !== RESTING)
    },
    get loadSequences() {
      return loadSequences
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe("the opening fan", () => {
  it("plays once, after the load delay, in a visible tab, then rests", () => {
    const state = { hidden: false, reducedMotion: false }
    const h = host(state)
    const animator = createFaviconAnimator(h.host, {
      intervalMs: INTERVAL_MS,
      loadDelayMs: LOAD_DELAY_MS,
    })

    animator.start()
    expect(h.shown).toEqual([RESTING])

    vi.advanceTimersByTime(LOAD_DELAY_MS - 1)
    expect(h.fansSince(0)).toEqual([])

    vi.advanceTimersByTime(1)
    expect(h.loadSequences).toBe(1)
    vi.advanceTimersByTime(SEQUENCE_MS)

    // Every frame in order, once each, frame 0 being both the first frame and
    // the resting mark.
    expect(h.shown.filter((href) => href !== RESTING)).toEqual(FAVICON_FRAMES.slice(1))
    expect(h.shown.at(-1)).toBe(RESTING)

    // And nothing after it while the tab stays in front.
    const after = h.shown.length
    vi.advanceTimersByTime(INTERVAL_MS * 3)
    expect(h.shown.length).toBe(after)
  })

  it("does not play when told this load has already had its turn", () => {
    const state = { hidden: false, reducedMotion: false }
    const h = host(state)
    const animator = createFaviconAnimator(h.host, { intervalMs: INTERVAL_MS, loadDelayMs: null })

    animator.start()
    vi.advanceTimersByTime(LOAD_DELAY_MS + SEQUENCE_MS)
    expect(h.fansSince(0)).toEqual([])
    expect(h.loadSequences).toBe(0)
  })

  it("is cancelled by stop before it fires, so an unmount leaves no timer", () => {
    const state = { hidden: false, reducedMotion: false }
    const h = host(state)
    const animator = createFaviconAnimator(h.host, {
      intervalMs: INTERVAL_MS,
      loadDelayMs: LOAD_DELAY_MS,
    })

    animator.start()
    animator.stop()
    vi.advanceTimersByTime(LOAD_DELAY_MS + SEQUENCE_MS)
    expect(h.fansSince(0)).toEqual([])
    expect(h.loadSequences).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("is the static mark under reduced motion", () => {
    const state = { hidden: false, reducedMotion: true }
    const h = host(state)
    const animator = createFaviconAnimator(h.host, {
      intervalMs: INTERVAL_MS,
      loadDelayMs: LOAD_DELAY_MS,
    })

    animator.start()
    vi.advanceTimersByTime(LOAD_DELAY_MS + SEQUENCE_MS)
    expect(h.fansSince(0)).toEqual([])
    expect(h.shown.every((href) => href === RESTING)).toBe(true)
  })
})

describe("a first publication", () => {
  it("plays at once in a visible tab and rests when done", () => {
    const state = { hidden: false, reducedMotion: false }
    const h = host(state)
    const animator = createFaviconAnimator(h.host, { intervalMs: INTERVAL_MS, loadDelayMs: null })
    animator.start()

    const before = h.shown.length
    animator.productPublished()
    expect(h.shown.at(-1)).toBe(FAVICON_FRAMES[0])
    vi.advanceTimersByTime(SEQUENCE_MS)
    expect(h.fansSince(before)).toEqual(FAVICON_FRAMES.slice(1))
    expect(h.shown.at(-1)).toBe(RESTING)
  })

  it("plays in a hidden tab too, then hands over to the countdown", () => {
    const state = { hidden: true, reducedMotion: false }
    const h = host(state)
    const animator = createFaviconAnimator(h.host, { intervalMs: INTERVAL_MS, loadDelayMs: null })
    animator.start()

    const before = h.shown.length
    animator.productPublished()
    vi.advanceTimersByTime(SEQUENCE_MS)
    expect(h.fansSince(before)).toEqual(FAVICON_FRAMES.slice(1))

    // The countdown restarts from the end of the fan, not from when the tab
    // was hidden: the next fan comes one full interval later.
    const after = h.shown.length
    vi.advanceTimersByTime(INTERVAL_MS - 1)
    expect(h.fansSince(after)).toEqual([])
    vi.advanceTimersByTime(1 + SEQUENCE_MS)
    expect(h.fansSince(after)).toEqual(FAVICON_FRAMES.slice(1))
  })

  it("stays still under reduced motion", () => {
    const state = { hidden: false, reducedMotion: true }
    const h = host(state)
    const animator = createFaviconAnimator(h.host, { intervalMs: INTERVAL_MS, loadDelayMs: null })
    animator.start()

    animator.productPublished()
    vi.advanceTimersByTime(SEQUENCE_MS)
    expect(h.fansSince(0)).toEqual([])
  })
})

describe("an inactive tab", () => {
  it("never fans while the tab is in front", () => {
    const state = { hidden: false, reducedMotion: false }
    const h = host(state)
    const animator = createFaviconAnimator(h.host, { intervalMs: INTERVAL_MS, loadDelayMs: null })
    animator.start()

    vi.advanceTimersByTime(INTERVAL_MS * 5)
    expect(h.fansSince(0)).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it("counts one interval from the moment the tab is hidden, then repeats", () => {
    const state = { hidden: false, reducedMotion: false }
    const h = host(state)
    const animator = createFaviconAnimator(h.host, { intervalMs: INTERVAL_MS, loadDelayMs: null })
    animator.start()

    state.hidden = true
    animator.syncWithPageActivity()

    let mark = h.shown.length
    vi.advanceTimersByTime(INTERVAL_MS - 1)
    expect(h.fansSince(mark)).toEqual([])
    vi.advanceTimersByTime(1 + SEQUENCE_MS)
    expect(h.fansSince(mark)).toEqual(FAVICON_FRAMES.slice(1))
    expect(h.shown.at(-1)).toBe(RESTING)

    mark = h.shown.length
    vi.advanceTimersByTime(INTERVAL_MS + SEQUENCE_MS)
    expect(h.fansSince(mark)).toEqual(FAVICON_FRAMES.slice(1))
  })

  it("is cancelled by the tab coming back, and starts fresh when it leaves again", () => {
    const state = { hidden: false, reducedMotion: false }
    const h = host(state)
    const animator = createFaviconAnimator(h.host, { intervalMs: INTERVAL_MS, loadDelayMs: null })
    animator.start()

    state.hidden = true
    animator.syncWithPageActivity()
    vi.advanceTimersByTime(INTERVAL_MS - 100)

    state.hidden = false
    animator.syncWithPageActivity()
    const mark = h.shown.length
    vi.advanceTimersByTime(INTERVAL_MS)
    expect(h.fansSince(mark)).toEqual([])
    expect(vi.getTimerCount()).toBe(0)

    // Hidden again: a whole interval, not the 100ms that was left.
    state.hidden = true
    animator.syncWithPageActivity()
    vi.advanceTimersByTime(INTERVAL_MS - 1)
    expect(h.fansSince(mark)).toEqual([])
    vi.advanceTimersByTime(1 + SEQUENCE_MS)
    expect(h.fansSince(mark)).toEqual(FAVICON_FRAMES.slice(1))
  })

  it("rests at once if the tab comes back mid-fan", () => {
    const state = { hidden: true, reducedMotion: false }
    const h = host(state)
    const animator = createFaviconAnimator(h.host, { intervalMs: INTERVAL_MS, loadDelayMs: null })
    animator.start()

    vi.advanceTimersByTime(INTERVAL_MS)
    vi.advanceTimersByTime((FAVICON_FRAME_HOLDS_MS[0] ?? 0) + (FAVICON_FRAME_HOLDS_MS[1] ?? 0))
    const mid = h.shown.length
    expect(h.fansSince(0).length).toBeGreaterThan(0)

    state.hidden = false
    animator.syncWithPageActivity()
    expect(h.shown.at(-1)).toBe(RESTING)
    vi.advanceTimersByTime(SEQUENCE_MS + INTERVAL_MS)
    expect(h.fansSince(mid)).toEqual([])
  })

  it("does not count down under reduced motion, and stops when the preference changes to it", () => {
    const state = { hidden: true, reducedMotion: true }
    const h = host(state)
    const animator = createFaviconAnimator(h.host, { intervalMs: INTERVAL_MS, loadDelayMs: null })
    animator.start()
    vi.advanceTimersByTime(INTERVAL_MS * 2)
    expect(h.fansSince(0)).toEqual([])

    state.reducedMotion = false
    animator.syncWithPageActivity()
    vi.advanceTimersByTime(INTERVAL_MS - 1)
    state.reducedMotion = true
    animator.syncWithPageActivity()
    vi.advanceTimersByTime(INTERVAL_MS * 2)
    expect(h.fansSince(0)).toEqual([])
  })
})

describe("the frames", () => {
  it("are nine files under public/fanwise-favicon/frames, one hold each", () => {
    expect(FAVICON_FRAMES).toHaveLength(FAVICON_FRAME_HOLDS_MS.length)
    expect(FAVICON_FRAMES[0]).toBe("/fanwise-favicon/frames/fanwise-00.svg")
    expect(FAVICON_FRAMES.at(-1)).toBe("/fanwise-favicon/frames/fanwise-08.svg")
  })
})
