"use client"

import { useActionState, useState } from "react"
import { useFormStatus } from "react-dom"
import { Button } from "@/components/ui/button"
import { FormError } from "@/components/ui/form-error"
import { ImportChrome } from "@/components/imports/import-chrome"
import { SourcePlaceholder } from "@/components/imports/source-placeholder"
import { startImportAction, type ImportActionState } from "@/lib/imports/actions"
import { validateSourceUrl } from "@/lib/imports/url"

/**
 * The empty state: one field, one action.
 *
 * The shape check runs here as well as on the server, and the duplication is
 * deliberate — it saves a round trip for an obvious mistake. It is not the
 * boundary: `lib/net/outbound.ts` is, it runs server-side, it resolves DNS, and
 * its answer is the one that decides whether anything is fetched. See
 * `lib/imports/url.ts`, which says the same thing at more length.
 */
function Submit() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} className="min-h-[52px] shrink-0">
      {pending ? "Reading…" : "Analyze product"}
    </Button>
  )
}

export function PasteForm({ workspaceSlug }: { workspaceSlug: string }) {
  const action = startImportAction.bind(null, workspaceSlug)
  const [state, formAction] = useActionState<ImportActionState, FormData>(action, { error: null })
  const [url, setUrl] = useState("")
  const [local, setLocal] = useState<string | null>(null)

  const message = local ?? state.error

  return (
    <ImportChrome workspaceSlug={workspaceSlug}>
      <form
        action={formAction}
        onSubmit={(event) => {
          const checked = validateSourceUrl(url)
          if (!checked.ok) {
            event.preventDefault()
            setLocal(checked.message)
          }
        }}
        className="flex flex-col gap-3"
      >
        <label htmlFor="import-source-url" className="label-mono">
          Product link
        </label>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            id="import-source-url"
            name="sourceUrl"
            type="url"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            required
            autoFocus
            value={url}
            onChange={(event) => {
              setUrl(event.target.value)
              setLocal(null)
            }}
            aria-describedby="import-source-hint"
            aria-invalid={message !== null}
            placeholder="https://"
            className="min-h-[52px] w-full rounded-[var(--radius-pill)] border border-[var(--color-rule)] bg-[var(--color-card)] px-5 py-3 text-[15px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-3)] focus:border-[var(--color-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          />
          <Submit />
        </div>
        <p id="import-source-hint" className="text-[13px] text-[var(--color-ink-2)]">
          A public link anyone can open. Fanwise reads the page as a visitor would — it never signs
          in, and never asks you for a password to it.
        </p>
        <FormError message={message} />
      </form>

      <div className="mt-10 max-w-[640px]">
        <SourcePlaceholder />
      </div>
    </ImportChrome>
  )
}
