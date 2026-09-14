"use client"

import { useState } from "react"
import { KNOWN_SCRIPTS, featureLabel, groupFeatures, FEATURE_GROUPS } from "@/lib/fonts/coverage"
import { FIELD_IDS } from "@/lib/fonts/readiness"
import type { SectionContext } from "../context"
import { ChipsInput, OriginBadge, SectionHeading, TextInput } from "../controls"

/**
 * What the family can set, summarised for a person and inspectable for a
 * typographer.
 *
 * The summary is the product's own values, seeded from the files. The detail
 * underneath is what the files themselves say, per block and per feature tag,
 * behind a disclosure so the ordinary path never scrolls through a cmap.
 */
export function CoverageSection({ ctx }: { ctx: SectionContext }) {
  const { metadata, family, files } = ctx
  const [glyphDraft, setGlyphDraft] = useState(
    metadata.glyphCount !== undefined ? String(metadata.glyphCount) : "",
  )
  const [glyphError, setGlyphError] = useState<string | null>(null)
  // The draft is text so a half-typed number survives; it follows the stored
  // value when that changes from elsewhere, such as a file finishing processing.
  const [seenGlyphCount, setSeenGlyphCount] = useState(metadata.glyphCount)
  if (seenGlyphCount !== metadata.glyphCount) {
    setSeenGlyphCount(metadata.glyphCount)
    if (!glyphError)
      setGlyphDraft(metadata.glyphCount !== undefined ? String(metadata.glyphCount) : "")
  }

  const scripts = metadata.scripts ?? []
  const languages = metadata.languageSupport ?? []
  const features = metadata.features ?? family.features
  const groups = groupFeatures(features)
  const same = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((item) => b.includes(item))

  const readings = files.flatMap((file) =>
    file.state === "ready" && file.reading.kind === "font"
      ? [{ file, font: file.reading.font }]
      : [],
  )

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading
        title="Character coverage"
        description="Which characters, scripts and features buyers get. Detected from your files, and yours to correct."
      />

      {family.readCount === 0 ? (
        <p className="border-l-2 border-[var(--color-rule)] py-1 pl-3 text-[14px] text-[var(--color-ink-2)]">
          Nothing detected yet. Upload font files and these fill in, or enter them by hand.
        </p>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <TextInput
          id={FIELD_IDS.glyphCount}
          label="Glyph count"
          inputMode="numeric"
          value={glyphDraft}
          error={glyphError}
          badge={
            family.glyphCount !== undefined && metadata.glyphCount === family.glyphCount ? (
              <OriginBadge origin="detected" />
            ) : undefined
          }
          hint={
            family.glyphCount !== undefined && metadata.glyphCount !== family.glyphCount
              ? `Files contain ${family.glyphCount.toLocaleString()} in the smallest style.`
              : "The smallest style’s count, so the family never over-promises."
          }
          onChange={(event) => {
            const raw = event.target.value.replace(/[^\d]/g, "")
            setGlyphDraft(raw)
            if (raw === "") {
              setGlyphError(null)
              ctx.setFont("glyphCount", undefined)
              return
            }
            const count = Number(raw)
            if (count < 1 || count > 100_000) {
              setGlyphError("Enter a count between 1 and 100,000.")
              return
            }
            setGlyphError(null)
            ctx.setFont("glyphCount", count)
          }}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-[14px]">Features buyers get</span>
          <ul className="flex flex-wrap gap-1.5" aria-label="Feature summary">
            {(Object.keys(FEATURE_GROUPS) as Array<keyof typeof FEATURE_GROUPS>)
              .filter((key) => groups[key].length > 0)
              .map((key) => (
                <li
                  key={key}
                  className="rounded-[var(--radius-pill)] border border-[var(--color-rule)] px-2.5 py-1 text-[13px]"
                >
                  {FEATURE_GROUPS[key].label}
                  <span className="text-[var(--color-ink-3)]"> · {groups[key].length}</span>
                </li>
              ))}
            {features.length === 0 ? (
              <li className="text-[13.5px] text-[var(--color-ink-3)]">
                No OpenType features detected.
              </li>
            ) : null}
          </ul>
        </div>
      </div>

      <ChipsInput
        id={FIELD_IDS.scripts}
        label="Scripts"
        values={scripts}
        suggestions={KNOWN_SCRIPTS}
        placeholder="Latin, Cyrillic, Kana"
        onChange={(next) => ctx.setFont("scripts", next, { immediate: true })}
        badge={
          family.readCount > 0 && same(scripts, family.scripts) ? (
            <OriginBadge origin="detected" />
          ) : undefined
        }
        hint="Claimed only where every style covers the script."
      />

      <ChipsInput
        id={FIELD_IDS.languages}
        label="Supported languages"
        values={languages}
        placeholder="English, French, German"
        onChange={(next) => ctx.setFont("languageSupport", next, { immediate: true })}
        badge={
          family.readCount > 0 && same(languages, family.languages) ? (
            <OriginBadge origin="detected" />
          ) : undefined
        }
        hint="Detected from the letters each language needs. Add any the check does not know."
      />

      <dl className="grid gap-4 border-t border-[var(--color-rule)] pt-5 sm:grid-cols-3">
        <Summary term="Numerals" tags={groups.numerals} empty="Default figures only" />
        <Summary term="Ligatures" tags={groups.ligatures} empty="None detected" />
        <Summary term="Alternates" tags={groups.alternates} empty="None detected" />
      </dl>

      {readings.length > 0 ? (
        <details className="group border-t border-[var(--color-rule)] pt-4">
          <summary className="cursor-pointer text-[14px] text-[var(--color-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]">
            Inspect detected coverage per file
          </summary>
          <div className="mt-4 flex flex-col gap-5">
            {readings.map(({ file, font }) => (
              <section key={file.id} aria-label={file.filename} className="flex flex-col gap-2">
                <h3 className="text-[14px]">
                  {font.fullName ?? file.filename}{" "}
                  <span className="font-mono text-[11px] text-[var(--color-ink-3)] uppercase">
                    {font.format}
                  </span>
                </h3>
                <p className="text-[13px] text-[var(--color-ink-2)] tabular-nums">
                  {font.glyphCount?.toLocaleString() ?? "?"} glyphs ·{" "}
                  {font.codepointCount?.toLocaleString() ?? "?"} characters mapped
                </p>
                {font.blocks.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[360px] text-left text-[13px]">
                      <caption className="sr-only">Unicode blocks in {file.filename}</caption>
                      <thead className="text-[12px] text-[var(--color-ink-3)]">
                        <tr>
                          <th scope="col" className="py-1 font-normal">
                            Unicode block
                          </th>
                          <th scope="col" className="py-1 text-right font-normal">
                            Covered
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {font.blocks.map((block) => (
                          <tr key={block.name} className="border-t border-[var(--color-rule-2)]">
                            <th scope="row" className="py-1 font-normal">
                              {block.name}
                            </th>
                            <td className="py-1 text-right tabular-nums">
                              {block.covered} / {block.total}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {font.features.length > 0 ? (
                  <p className="text-[12.5px] text-[var(--color-ink-2)]">
                    <span className="text-[var(--color-ink-3)]">OpenType features: </span>
                    {font.features.map((tag) => `${featureLabel(tag)} (${tag})`).join(", ")}
                  </p>
                ) : null}
              </section>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  )
}

function Summary({ term, tags, empty }: { term: string; tags: string[]; empty: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[13px] text-[var(--color-ink-3)]">{term}</dt>
      <dd className="text-[14px]">{tags.length > 0 ? tags.map(featureLabel).join(", ") : empty}</dd>
    </div>
  )
}
