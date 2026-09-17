"use client"

import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { FormError } from "@/components/ui/form-error"
import { markSubmittedAction, type SubmissionState } from "@/lib/channels/actions"

/**
 * The last step of an assisted handoff: the creator says they did it, and
 * pastes the address they got back.
 *
 * Nothing here says Publish, because nothing here publishes. It records a
 * claim, and the card that reads it says the claim is self-reported. The URL
 * is the only handle Fanwise will ever hold on this listing, which is why it
 * is asked for by name rather than as a checkbox.
 */

function Submit({ again }: { again: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : again ? "Update the address" : "Mark submitted"}
    </Button>
  )
}

export function MarkSubmitted({
  workspaceSlug,
  listingId,
  channelName,
  urlLabel,
  urlPlaceholder,
  submittedUrl,
}: {
  workspaceSlug: string
  listingId: string
  channelName: string
  urlLabel: string
  urlPlaceholder: string
  /** The address on record, when the listing has already been marked. */
  submittedUrl: string | null
}) {
  const router = useRouter()
  const [state, formAction] = useActionState(
    async (prev: SubmissionState, formData: FormData) => {
      const result = await markSubmittedAction(workspaceSlug, listingId, prev, formData)
      if (!result.error) router.refresh()
      return result
    },
    { error: null, externalUrl: null } as SubmissionState,
  )

  const recorded = state.externalUrl ?? submittedUrl

  return (
    <form action={formAction} className="grid gap-3" aria-labelledby="submitted-heading">
      <div className="grid gap-0.5">
        <span id="submitted-heading" className="label-mono text-[var(--color-ink)]">
          Done on {channelName}?
        </span>
        <span className="max-w-prose text-[13px] text-[var(--color-ink-2)]">
          Paste the address {channelName} gave you. Fanwise records it as your word: this channel
          has no API to confirm it with.
        </span>
      </div>
      {recorded ? (
        <p className="text-[13px] text-[var(--color-ink-2)]" role="status">
          On record:{" "}
          <a
            className="underline underline-offset-2 hover:text-[var(--color-accent)]"
            href={recorded}
            target="_blank"
            rel="noreferrer noopener"
          >
            {recorded}
          </a>
        </p>
      ) : null}
      {/*
        Text, not a url input: the browser's own check would refuse an address
        pasted without its scheme, and the adapter's parser, which accepts one
        and canonicalizes it, is the check that counts.
      */}
      <Field
        label={urlLabel}
        name="url"
        type="text"
        inputMode="url"
        autoComplete="off"
        placeholder={urlPlaceholder}
        defaultValue={recorded ?? ""}
        required
      />
      <div>
        <Submit again={recorded !== null} />
      </div>
      <FormError message={state.error} />
    </form>
  )
}
