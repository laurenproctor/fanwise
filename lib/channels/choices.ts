import type { ListingChoiceSpec } from "./types"

/**
 * Reading a channel's declared choices back from a form.
 *
 * One parser for every channel, driven by the declaration: a single choice
 * takes one of its options, a multiple takes a subset, a text takes a bounded
 * string. Anything the declaration did not name is not read, so a form cannot
 * write a metadata key the adapter never asked for.
 *
 * Refusals name the choice rather than the field: the creator is looking at a
 * control with a label, and the message should carry that label.
 */

export type ParsedChoices =
  { ok: true; values: Record<string, unknown> } | { ok: false; message: string }

/** True while the choice's `showWhen` condition holds, or when it has none. */
export function choiceVisible(spec: ListingChoiceSpec, values: Record<string, unknown>): boolean {
  if (!spec.showWhen) return true
  const current = values[spec.showWhen.key]
  const wanted = spec.showWhen.value
  return typeof wanted === "string" ? current === wanted : wanted.includes(current as string)
}

export function parseChoices(
  specs: readonly ListingChoiceSpec[],
  formData: FormData,
): ParsedChoices {
  const values: Record<string, unknown> = {}

  for (const spec of specs) {
    switch (spec.kind) {
      case "single": {
        const raw = formData.get(spec.key)
        const value = typeof raw === "string" ? raw.trim() : ""
        if (value === "") {
          values[spec.key] = null
          break
        }
        if (!spec.options.some((option) => option.value === value)) {
          return { ok: false, message: `${spec.label}: that is not one of the options.` }
        }
        values[spec.key] = value
        break
      }
      case "multiple": {
        const raw = formData
          .getAll(spec.key)
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.trim())
          .filter((v) => v.length > 0)
        const unknown = raw.find((v) => !spec.options.some((option) => option.value === v))
        if (unknown) {
          return { ok: false, message: `${spec.label}: ${unknown} is not one of the options.` }
        }
        const unique = [...new Set(raw)]
        if (spec.max !== undefined && unique.length > spec.max) {
          return { ok: false, message: `${spec.label}: choose at most ${spec.max}.` }
        }
        values[spec.key] = unique
        break
      }
      case "text": {
        const raw = formData.get(spec.key)
        const value = typeof raw === "string" ? raw.trim() : ""
        const max = spec.maxLength ?? 2000
        if (value.length > max) {
          return { ok: false, message: `${spec.label}: keep this under ${max} characters.` }
        }
        values[spec.key] = value === "" ? null : value
        break
      }
    }
  }

  return { ok: true, values }
}

/** A stable string of the current values, for keying a component on them. */
export function choicesKey(
  specs: readonly ListingChoiceSpec[],
  metadata: Record<string, unknown>,
): string {
  return JSON.stringify(specs.map((spec) => [spec.key, metadata[spec.key] ?? null]))
}
