import { describe, expect, it } from "vitest"
import {
  PALETTE_OPENED_STORAGE_KEY,
  RECENT_PRODUCTS_LIMIT,
  SINGLE_KEY_STORAGE_KEY,
  readPaletteOpened,
  readRecentProducts,
  readSingleKeyPreference,
  rememberRecentProduct,
  writePaletteOpened,
  writeSingleKeyPreference,
  type StorageLike,
} from "@/lib/commands/preferences"

function memory(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  }
}

const REFUSING: StorageLike = {
  getItem: () => {
    throw new Error("SecurityError")
  },
  setItem: () => {
    throw new Error("SecurityError")
  },
  removeItem: () => {
    throw new Error("SecurityError")
  },
}

describe("the single-key preference", () => {
  it("is on by default, off when written off, and on again with no row left behind", () => {
    const store = memory()
    expect(readSingleKeyPreference(store)).toBe(true)
    writeSingleKeyPreference(false, store)
    expect(readSingleKeyPreference(store)).toBe(false)
    expect(store.map.get(SINGLE_KEY_STORAGE_KEY)).toBe("off")
    writeSingleKeyPreference(true, store)
    expect(readSingleKeyPreference(store)).toBe(true)
    expect(store.map.has(SINGLE_KEY_STORAGE_KEY)).toBe(false)
  })

  it("falls back to the default when storage refuses", () => {
    expect(readSingleKeyPreference(REFUSING)).toBe(true)
    expect(() => writeSingleKeyPreference(false, REFUSING)).not.toThrow()
    expect(readSingleKeyPreference(null)).toBe(true)
  })
})

describe("the first-use hint", () => {
  it("retires once the palette has opened, and only writes once", () => {
    const store = memory()
    expect(readPaletteOpened(store)).toBe(false)
    writePaletteOpened(store)
    expect(readPaletteOpened(store)).toBe(true)
    expect(store.map.get(PALETTE_OPENED_STORAGE_KEY)).toBe("1")
    let writes = 0
    const counting: StorageLike = {
      ...store,
      setItem: (k, v) => {
        writes += 1
        store.setItem(k, v)
      },
    }
    writePaletteOpened(counting)
    expect(writes).toBe(0)
  })
})

describe("recent products", () => {
  it("keeps the newest first, deduplicated, and capped", () => {
    const store = memory()
    expect(readRecentProducts("studio", store)).toEqual([])
    rememberRecentProduct("studio", "aster", store)
    rememberRecentProduct("studio", "meridian", store)
    rememberRecentProduct("studio", "aster", store)
    expect(readRecentProducts("studio", store)).toEqual(["aster", "meridian"])
    for (let i = 0; i < RECENT_PRODUCTS_LIMIT + 2; i += 1)
      rememberRecentProduct("studio", `p${i}`, store)
    expect(readRecentProducts("studio", store)).toHaveLength(RECENT_PRODUCTS_LIMIT)
    // Per workspace: another studio's list is its own.
    expect(readRecentProducts("other", store)).toEqual([])
  })

  it("treats a damaged row as empty", () => {
    const store = memory()
    store.setItem("fw-recent-products:studio", "{not json")
    expect(readRecentProducts("studio", store)).toEqual([])
    store.setItem("fw-recent-products:studio", JSON.stringify([1, "ok", null]))
    expect(readRecentProducts("studio", store)).toEqual(["ok"])
  })
})
