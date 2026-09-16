import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SEQUENCE_DESTINATIONS } from "@/lib/commands/navigation"
import { createSequenceController, SEQUENCE_TIMEOUT_MS } from "@/lib/commands/sequence"
import { routes } from "@/lib/routes"

/**
 * F, then a letter: the timing and the outcomes, under fake timers.
 */

describe("the F sequence", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function controller() {
    return createSequenceController({ destinations: SEQUENCE_DESTINATIONS })
  }

  it("opens on F in either case and ignores every other first key", () => {
    const seq = controller()
    expect(seq.press("p")).toEqual({ kind: "ignored" })
    expect(seq.isOpen()).toBe(false)
    expect(seq.press("F")).toEqual({ kind: "opened" })
    expect(seq.isOpen()).toBe(true)
    seq.close()
    expect(seq.press("f")).toEqual({ kind: "opened" })
    seq.dispose()
  })

  it("navigates on a destination key, case-insensitively, and closes", () => {
    const seq = controller()
    seq.press("f")
    const outcome = seq.press("P")
    expect(outcome.kind).toBe("navigate")
    if (outcome.kind === "navigate") expect(outcome.destination.commandId).toBe("nav.products")
    expect(seq.isOpen()).toBe(false)
    seq.dispose()
  })

  it("reaches every destination", () => {
    const seq = controller()
    for (const destination of SEQUENCE_DESTINATIONS) {
      seq.press("f")
      const outcome = seq.press(destination.key)
      expect(outcome).toEqual({ kind: "navigate", destination })
      expect(seq.isOpen()).toBe(false)
    }
    seq.dispose()
  })

  it("closes on an unrecognised key rather than lingering", () => {
    const seq = controller()
    seq.press("f")
    expect(seq.press("z")).toEqual({ kind: "closed" })
    expect(seq.isOpen()).toBe(false)
    seq.dispose()
  })

  it("waits through a bare modifier for the real key", () => {
    const seq = controller()
    seq.press("f")
    expect(seq.press("Shift")).toEqual({ kind: "ignored" })
    expect(seq.isOpen()).toBe(true)
    expect(seq.press("S").kind).toBe("navigate")
    seq.dispose()
  })

  it("closes itself after a second and a half with nothing pressed", () => {
    const seq = controller()
    const changes = vi.fn()
    seq.subscribe(changes)
    seq.press("f")
    expect(changes).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(SEQUENCE_TIMEOUT_MS - 1)
    expect(seq.isOpen()).toBe(true)
    vi.advanceTimersByTime(1)
    expect(seq.isOpen()).toBe(false)
    expect(changes).toHaveBeenCalledTimes(2)
    seq.dispose()
  })

  it("does not fire a stale timeout after a navigation", () => {
    const seq = controller()
    const changes = vi.fn()
    seq.subscribe(changes)
    seq.press("f")
    seq.press("s")
    changes.mockClear()
    vi.advanceTimersByTime(SEQUENCE_TIMEOUT_MS * 2)
    expect(changes).not.toHaveBeenCalled()
    seq.dispose()
  })

  it("close() is what Escape calls, and is idempotent", () => {
    const seq = controller()
    const changes = vi.fn()
    seq.subscribe(changes)
    seq.press("f")
    seq.close()
    seq.close()
    expect(seq.isOpen()).toBe(false)
    expect(changes).toHaveBeenCalledTimes(2)
    seq.dispose()
  })

  it("dispose clears the timer and the listeners", () => {
    const seq = controller()
    const changes = vi.fn()
    seq.subscribe(changes)
    seq.press("f")
    seq.dispose()
    changes.mockClear()
    vi.advanceTimersByTime(SEQUENCE_TIMEOUT_MS * 2)
    expect(changes).not.toHaveBeenCalled()
  })
})

describe("the destinations", () => {
  it("are single lower-case letters, unique, and never F itself", () => {
    const keys = SEQUENCE_DESTINATIONS.map((d) => d.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const key of keys) {
      expect(key).toMatch(/^[a-z]$/)
      expect(key).not.toBe("f")
    }
  })

  it("name the four sections and the preview, by the letters the guide prints", () => {
    expect(SEQUENCE_DESTINATIONS.map((d) => `${d.key.toUpperCase()} ${d.label}`)).toEqual([
      "P Products",
      "C Channels",
      "R Profile",
      "S Settings",
      "V Preview",
    ])
  })

  it("resolve to the routes the header uses", async () => {
    const { SECTION_ROUTES } = await import("@/lib/commands/navigation")
    const hrefs = Object.fromEntries(SECTION_ROUTES.map((s) => [s.commandId, s.href("studio")]))
    expect(hrefs).toEqual({
      "nav.products": routes.workspace("studio"),
      "nav.channels": routes.channels("studio"),
      "nav.profile": routes.profile("studio"),
      "nav.settings": routes.settings("studio"),
    })
  })
})
