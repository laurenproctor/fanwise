/**
 * The counterpart to FormError. Same shape, so a form that swaps one for the
 * other does not move, and the same rule applies: readable from form as well as
 * colour, per docs/design-system.md.
 */
export function FormNotice({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p
      role="status"
      className="border-l-2 border-[var(--color-ok)] bg-[var(--color-paper-2)] py-2 pl-3 text-[14px] text-[var(--color-ink)]"
    >
      {message}
    </p>
  )
}
