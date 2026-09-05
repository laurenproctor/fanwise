import Link from "next/link"
import type { ComponentProps } from "react"

/**
 * Pill buttons, per docs/design-system.md. Solid for primary, hairline border
 * for secondary. The radius was tried square and reverted; leave it alone.
 */
type Variant = "primary" | "secondary"

const base =
  "inline-flex items-center justify-center rounded-[var(--radius-pill)] px-[18px] py-[10px] " +
  "text-[14px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"

const variants: Record<Variant, string> = {
  primary: "bg-[var(--color-accent)] text-white hover:bg-[var(--color-blue)]",
  secondary:
    "border border-[var(--color-rule)] bg-transparent text-[var(--color-ink)] " +
    "hover:bg-[var(--color-paper-2)]",
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
