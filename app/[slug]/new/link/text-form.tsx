"use client"

import { useActionState, useState } from "react"
import { useFormStatus } from "react-dom"
import { Button } from "@/components/ui/button"
import { FormError } from "@/components/ui/form-error"
import { startPastedImportAction, type ImportActionState } from "@/lib/imports/actions"

/**
 * Paste text, or paste HTML markup.
 *
 * One component for both because they are one gesture: a big box and a button.
 * The kind travels as a hidden field and decides only how the job reads what
 * arrived. The limit is shown before it is hit rather than after, since a
 * refusal of a paste loses nothing but is still an unpleasant surprise.
 */

/** Mirrors SOURCE_LIMITS.maxPasteCharacters, which the server enforces. */
const MAX_CHARACTERS = 200_000

const FIELD =
  "min-h-[240px] w-full resize-y rounded-[16px] border border-[var(--color-rule)] bg-[var(--color-card)] px-5 py-4 text-[15px] leading-[1.6] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-3)] focus:border-[var(--color-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"

function Submit({ label, disabled }: { label: string; disabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending || disabled} className="min-h-[52px] self-start">
      {pending ? "Reading…" : label}
    </Button>
  )
}

export function PastedSourceForm({
  workspaceSlug,
  kind,
}: {
  workspaceSlug: string
  kind: "pasted_text" | "html_document"
}) {
  const action = startPastedImportAction.bind(null, workspaceSlug)
  const [state, formAction] = useActionState<ImportActionState, FormData>(action, { error: null })
  const [content, setContent] = useState("")

  const html = kind === "html_document"
  const id = html ? "import-source-html" : "import-source-text"
  const over = content.length > MAX_CHARACTERS

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="kind" value={kind} />
      <label htmlFor={id} className="label-mono">
        {html ? "HTML markup" : "Product text"}
      </label>
      <textarea
        id={id}
        name="content"
        required
        autoFocus={!html}
        spellCheck={!html}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        aria-describedby={`${id}-hint ${id}-count`}
        aria-invalid={over || state.error !== null}
        placeholder={
          html
            ? "<!doctype html>…"
            : "Paste a description, a sales page, notes, or the code of something you built."
        }
        className={`${FIELD} ${html ? "font-mono text-[13px]" : ""}`}
      />
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p id={`${id}-hint`} className="max-w-prose text-[13px] text-[var(--color-ink-2)]">
          {html
            ? "The source of a page, such as an artifact you copied. Fanwise reads the markup as text and never runs its scripts."
            : "Fanwise reads the words and drafts a listing from them. Pasted code is read, never run."}
        </p>
        <p
          id={`${id}-count`}
          className={`font-mono text-[12px] ${over ? "text-[var(--color-bad)]" : "text-[var(--color-ink-3)]"}`}
        >
          {content.length.toLocaleString("en-US")} / {MAX_CHARACTERS.toLocaleString("en-US")}
        </p>
      </div>
      <Submit label={html ? "Analyze HTML" : "Analyze text"} disabled={over} />
      <FormError message={over ? "That is more than Fanwise will take as a paste." : state.error} />
    </form>
  )
}
