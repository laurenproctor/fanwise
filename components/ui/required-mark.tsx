/**
 * The mark that says a field must be filled in.
 *
 * One component rather than an asterisk typed into each label, because the
 * thing that goes wrong with required markers is not how they look, it is that
 * some field somewhere is required and unmarked. A single mark, rendered from
 * the same `required` the input already carries, cannot drift from it.
 *
 * `aria-hidden` on purpose. The input's own `required` attribute is what a
 * screen reader announces, and it announces it on the control where the answer
 * is actually typed. Reading "asterisk" out as part of the label name would say
 * the same thing a second time, less clearly.
 */
export function RequiredMark() {
  return (
    <span aria-hidden className="ml-1 text-[var(--color-bad)]">
      *
    </span>
  )
}
