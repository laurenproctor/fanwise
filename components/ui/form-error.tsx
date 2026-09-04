/**
 * State must be readable from form as well as colour, per docs/design-system.md,
 * so this carries a left border and a label rather than relying on red text.
 */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p
      role="alert"
      className="border-l-2 border-[var(--color-bad)] bg-[var(--color-paper-2)] py-2 pl-3 text-[14px] text-[var(--color-ink)]"
    >
      {message}
    </p>
  )
}
