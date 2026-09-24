"use client"

import { useRef, useState } from "react"
import { FONT_CLASSIFICATIONS, type FontStyle } from "@/lib/products/metadata"
import { FONT_CLASSIFICATION_LABELS } from "@/lib/fonts/labels"
import { FIELD_IDS } from "@/lib/fonts/readiness"
import { WIDTH_NAMES, weightLabel } from "@/lib/fonts/detected"
import { styleFromDetectedStyle, unlistedStyles, type DetectedStyle } from "@/lib/fonts/workspace"
import type { SectionContext } from "../context"
import {
  FieldShell,
  INPUT_CLASS,
  OriginBadge,
  QUIET_BUTTON_CLASS,
  SectionHeading,
  StatusIcon,
  TextInput,
  Toggle,
  describedBy,
} from "../controls"

const COLLAPSED_STYLE_COUNT = 3

/**
 * Who made the family, what kind of type it is, and which styles it has.
 *
 * The style list is the product's own (`metadata.styles`), seeded from the
 * files. Each row shows what the files say beside it — formats, and whether a
 * file still exists for that style — so a corrected name never hides a missing
 * upload.
 */
export function FamilySection({ ctx }: { ctx: SectionContext }) {
  const { values, metadata, family } = ctx
  const [expanded, setExpanded] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)

  const styles = metadata.styles ?? []
  const detectedByKey = new Map(family.styles.map((style) => [style.key, style]))
  const shown = expanded ? styles : styles.slice(0, COLLAPSED_STYLE_COUNT)
  const hidden = styles.length - shown.length
  const detectedName = family.familyNames[0]
  const unlisted = unlistedStyles(metadata, family)
  const nameError = ctx.fieldError("name")

  function setStyles(next: FontStyle[], immediate: boolean) {
    ctx.setFont("styles", next, { immediate })
    ctx.setFont("styleCount", next.length > 0 ? next.length : undefined, { immediate })
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading
        title="Family & styles"
        description="Confirm the metadata customers and channels use to identify the family."
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <TextInput
          id={FIELD_IDS.name}
          label="Family name"
          required
          value={values.name}
          maxLength={200}
          onChange={(event) => ctx.setValue("name", event.target.value)}
          error={nameError}
          hint={
            detectedName && detectedName.toLowerCase() !== values.name.trim().toLowerCase()
              ? `Your font files say “${detectedName}”.`
              : undefined
          }
          badge={
            detectedName && detectedName === values.name.trim() ? (
              <OriginBadge origin="detected" />
            ) : undefined
          }
        />
        <TextInput
          id={FIELD_IDS.brandName}
          label="Designer / foundry"
          value={values.brandName}
          maxLength={120}
          onChange={(event) => ctx.setValue("brandName", event.target.value)}
          error={ctx.fieldError("brandName")}
          hint={
            !values.brandName && (family.designer || family.manufacturer)
              ? `Detected: ${family.designer ?? family.manufacturer}`
              : undefined
          }
        />

        <FieldShell id={FIELD_IDS.classification} label="Classification">
          <select
            id={FIELD_IDS.classification}
            value={metadata.classification ?? ""}
            onChange={(event) =>
              ctx.setFont(
                "classification",
                event.target.value === ""
                  ? undefined
                  : (event.target.value as (typeof FONT_CLASSIFICATIONS)[number]),
                { immediate: true },
              )
            }
            className={INPUT_CLASS}
          >
            <option value="">Choose a classification</option>
            {FONT_CLASSIFICATIONS.map((value) => (
              <option key={value} value={value}>
                {FONT_CLASSIFICATION_LABELS[value]}
              </option>
            ))}
          </select>
        </FieldShell>

        <FieldShell id="font-style-count" label="Styles">
          <div className="flex items-center gap-2">
            <output
              id="font-style-count"
              className={`${INPUT_CLASS} flex-1 tabular-nums`}
              aria-live="polite"
            >
              {styles.length === 1 ? "1 font" : `${styles.length} fonts`}
            </output>
            <button
              type="button"
              className={QUIET_BUTTON_CLASS}
              onClick={() => dialogRef.current?.showModal()}
            >
              Manage styles
            </button>
          </div>
        </FieldShell>
      </div>

      {unlisted.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-l-2 border-[var(--color-warn)] bg-[var(--color-paper-2)] py-2.5 pr-3 pl-4">
          <p className="text-[14px]">
            {unlisted.length === 1
              ? `${unlisted[0]!.name} was uploaded but is not in the style list.`
              : `${unlisted.length} uploaded styles are not in the style list.`}
          </p>
          <button
            type="button"
            className={QUIET_BUTTON_CLASS}
            onClick={() => setStyles([...styles, ...unlisted.map(styleFromDetectedStyle)], true)}
          >
            Add to family
          </button>
        </div>
      ) : null}

      <div id={FIELD_IDS.styles} tabIndex={-1} className="flex flex-col gap-2 outline-none">
        <div className="flex items-baseline gap-2">
          <h3 className="text-[14px] text-[var(--color-ink)]">Font styles</h3>
          {styles.length > COLLAPSED_STYLE_COUNT ? (
            <span className="text-[13px] text-[var(--color-ink-3)]">
              ({shown.length} of {styles.length} shown)
            </span>
          ) : null}
        </div>

        {styles.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-[var(--color-rule)] px-4 py-5 text-[14px] text-[var(--color-ink-2)]">
            No styles yet. Upload font files and each face appears here, or add styles by hand with
            Manage styles.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-[10px] border border-[var(--color-rule)]">
            <table className="w-full min-w-[520px] text-left text-[14px]">
              <caption className="sr-only">Styles in the family</caption>
              <thead className="text-[12px] text-[var(--color-ink-3)]">
                <tr className="border-b border-[var(--color-rule-2)]">
                  <th scope="col" className="px-4 py-2 font-normal">
                    Style
                  </th>
                  <th scope="col" className="px-2 py-2 font-normal">
                    Weight
                  </th>
                  <th scope="col" className="px-2 py-2 font-normal">
                    Width
                  </th>
                  <th scope="col" className="px-2 py-2 font-normal">
                    Formats
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-normal">
                    <span className="sr-only">Validation</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((style) => (
                  <StyleRow key={style.key} style={style} detected={detectedByKey.get(style.key)} />
                ))}
              </tbody>
            </table>
            {hidden > 0 || expanded ? (
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setExpanded((value) => !value)}
                className="w-full border-t border-[var(--color-rule-2)] px-4 py-2.5 text-left text-[14px] text-[var(--color-accent)] hover:bg-[var(--color-paper-2)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-accent)]"
              >
                {expanded
                  ? "Show fewer styles"
                  : `+ ${hidden} more ${hidden === 1 ? "style" : "styles"}`}
              </button>
            ) : null}
          </div>
        )}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <TextInput
          id={FIELD_IDS.version}
          label="Version"
          value={values.version}
          maxLength={40}
          onChange={(event) => ctx.setValue("version", event.target.value)}
          error={ctx.fieldError("version")}
          hint={
            family.version && family.version !== values.version
              ? `Files say ${family.version}.`
              : undefined
          }
        />
        <div className="flex flex-col justify-end gap-1.5">
          <span className="text-[14px]">Variable font</span>
          <Toggle
            id="font-variable"
            checked={metadata.isVariable ?? false}
            onChange={(checked) => ctx.setFont("isVariable", checked, { immediate: true })}
            label={metadata.isVariable ? "Yes" : "No"}
            description={
              family.readCount > 0
                ? family.isVariable
                  ? "Detected: the files contain variation axes."
                  : "Detected: no variation axes in the files."
                : undefined
            }
          />
        </div>
      </div>

      {(metadata.isVariable || family.isVariable) && (metadata.axes ?? family.axes).length > 0 ? (
        <AxesTable axes={metadata.axes ?? family.axes} />
      ) : null}

      <ManageStylesDialog
        dialogRef={dialogRef}
        styles={styles}
        detected={family.styles}
        onChange={setStyles}
      />
    </div>
  )
}

function StyleRow({ style, detected }: { style: FontStyle; detected: DetectedStyle | undefined }) {
  const hasFiles = detected !== undefined && detected.sources.length > 0
  const edited = detected !== undefined && detected.name !== style.name
  return (
    <tr className="border-b border-[var(--color-rule-2)] last:border-b-0">
      <th scope="row" className="px-4 py-2.5 font-normal">
        <span className="flex flex-wrap items-baseline gap-x-2">
          {style.name}
          {style.italic ? (
            <span className="text-[12.5px] text-[var(--color-ink-3)]">Italic</span>
          ) : null}
          {edited ? <OriginBadge origin="edited" /> : null}
        </span>
      </th>
      <td className="px-2 py-2.5 text-[13px] text-[var(--color-ink-2)] tabular-nums">
        {weightLabel(style.weight)}
      </td>
      <td className="px-2 py-2.5 text-[13px] text-[var(--color-ink-2)]">
        {style.width ? WIDTH_NAMES[style.width] : "—"}
      </td>
      <td className="px-2 py-2.5 font-mono text-[11.5px] tracking-[0.06em] text-[var(--color-ink-2)] uppercase">
        {hasFiles ? detected!.formats.join(", ") : "—"}
      </td>
      <td className="px-4 py-2.5">
        <span className="flex items-center justify-end gap-2 text-[12.5px] text-[var(--color-ink-2)]">
          {hasFiles ? (
            <>
              <span className="sr-only">
                {detected!.sources.length === 1 ? "1 file" : `${detected!.sources.length} files`}
              </span>
              <StatusIcon status="complete" size={18} />
            </>
          ) : (
            <>
              <span>No file</span>
              <StatusIcon status="attention" size={18} />
            </>
          )}
        </span>
      </td>
    </tr>
  )
}

function AxesTable({
  axes,
}: {
  axes: ReadonlyArray<{ tag: string; name?: string; min: number; default: number; max: number }>
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[14px]">Variation axes</h3>
      <p className="text-[12.5px] text-[var(--color-ink-3)]">
        A variable font is one file with a continuous range. Buyers choose any point along each
        axis.
      </p>
      <div className="overflow-x-auto rounded-[10px] border border-[var(--color-rule)]">
        <table className="w-full min-w-[420px] text-left text-[14px]">
          <caption className="sr-only">Variation axes</caption>
          <thead className="text-[12px] text-[var(--color-ink-3)]">
            <tr className="border-b border-[var(--color-rule-2)]">
              <th scope="col" className="px-4 py-2 font-normal">
                Axis
              </th>
              <th scope="col" className="px-2 py-2 font-normal">
                Range
              </th>
              <th scope="col" className="px-4 py-2 font-normal">
                Default
              </th>
            </tr>
          </thead>
          <tbody>
            {axes.map((axis) => (
              <tr key={axis.tag} className="border-b border-[var(--color-rule-2)] last:border-b-0">
                <th scope="row" className="px-4 py-2.5 font-normal">
                  {axis.name ?? axis.tag}{" "}
                  <span className="font-mono text-[11px] text-[var(--color-ink-3)]">
                    {axis.tag}
                  </span>
                </th>
                <td className="px-2 py-2.5 tabular-nums">
                  {axis.min} – {axis.max}
                </td>
                <td className="px-4 py-2.5 tabular-nums">{axis.default}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * Correcting the style list.
 *
 * A native modal dialog: focus moves into it on open, Escape closes it, and
 * focus returns to Manage styles on close without any code of ours. Edits are
 * written through as they happen, so closing never discards anything.
 */
function ManageStylesDialog({
  dialogRef,
  styles,
  detected,
  onChange,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>
  styles: FontStyle[]
  detected: DetectedStyle[]
  onChange: (styles: FontStyle[], immediate: boolean) => void
}) {
  const update = (index: number, patch: Partial<FontStyle>, immediate = false) =>
    onChange(
      styles.map((style, i) => (i === index ? { ...style, ...patch } : style)),
      immediate,
    )

  const known = new Set(styles.map((style) => style.key))
  const restorable = detected.filter((style) => !known.has(style.key))

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="manage-styles-title"
      className="m-auto w-[min(760px,calc(100vw-2rem))] rounded-[14px] border border-[var(--color-rule)] bg-[var(--color-paper)] p-0 text-[var(--color-ink)] backdrop:bg-black/30"
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="manage-styles-title" className="font-display text-[22px] font-light">
              Manage styles
            </h2>
            <p className="text-[13.5px] text-[var(--color-ink-2)]">
              Correct names and details. Changes save as you make them.
            </p>
          </div>
          <form method="dialog">
            <button type="submit" className={QUIET_BUTTON_CLASS}>
              Done
            </button>
          </form>
        </div>

        <ul className="flex max-h-[60vh] flex-col divide-y divide-[var(--color-rule-2)] overflow-y-auto border-y border-[var(--color-rule)]">
          {styles.map((style, index) => {
            const nameId = `style-name-${index}`
            const emptyName = style.name.trim().length === 0
            return (
              <li
                key={style.key}
                className="grid gap-3 py-3 sm:grid-cols-[minmax(0,2fr)_7rem_minmax(0,1.3fr)_auto_auto] sm:items-end"
              >
                <FieldShell
                  id={nameId}
                  label="Name"
                  error={emptyName ? "A style needs a name." : null}
                >
                  <input
                    id={nameId}
                    defaultValue={style.name}
                    maxLength={120}
                    aria-invalid={emptyName || undefined}
                    aria-describedby={describedBy(nameId, emptyName ? "x" : null)}
                    onChange={(event) => {
                      const name = event.target.value
                      if (name.trim()) update(index, { name })
                    }}
                    className={INPUT_CLASS}
                  />
                </FieldShell>
                <FieldShell id={`style-weight-${index}`} label="Weight">
                  <input
                    id={`style-weight-${index}`}
                    type="number"
                    min={1}
                    max={1000}
                    step={1}
                    defaultValue={style.weight ?? ""}
                    onChange={(event) => {
                      const weight = Number(event.target.value)
                      update(index, {
                        weight:
                          event.target.value === "" ||
                          !Number.isInteger(weight) ||
                          weight < 1 ||
                          weight > 1000
                            ? undefined
                            : weight,
                      })
                    }}
                    className={INPUT_CLASS}
                  />
                </FieldShell>
                <FieldShell id={`style-width-${index}`} label="Width">
                  <select
                    id={`style-width-${index}`}
                    value={style.width ?? ""}
                    onChange={(event) =>
                      update(
                        index,
                        {
                          width: event.target.value === "" ? undefined : Number(event.target.value),
                        },
                        true,
                      )
                    }
                    className={INPUT_CLASS}
                  >
                    <option value="">Not set</option>
                    {Object.entries(WIDTH_NAMES).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </FieldShell>
                <label className="flex min-h-10 items-center gap-2 text-[14px]">
                  <input
                    type="checkbox"
                    checked={style.italic ?? false}
                    onChange={(event) => update(index, { italic: event.target.checked }, true)}
                    className="h-4 w-4 accent-[var(--color-accent)]"
                  />
                  Italic
                </label>
                <button
                  type="button"
                  className={QUIET_BUTTON_CLASS}
                  aria-label={`Remove ${style.name} from the family`}
                  onClick={() =>
                    onChange(
                      styles.filter((_, i) => i !== index),
                      true,
                    )
                  }
                >
                  Remove
                </button>
              </li>
            )
          })}
        </ul>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={QUIET_BUTTON_CLASS}
            onClick={() =>
              onChange(
                [
                  ...styles,
                  { key: `manual-${crypto.randomUUID()}`, name: `Style ${styles.length + 1}` },
                ],
                true,
              )
            }
          >
            Add a style
          </button>
          {restorable.length > 0 ? (
            <button
              type="button"
              className={QUIET_BUTTON_CLASS}
              onClick={() => onChange([...styles, ...restorable.map(styleFromDetectedStyle)], true)}
            >
              Add {restorable.length} detected {restorable.length === 1 ? "style" : "styles"}
            </button>
          ) : null}
        </div>
      </div>
    </dialog>
  )
}
