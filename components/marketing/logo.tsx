/**
 * The fan mark: five strokes leaving one point, and the point itself.
 *
 * Drawn with `currentColor` so the same file serves the dark nav, the light nav
 * and the 40px mark on the ink CTA panel without a second copy.
 */
export function FanMark({ size = 21 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ width: size, height: size, display: "block" }}
    >
      <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M12 21 3.6 8.4" />
        <path d="M12 21 7.6 4.6" />
        <path d="M12 21V3.6" />
        <path d="m12 21 4.4-16.4" />
        <path d="M12 21 20.4 8.4" />
      </g>
      <circle cx="12" cy="21" r="1.7" fill="currentColor" />
    </svg>
  )
}
