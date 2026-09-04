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
