"use client"

import { useId, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { FormError } from "@/components/ui/form-error"
import { uploadImportSource } from "@/lib/products/upload-client"

/**
 * Upload a PDF or an HTML file.
 *
 * The file goes to private storage through a signed URL and never through a
 * server function, and the server measures it before an import starts. The
 * checks here are a courtesy that saves a round trip; the same checks run on
 * the server against what actually arrived.
 */

const RULES = {
  pdf_document: {
    accept: ".pdf,application/pdf",
    extension: /\.pdf$/i,
    maxBytes: 20 * 1024 * 1024,
    label: "PDF file",
    wrong: "Choose a .pdf file.",
    hint: "A guide, a brochure, a product sheet. Fanwise reads the text of the first 40 pages. A scanned document has no text to read, so paste its words instead.",
    submit: "Analyze PDF",
  },
  html_document: {
    accept: ".html,.htm,text/html",
    extension: /\.html?$/i,
    maxBytes: 2 * 1024 * 1024,
    label: "HTML file",
    wrong: "Choose an .html file.",
    hint: "A page you saved or downloaded, such as an exported artifact. Fanwise reads the markup and never runs its scripts.",
    submit: "Analyze HTML file",
  },
} as const

export function FileSourceForm({
  workspaceSlug,
  kind,
}: {
  workspaceSlug: string
  kind: "pdf_document" | "html_document"
}) {
  const rules = RULES[kind]
  const inputId = useId()
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [, startTransition] = useTransition()

  function check(candidate: File): string | null {
    if (!rules.extension.test(candidate.name)) return rules.wrong
    if (candidate.size === 0) return "That file is empty."
    if (candidate.size > rules.maxBytes) {
      return `That file is larger than ${Math.round(rules.maxBytes / (1024 * 1024))} MB, which is as much as Fanwise will read.`
    }
    return null
  }

  async function submit() {
    if (!file) {
      setError("Choose a file first.")
      return
    }
    const problem = check(file)
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError(null)
    const result = await uploadImportSource({ workspaceSlug, kind, file })
    if ("error" in result) {
      setBusy(false)
      setError(result.error)
      return
    }
    startTransition(() => router.push(result.href))
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
      className="flex flex-col gap-3"
    >
      <label htmlFor={inputId} className="label-mono">
        {rules.label}
      </label>
      <input
        id={inputId}
        type="file"
        accept={rules.accept}
        disabled={busy}
        aria-describedby={`${inputId}-hint`}
        aria-invalid={error !== null}
        onChange={(event) => {
          const chosen = event.target.files?.[0] ?? null
          setFile(chosen)
          setError(chosen ? check(chosen) : null)
        }}
        className="w-full rounded-[16px] border border-dashed border-[var(--color-rule)] bg-[var(--color-card)] px-5 py-6 text-[14px] text-[var(--color-ink-2)] file:mr-4 file:rounded-[var(--radius-pill)] file:border file:border-[var(--color-rule)] file:bg-transparent file:px-4 file:py-2 file:text-[14px] file:font-medium file:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
      />
      <p id={`${inputId}-hint`} className="max-w-prose text-[13px] text-[var(--color-ink-2)]">
        {rules.hint}
      </p>
      <Button type="submit" disabled={busy} className="min-h-[52px] self-start">
        {busy ? "Uploading…" : rules.submit}
      </Button>
      <FormError message={error} />
    </form>
  )
}
