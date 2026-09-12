/**
 * One settings section: a label column, and the controls beside it.
 *
 * The label column is the editorial device of this page. It carries the section
 * name and one line saying what lives there, and it sits beside the controls on
 * a laptop and above them on a phone, which is the only responsive behaviour
 * this layout has.
 *
 * The heading is an h2 under the page's single h1, and it names the section for
 * assistive technology through aria-labelledby on the <section>, so the sections
 * are navigable as regions rather than as three unlabelled groups.
 */
export function SettingsSection({
  id,
  heading,
  description,
  children,
}: React.PropsWithChildren<{
  id: string
  heading: string
  description: string
}>) {
  const headingId = `${id}-heading`

  return (
    <section
      aria-labelledby={headingId}
      className="grid gap-8 border-t border-[var(--color-rule)] pt-12 sm:pt-14 lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-14 lg:pt-16"
    >
      <div className="flex flex-col gap-2">
        <h2 id={headingId} className="label-mono text-[var(--color-ink-2)]">
          {heading}
        </h2>
        <p className="max-w-[24ch] text-[14px] text-[var(--color-ink-3)]">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}
