/**
 * What the browser remembers about the keyboard, and nothing else.
 *
 * Local storage rather than a column, deliberately: the preference is about
 * this keyboard on this machine, and a migration for one boolean is the
 * wrong trade. Every read and write is wrapped, because a browser that
 * refuses storage (a private window, a blocked site) still gets the
 * defaults. Nothing here is product content: the recent list holds slugs.
 */

export const SINGLE_KEY_STORAGE_KEY = "fw-single-key-shortcuts"
export const PALETTE_OPENED_STORAGE_KEY = "fw-command-palette-opened"
export const RECENT_PRODUCTS_STORAGE_PREFIX = "fw-recent-products:"

/** How many recent products the palette suggests. */
export const RECENT_PRODUCTS_LIMIT = 4

/** Fired on `window` after a write, so every reader on the page re-reads. */
export const PREFERENCES_CHANGED_EVENT = "fw-keyboard-preferences-change"

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">

function storage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage
  } catch {
    return null
  }
}

function read(key: string, store: StorageLike | null = storage()): string | null {
  try {
    return store?.getItem(key) ?? null
  } catch {
    return null
  }
}

function write(key: string, value: string | null, store: StorageLike | null = storage()): void {
  try {
    if (value === null) store?.removeItem(key)
    else store?.setItem(key, value)
  } catch {
    // The preference still applies for this page when storage is unavailable.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PREFERENCES_CHANGED_EVENT))
}

/** Plain single-key shortcuts are on unless the creator turned them off. */
export function readSingleKeyPreference(store?: StorageLike | null): boolean {
  return read(SINGLE_KEY_STORAGE_KEY, store) !== "off"
}

export function writeSingleKeyPreference(enabled: boolean, store?: StorageLike | null): void {
  write(SINGLE_KEY_STORAGE_KEY, enabled ? null : "off", store)
}

/** Whether the palette has ever been opened here, which retires the "Try ⌘K" hint. */
export function readPaletteOpened(store?: StorageLike | null): boolean {
  return read(PALETTE_OPENED_STORAGE_KEY, store) === "1"
}

export function writePaletteOpened(store?: StorageLike | null): void {
  if (readPaletteOpened(store)) return
  write(PALETTE_OPENED_STORAGE_KEY, "1", store)
}

function recentKey(workspaceSlug: string): string {
  return `${RECENT_PRODUCTS_STORAGE_PREFIX}${workspaceSlug}`
}

/** Product slugs, most recent first. Slugs only: a name is content, a slug is an address. */
export function readRecentProducts(workspaceSlug: string, store?: StorageLike | null): string[] {
  const raw = read(recentKey(workspaceSlug), store)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []
  } catch {
    return []
  }
}

export function rememberRecentProduct(
  workspaceSlug: string,
  productSlug: string,
  store?: StorageLike | null,
): string[] {
  const next = [
    productSlug,
    ...readRecentProducts(workspaceSlug, store).filter((s) => s !== productSlug),
  ].slice(0, RECENT_PRODUCTS_LIMIT)
  write(recentKey(workspaceSlug), JSON.stringify(next), store)
  return next
}

/**
 * A subscription over every value above, for useSyncExternalStore. One
 * event for all of them; the readers are cheap.
 */
export function subscribePreferences(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {}
  const onStorage = (event: StorageEvent) => {
    if (
      event.key === null ||
      event.key === SINGLE_KEY_STORAGE_KEY ||
      event.key === PALETTE_OPENED_STORAGE_KEY ||
      event.key.startsWith(RECENT_PRODUCTS_STORAGE_PREFIX)
    )
      listener()
  }
  window.addEventListener(PREFERENCES_CHANGED_EVENT, listener)
  window.addEventListener("storage", onStorage)
  return () => {
    window.removeEventListener(PREFERENCES_CHANGED_EVENT, listener)
    window.removeEventListener("storage", onStorage)
  }
}
