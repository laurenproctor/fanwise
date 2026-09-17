"use client"

import { useActionState, useMemo, useState } from "react"
import { useFormStatus } from "react-dom"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { FormError } from "@/components/ui/form-error"
import { SaveStatusIndicator } from "@/components/ui/save-status"
import { updateListingChoicesAction, type SaveState } from "@/lib/channels/actions"
import { choiceVisible } from "@/lib/channels/choices"
import type { ListingChoiceSpec } from "@/lib/channels/types"

/**
 * The settings a channel's own form asks for that are not listing fields.
 *
 * Rendered from the adapter's declaration and nothing else, so this component
 * knows no channel: a single choice is a set of radios, a multiple is a set of
 * checkboxes, a text is a field. What it saves goes to `metadata` under the
 * keys the adapter named, and the server checks each value against the same
 * declaration before writing it.
 *
 * Saved separately from the listing editor because it is a different thing:
 * the editor writes the words a buyer reads, this writes how the channel's
 * form is filled in around them.
 */

function Submit() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      {pending ? "Saving…" : "Save choices"}
    </Button>
  )
}

export function ListingChoices({
  workspaceSlug,
  listingId,
  channelName,
  choices,
  initial,
}: {
  workspaceSlug: string
  listingId: string
  channelName: string
  choices: readonly ListingChoiceSpec[]
  /** The current values, from the listing's metadata. */
  initial: Record<string, unknown>
}) {
  const router = useRouter()
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const out: Record<string, unknown> = {}
    for (const spec of choices) out[spec.key] = initial[spec.key] ?? null
    return out
  })
  const [state, formAction] = useActionState(
    async (prev: SaveState, formData: FormData) => {
      const result = await updateListingChoicesAction(workspaceSlug, listingId, prev, formData)
      if (!result.error) router.refresh()
      return result
    },
    { error: null, savedAt: null } as SaveState,
  )

  const visible = useMemo(
    () => choices.filter((spec) => choiceVisible(spec, values)),
    [choices, values],
  )

  if (choices.length === 0) return null

  return (
    <form action={formAction} className="grid gap-5" aria-labelledby="choices-heading">
      <div className="grid gap-0.5">
        <span id="choices-heading" className="label-mono text-[var(--color-ink)]">
          {channelName} choices
        </span>
        <span className="text-[13px] text-[var(--color-ink-2)]">
          What {channelName}&apos;s own form asks for beyond the listing.
        </span>
      </div>

      {visible.map((spec) => (
        <fieldset key={spec.key} className="grid gap-2">
          {spec.kind === "text" ? (
            <Field
              label={spec.label}
              name={spec.key}
              value={typeof values[spec.key] === "string" ? (values[spec.key] as string) : ""}
              onChange={(event) => setValues({ ...values, [spec.key]: event.target.value })}
              placeholder={spec.placeholder}
              maxLength={spec.maxLength}
              hint={spec.description}
            />
          ) : (
            <>
              <legend className="label-mono">{spec.label}</legend>
              {spec.description ? (
                <p className="max-w-prose text-[13px] text-[var(--color-ink-3)]">
                  {spec.description}
                </p>
              ) : null}
              <div className="grid gap-1.5 sm:grid-cols-2">
                {spec.options.map((option) => {
                  const current = values[spec.key]
                  const checked =
                    spec.kind === "single"
                      ? current === option.value
                      : Array.isArray(current) && current.includes(option.value)
                  return (
                    <label
                      key={option.value}
                      className="flex items-start gap-2 rounded-[10px] border border-[var(--color-rule)] px-3 py-2 text-[14px] text-[var(--color-ink)] has-[:checked]:border-[var(--color-accent)]"
                    >
                      <input
                        type={spec.kind === "single" ? "radio" : "checkbox"}
                        name={spec.key}
                        value={option.value}
                        checked={checked}
                        onChange={(event) => {
                          if (spec.kind === "single") {
                            setValues({ ...values, [spec.key]: option.value })
                          } else {
                            const list = Array.isArray(current) ? (current as string[]) : []
                            setValues({
                              ...values,
                              [spec.key]: event.target.checked
                                ? [...list, option.value]
                                : list.filter((v) => v !== option.value),
                            })
                          }
                        }}
                        className="mt-1 accent-[var(--color-accent)]"
                      />
                      <span className="grid gap-0.5">
                        <span>{option.label}</span>
                        {option.hint ? (
                          <span className="text-[12px] text-[var(--color-ink-3)]">
                            {option.hint}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  )
                })}
              </div>
            </>
          )}
        </fieldset>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <Submit />
        <SaveStatusIndicator
          status={state.error ? "error" : state.savedAt ? "saved" : "clean"}
          savedAt={state.savedAt}
        />
      </div>
      <FormError message={state.error} />
    </form>
  )
}
