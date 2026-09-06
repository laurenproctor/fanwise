"use client"

import { Button } from "@/components/ui/button"

export default function WorkspaceError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-start gap-4">
      <span className="label-mono">Something went wrong</span>
      <h1 className="font-display text-2xl font-light tracking-[-0.02em]">
        This workspace could not be loaded
      </h1>
      <p className="max-w-prose text-[15px] text-[var(--color-ink-2)]">
        The problem was logged. Try again, and if it keeps happening the workspace may need
        attention.
      </p>
      <Button variant="secondary" onClick={reset}>
        Try again
      </Button>
    </div>
  )
}
