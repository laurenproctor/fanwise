"use client"

import { useEffect, useMemo, useState } from "react"
import { routes } from "@/lib/routes"
import type { FontMetadata } from "@/lib/products/metadata"
import type { DetectedFamily, StyleSource } from "@/lib/fonts/workspace"
import type { FontFormat } from "@/lib/fonts/detected"

/**
 * The storefront, as a buyer would first see this family.
 *
 * Set in the uploaded font itself wherever a file can be loaded. The bytes come
 * through the workspace's own preview route (an RLS read, then a short-lived
 * signed URL for a loose file or the one entry read out of a ZIP package) and
 * go to the FontFace API as a buffer, so no stylesheet and no cross-origin
 * font URL is involved. A family uploaded as one package is shown from the
 * fonts inside it, the same as from loose files. A file the browser refuses to
 * load leaves the preview in the interface's display face with a sentence
 * saying so; the editor beside it is never affected.
 */

type FaceState =
  { kind: "none" } | { kind: "loading" } | { kind: "ready"; family: string } | { kind: "failed" }

/** What the preview loads: a loose font file, or one font inside a package. */
export interface PreviewSource {
  assetId: string
  entryPath: string | null
}

/** One key per loadable font, so two entries of one package never share a face. */
function sourceKey(source: PreviewSource): string {
  return source.entryPath === null ? source.assetId : `${source.assetId}:${source.entryPath}`
}

const faces = new Map<string, Promise<string>>()

function loadFace(workspaceSlug: string, source: PreviewSource): Promise<string> {
  const key = sourceKey(source)
  const cached = faces.get(key)
  if (cached) return cached
  // A CSS family name from the key, kept to characters a font-family value
  // takes without quoting trouble; the key itself stays the cache's.
  const family = `fanwise-preview-${key.replace(/[^A-Za-z0-9-]/g, "-")}`
  const promise = (async () => {
    const response = await fetch(
      routes.assetPreview(workspaceSlug, source.assetId, source.entryPath ?? undefined),
    )
    if (!response.ok) throw new Error(`preview ${response.status}`)
    const face = new FontFace(family, await response.arrayBuffer())
    await face.load()
    document.fonts.add(face)
    return family
  })()
  // A failure is not cached: the next attempt may be after a replacement.
  promise.catch(() => faces.delete(key))
  faces.set(key, promise)
  return promise
}

function useFontFace(workspaceSlug: string, source: PreviewSource | null): FaceState {
  // The source is taken apart into primitives so the effect keys on what it
  // names, not on an object rebuilt every render.
  const assetId = source?.assetId ?? null
  const entryPath = source?.entryPath ?? null
  const key = assetId ? sourceKey({ assetId, entryPath }) : null
  const [state, setState] = useState<{ key: string | null; face: FaceState }>({
    key: null,
    face: { kind: "none" },
  })

  useEffect(() => {
    if (!assetId || typeof FontFace === "undefined") return
    const key = sourceKey({ assetId, entryPath })
    let cancelled = false
    loadFace(workspaceSlug, { assetId, entryPath }).then(
      (family) => !cancelled && setState({ key, face: { kind: "ready", family } }),
      () => !cancelled && setState({ key, face: { kind: "failed" } }),
    )
    return () => {
      cancelled = true
    }
  }, [workspaceSlug, assetId, entryPath])

  if (!key) return { kind: "none" }
  return state.key === key ? state.face : { kind: "loading" }
}

/** Webfonts load fastest and are what a storefront would serve. */
const LOAD_PREFERENCE: readonly FontFormat[] = ["woff2", "woff", "otf", "ttf"]

export interface PreviewStyle {
  key: string
  name: string
  /** The file the preview loads for this style, or null when none can be. */
  source: PreviewSource | null
  /**
   * True when the style has files but none the preview can open: a font inside
   * a package too large to read in a request. Delivered, detected, not shown.
   */
  unloadable: boolean
}

/**
 * Which file to show a style in: the fastest loadable format, from a loose file
 * or from inside a package, on equal terms.
 */
export function previewSource(sources: readonly StyleSource[]): PreviewSource | null {
  const best = sources
    .filter((source) => source.loadable)
    .sort((a, b) => LOAD_PREFERENCE.indexOf(a.format) - LOAD_PREFERENCE.indexOf(b.format))[0]
  return best ? { assetId: best.assetId, entryPath: best.entryPath } : null
}

export function previewStyles(metadata: FontMetadata, family: DetectedFamily): PreviewStyle[] {
  const detectedByKey = new Map(family.styles.map((style) => [style.key, style]))
  const canonical = metadata.styles ?? []
  const describe = (key: string, name: string, sources: readonly StyleSource[]) => {
    const source = previewSource(sources)
    return { key, name, source, unloadable: source === null && sources.length > 0 }
  }
  return canonical.length > 0
    ? canonical.map((style) =>
        describe(style.key, style.name, detectedByKey.get(style.key)?.sources ?? []),
      )
    : family.styles.map((style) => describe(style.key, style.name, style.sources))
}

function shortStyleName(styleName: string, familyName: string): string {
  const trimmed = styleName.startsWith(familyName)
    ? styleName.slice(familyName.length).trim()
    : styleName
  return trimmed || "Regular"
}

export function LivePreview({
  workspaceSlug,
  name,
  shortDescription,
  metadata,
  styles,
  size = "panel",
}: {
  workspaceSlug: string
  name: string
  shortDescription: string
  metadata: FontMetadata
  styles: readonly PreviewStyle[]
  size?: "panel" | "full"
}) {
  const [mode, setMode] = useState<"storefront" | "dark">("storefront")
  const [styleKey, setStyleKey] = useState<string | null>(null)
  const [sample, setSample] = useState("")

  const selected = useMemo(
    () =>
      styles.find((style) => style.key === styleKey) ??
      styles.find((style) => style.source !== null && /regular|book|normal/i.test(style.name)) ??
      styles.find((style) => style.source !== null) ??
      styles[0] ??
      null,
    [styles, styleKey],
  )
  const face = useFontFace(workspaceSlug, selected?.source ?? null)

  const displayName = name.trim() || "Untitled family"
  const styleCount = metadata.styleCount ?? styles.length
  const scripts = metadata.scripts ?? []
  const nonLatin = scripts.filter((script) => script !== "Latin")
  const facts = [
    styleCount > 0 ? `${styleCount} ${styleCount === 1 ? "font" : "fonts"}` : null,
    metadata.glyphCount ? `${metadata.glyphCount.toLocaleString()} glyphs` : null,
    nonLatin.length > 0 ? nonLatin.join(" + ") : scripts.length > 0 ? scripts.join(" + ") : null,
  ].filter(Boolean)

  const fontFamily =
    face.kind === "ready" ? `"${face.family}", var(--font-display)` : "var(--font-display)"
  const dark = mode === "dark"
  const specimen = (sample.trim() || displayName).toUpperCase()

  const faceNote =
    face.kind === "none"
      ? styles.length === 0
        ? "No font file yet. Showing Fanwise’s display face until you upload one."
        : selected?.unloadable
          ? "This style’s font is inside a package too large to open for preview. Buyers still receive it; upload the font file on its own to see it here."
          : "This style has no loadable file. Showing Fanwise’s display face."
      : face.kind === "loading"
        ? `Loading ${selected?.name ?? "the font"}…`
        : face.kind === "failed"
          ? "This file could not be loaded for preview. It may be damaged; check Font files."
          : null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="label-mono">Live preview</h2>
        <div className="flex items-center gap-4" role="group" aria-label="Preview mode">
          {(["storefront", "dark"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={mode === option}
              onClick={() => setMode(option)}
              className={`min-h-8 border-b-[1.5px] text-[13.5px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${
                mode === option
                  ? "border-[var(--color-ink)] text-[var(--color-ink)]"
                  : "border-transparent text-[var(--color-ink-2)] hover:text-[var(--color-ink)]"
              }`}
            >
              {option === "storefront" ? "Storefront" : "Dark mode"}
              <span className="sr-only"> preview</span>
            </button>
          ))}
        </div>
      </div>

      <div
        className={`overflow-hidden rounded-[12px] border ${
          dark
            ? "border-[var(--color-panel-2)] bg-[var(--color-void)] text-[var(--color-on-dark)]"
            : "border-[var(--color-rule)] bg-[var(--color-card)] text-[var(--color-ink)]"
        }`}
      >
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 px-6 pt-5">
          <p className="font-display text-[22px] font-normal tracking-[-0.02em]">{displayName}</p>
          {facts.length > 0 ? (
            <p
              className={`text-[12.5px] ${dark ? "text-[var(--color-on-dark-2)]" : "text-[var(--color-ink-2)]"}`}
            >
              {facts.join(" · ")}
            </p>
          ) : null}
        </div>

        <div className="px-6 pt-5 pb-4" style={{ fontFamily }}>
          <p
            className={`leading-[0.95] break-words ${size === "full" ? "text-[clamp(56px,9vw,132px)]" : "text-[clamp(40px,4.6vw,76px)]"}`}
            style={{ fontFamily }}
          >
            {specimen}
          </p>
          <hr
            className={`my-5 ${dark ? "border-[var(--color-panel-2)]" : "border-[var(--color-rule)]"}`}
          />
          <p
            className={`leading-[1.05] break-words ${size === "full" ? "text-[48px]" : "text-[clamp(26px,2.6vw,40px)]"}`}
            style={{ fontFamily }}
          >
            ABCDEFGHIJKLM
            <br />
            nopqrstuvwxyz
          </p>
        </div>

        <div
          className={`flex flex-wrap items-end justify-between gap-3 border-t px-6 py-4 ${
            dark ? "border-[var(--color-panel-2)]" : "border-[var(--color-rule-2)]"
          }`}
        >
          <p className="text-[14px]">
            {displayName} · {selected ? shortStyleName(selected.name, displayName) : "Regular"} · 72
            px
          </p>
          {shortDescription.trim() ? (
            <p
              className={`max-w-[26ch] text-[12.5px] ${dark ? "text-[var(--color-on-dark-2)]" : "text-[var(--color-ink-2)]"}`}
            >
              {shortDescription.trim()}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {styles.length > 1 ? (
          <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-[13px] text-[var(--color-ink-2)]">
            Style
            <select
              value={selected?.key ?? ""}
              onChange={(event) => setStyleKey(event.target.value)}
              className="rounded-[8px] border border-[var(--color-rule)] bg-[var(--color-card)] px-2.5 py-1.5 text-[14px] text-[var(--color-ink)] outline-none focus-visible:border-[var(--color-accent)]"
            >
              {styles.map((style) => (
                <option key={style.key} value={style.key}>
                  {style.name}
                  {style.source === null
                    ? style.unloadable
                      ? " (not previewable)"
                      : " (no file)"
                    : ""}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-[13px] text-[var(--color-ink-2)]">
          Try your own text
          <input
            value={sample}
            onChange={(event) => setSample(event.target.value.slice(0, 60))}
            placeholder={displayName}
            className="rounded-[8px] border border-[var(--color-rule)] bg-[var(--color-card)] px-2.5 py-1.5 text-[14px] text-[var(--color-ink)] outline-none focus-visible:border-[var(--color-accent)]"
          />
        </label>
      </div>

      {faceNote ? (
        <p role="status" className="text-[12.5px] text-[var(--color-ink-3)]">
          {faceNote}
        </p>
      ) : null}
    </div>
  )
}
