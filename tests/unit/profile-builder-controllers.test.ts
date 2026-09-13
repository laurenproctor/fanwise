import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  AVAILABILITY_DEBOUNCE_MS,
  createHandleAvailabilityChecker,
  type AvailabilityAnswer,
  type AvailabilityState,
} from "@/lib/public/handle-availability"
import {
  AUTOSAVE_DEBOUNCE_MS,
  createDraftAutosave,
  type AutosaveResult,
  type AutosaveStatus,
} from "@/lib/public/draft-autosave"

/**
 * The builder's timing, with fake timers and hand-resolved promises.
 *
 * These are the behaviours a browser test would find flaky and a person would
 * find only by typing fast on a slow connection: a stale availability answer
 * landing last, a save overlapping a save, a failure eating a paragraph.
 */

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve)).then(() => undefined)

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe("studio address availability", () => {
  function setup(ownHandle = "lauren-proctor") {
    const states: AvailabilityState[] = []
    const requests: Array<{
      handle: string
      signal: AbortSignal
      answer: ReturnType<typeof deferred<AvailabilityAnswer>>
    }> = []
    const checker = createHandleAvailabilityChecker({
      ownHandle,
      onChange: (state) => states.push(state),
      fetcher: (handle, signal) => {
        const answer = deferred<AvailabilityAnswer>()
        requests.push({ handle, signal, answer })
        return answer.promise
      },
    })
    return { checker, states, requests }
  }

  it("starts untouched", () => {
    expect(setup().checker.current()).toEqual({ status: "untouched" })
  })

  it("decides invalid and reserved on the keystroke, without a request", () => {
    const { checker, requests } = setup()
    checker.update("ab")
    expect(checker.current().status).toBe("invalid")
    checker.update("settings")
    expect(checker.current()).toEqual({ status: "reserved", handle: "settings" })
    checker.update("")
    expect(checker.current().status).toBe("invalid")
    vi.advanceTimersByTime(AVAILABILITY_DEBOUNCE_MS * 2)
    expect(requests).toHaveLength(0)
  })

  it("treats the profile's own handle as available without asking", () => {
    const { checker, requests } = setup("lauren-proctor")
    checker.update("Lauren Proctor")
    expect(checker.current()).toEqual({ status: "available", handle: "lauren-proctor" })
    vi.advanceTimersByTime(AVAILABILITY_DEBOUNCE_MS)
    expect(requests).toHaveLength(0)
  })

  it("debounces the network: one request for a burst of typing, for the final value", async () => {
    const { checker, requests } = setup()
    for (const value of ["n", "no", "nor", "nort", "north"]) {
      checker.update(value)
      vi.advanceTimersByTime(50)
    }
    expect(checker.current()).toEqual({ status: "checking", handle: "north" })
    vi.advanceTimersByTime(AVAILABILITY_DEBOUNCE_MS)
    expect(requests.map((r) => r.handle)).toEqual(["north"])

    requests[0]!.answer.resolve("available")
    await flush()
    expect(checker.current()).toEqual({ status: "available", handle: "north" })
  })

  it("reports a taken handle as unavailable", async () => {
    const { checker, requests } = setup()
    checker.update("northline")
    vi.advanceTimersByTime(AVAILABILITY_DEBOUNCE_MS)
    requests[0]!.answer.resolve("unavailable")
    await flush()
    expect(checker.current()).toEqual({ status: "unavailable", handle: "northline" })
  })

  it("never lets a slow, older answer replace a newer one", async () => {
    const { checker, requests } = setup()

    checker.update("northline")
    vi.advanceTimersByTime(AVAILABILITY_DEBOUNCE_MS)
    checker.update("northline-studio")
    vi.advanceTimersByTime(AVAILABILITY_DEBOUNCE_MS)

    expect(requests.map((r) => r.handle)).toEqual(["northline", "northline-studio"])
    expect(requests[0]!.signal.aborted).toBe(true)

    // The newer answer arrives first, then the stale one. Only the newer counts.
    requests[1]!.answer.resolve("available")
    await flush()
    requests[0]!.answer.resolve("unavailable")
    await flush()

    expect(checker.current()).toEqual({ status: "available", handle: "northline-studio" })
  })

  it("drops an in-flight answer when the field becomes invalid before it lands", async () => {
    const { checker, requests } = setup()
    checker.update("northline")
    vi.advanceTimersByTime(AVAILABILITY_DEBOUNCE_MS)
    checker.update("no")
    requests[0]!.answer.resolve("available")
    await flush()
    expect(checker.current().status).toBe("invalid")
  })

  it("reports a failed request as recoverable and retries on request", async () => {
    const { checker, requests } = setup()
    checker.update("northline")
    vi.advanceTimersByTime(AVAILABILITY_DEBOUNCE_MS)
    requests[0]!.answer.reject(new Error("503"))
    await flush()
    expect(checker.current()).toEqual({ status: "error", handle: "northline" })

    checker.retry()
    expect(checker.current()).toEqual({ status: "checking", handle: "northline" })
    expect(requests).toHaveLength(2)
    requests[1]!.answer.resolve("available")
    await flush()
    expect(checker.current().status).toBe("available")
  })

  it("does not report a superseded, aborted request as an error", async () => {
    const { checker, requests, states } = setup()
    checker.update("northline")
    vi.advanceTimersByTime(AVAILABILITY_DEBOUNCE_MS)
    checker.update("northline-2")
    requests[0]!.answer.reject(new DOMException("aborted", "AbortError"))
    await flush()
    expect(states.some((s) => s.status === "error")).toBe(false)
  })
})

describe("draft autosave", () => {
  interface Fields {
    name: string
  }

  function setup(initialRevision = 0) {
    const statuses: AutosaveStatus[] = []
    const saves: Array<{
      value: Fields
      revision: number
      result: ReturnType<typeof deferred<AutosaveResult>>
    }> = []
    const autosave = createDraftAutosave<Fields>({
      initialRevision,
      onStatus: (s) => statuses.push(s),
      save: (value, revision) => {
        const result = deferred<AutosaveResult>()
        saves.push({ value, revision, result })
        return result.promise
      },
    })
    return { autosave, statuses, saves }
  }

  it("does not save on the keystroke, and saves only the latest value after a pause", async () => {
    const { autosave, saves } = setup()
    autosave.change({ name: "L" })
    autosave.change({ name: "La" })
    autosave.change({ name: "Lauren" })
    expect(saves).toHaveLength(0)
    expect(autosave.status()).toBe("pending")

    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS)
    expect(saves).toHaveLength(1)
    expect(saves[0]!.value).toEqual({ name: "Lauren" })
    expect(autosave.status()).toBe("saving")

    saves[0]!.result.resolve({ ok: true, revision: 1 })
    await flush()
    await flush()
    expect(autosave.status()).toBe("saved")
    expect(autosave.revision()).toBe(1)
  })

  it("never runs two saves at once, and saves a change made mid-flight with the new revision", async () => {
    const { autosave, saves } = setup(3)
    autosave.change({ name: "a" })
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS)
    autosave.change({ name: "ab" })
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS)
    expect(saves).toHaveLength(1)

    saves[0]!.result.resolve({ ok: true, revision: 4 })
    await flush()
    await flush()
    expect(autosave.status()).toBe("pending")
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS)
    expect(saves).toHaveLength(2)
    expect(saves[1]).toMatchObject({ value: { name: "ab" }, revision: 4 })
  })

  it("keeps the value after a failure and saves it on retry", async () => {
    const { autosave, saves } = setup()
    autosave.change({ name: "Lauren" })
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS)
    saves[0]!.result.resolve({ ok: false, reason: "failed" })
    await flush()
    await flush()
    expect(autosave.status()).toBe("error")

    autosave.retry()
    expect(saves).toHaveLength(2)
    expect(saves[1]!.value).toEqual({ name: "Lauren" })
  })

  it("treats a thrown save as a failure, not a crash", async () => {
    const autosave = createDraftAutosave<Fields>({
      initialRevision: 0,
      onStatus: () => {},
      save: async () => {
        throw new Error("network")
      },
    })
    autosave.change({ name: "x" })
    await expect(autosave.flush()).resolves.toBe(false)
    expect(autosave.status()).toBe("error")
  })

  it("stops saving on a conflict rather than overwriting another tab", async () => {
    const { autosave, saves } = setup()
    autosave.change({ name: "mine" })
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS)
    saves[0]!.result.resolve({ ok: false, reason: "conflict" })
    await flush()
    await flush()
    expect(autosave.status()).toBe("conflict")

    autosave.change({ name: "mine, again" })
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS * 3)
    autosave.retry()
    expect(saves).toHaveLength(1)
  })

  it("flushes on demand and adopts a revision written elsewhere", async () => {
    const { autosave, saves } = setup()
    autosave.change({ name: "now" })
    const flushed = autosave.flush()
    expect(saves).toHaveLength(1)
    saves[0]!.result.resolve({ ok: true, revision: 1 })
    await expect(flushed).resolves.toBe(true)

    autosave.adopt(2)
    autosave.change({ name: "later" })
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS)
    expect(saves[1]!.revision).toBe(2)
  })

  it("does nothing after disposal", () => {
    const { autosave, saves } = setup()
    autosave.change({ name: "x" })
    autosave.dispose()
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS * 2)
    expect(saves).toHaveLength(0)
  })
})
