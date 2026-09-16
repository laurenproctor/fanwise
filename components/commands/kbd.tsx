import type { Platform } from "@/lib/commands/shortcuts"
import { shortcutParts } from "@/lib/commands/shortcuts"
import type { ShortcutDefinition } from "@/lib/commands/types"

/**
 * One keycap. Mono, uppercase, hairline border on the raised paper: the
 * design system's voice for anything the system knows rather than says.
 */
export function Kbd({
  children,
  className = "",
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <kbd
      className={`inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-[5px] border border-[var(--color-rule)] bg-[var(--color-paper-2)] px-[5px] font-mono text-[10px] font-medium tracking-[0.08em] text-[var(--color-ink-2)] uppercase ${className}`}
    >
      {children}
    </kbd>
  )
}

/**
 * A whole shortcut as keycaps: ⌘ K, or Ctrl K. Decorative beside a control
 * that already carries `aria-keyshortcuts`; a screen reader hears the
 * attribute, not the caps, so the caps are hidden from it.
 */
export function ShortcutKeys({
  shortcut,
  platform,
  className = "",
}: {
  shortcut: ShortcutDefinition
  platform: Platform
  className?: string
}) {
  return (
    <span aria-hidden="true" className={`inline-flex items-center gap-[3px] ${className}`}>
      {shortcutParts(shortcut, platform).map((part, index) => (
        <Kbd key={`${index}-${part}`}>{part}</Kbd>
      ))}
    </span>
  )
}

/** "F, then P" as two keycaps and a word. */
export function SequenceKeys({ second, className = "" }: { second: string; className?: string }) {
  return (
    <span aria-hidden="true" className={`inline-flex items-center gap-[5px] ${className}`}>
      <Kbd>F</Kbd>
      <span className="text-[11px] text-[var(--color-ink-3)]">then</span>
      <Kbd>{second.toUpperCase()}</Kbd>
    </span>
  )
}
