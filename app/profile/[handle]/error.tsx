"use client"

import { Button } from "@/components/ui/button"

/**
 * The public error boundary.
 *
 * Says nothing about what failed. A stranger cannot act on a database error
 * and a creator reading this is not the person who can fix it either; the
 * detail goes to the logs, where somebody can.
 */
export default function PublicError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col items-start gap-4 px-5 py-28 sm:px-8">
      <span className="label-mono">Something went wrong</span>
      <h1 className="font-display text-[32px] leading-[1.05] font-extralight tracking-[-0.04em]">
        This page could not be loaded
      </h1>
      <p className="text-[16px] text-[var(--color-ink-2)]">
        The problem was logged. Try again in a moment.
      </p>
      <Button variant="secondary" onClick={reset}>
        Try again
      </Button>
    </div>
  )
}
