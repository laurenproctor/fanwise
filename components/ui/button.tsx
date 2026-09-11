import Link from "next/link"
import type { ComponentProps } from "react"

/**
 * Pill buttons, per docs/design-system.md. Solid for primary, hairline border
 * for secondary. The radius was tried square and reverted; leave it alone.
 */
type Variant = "primary" | "secondary"

const base =
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius-pill)] border px-[22px] py-[12px] " +
  "text-[15px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-3 " +
  "focus-visible:outline-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"

const variants: Record<Variant, string> = {
  primary:
    "border-[var(--color-action)] bg-[var(--color-action)] text-[var(--color-on-action)] " +
    "hover:border-[var(--color-action-hover)] hover:bg-[var(--color-action-hover)]",
  secondary:
    "border-[var(--color-rule)] bg-transparent text-[var(--color-ink)] " +
    "hover:border-[var(--color-ink-3)] hover:bg-[var(--color-paper-2)]",
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />
}

/**
 * A link that looks like a button.
 *
 * Exists because `<Link><Button/></Link>` renders a <button> inside an <a>,
 * which is invalid HTML: browsers disagree about which element receives the
 * click, and the navigation intermittently does not happen at all. Sharing the
 * styles keeps the two in step without nesting the elements.
 */
export function ButtonLink({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={`${base} ${variants[variant]} ${className}`} {...props} />
}
