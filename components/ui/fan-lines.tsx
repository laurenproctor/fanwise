/**
 * The fan, drawn as background.
 *
 * The same geometry as the fan mark and the first-run graphic — strokes
 * radiating from one pivot — reduced to atmosphere: dashed, at a fraction of
 * accent, behind the content and never competing with it. docs/design-system.md
 * calls the fan the signature device; this is its quietest use.
 *
 * Decorative, so aria-hidden and focusable="false": there is nothing here a
 * screen reader should describe, and the accessible name of the section it sits
 * behind is the heading, not this.
 *
 * The svg keeps its own aspect ratio rather than stretching to its box. A fan
 * squashed to a short wide strip stops reading as a fan and starts reading as a
 * smudge, so the caller sizes it and the drawing stays itself, clipped by the
 * parent's overflow. No animation, so nothing here to reduce.
 */

/** The drawing's own coordinate space. */
const WIDTH = 240
const HEIGHT = 200

/** Curves leaving one pivot at the top right and splaying across the bottom. */
const BEAMS = 5

/** The pivot, at the top right corner, where every curve begins. */
const PIVOT = { x: WIDTH - 6, y: 6 }

/**
 * One curve, from the pivot to a point on the bottom edge.
 *
 * The endpoints are spread along the bottom rather than along a diagonal. That
 * distinction is the whole drawing: endpoints on a diagonal put every curve on
 * roughly the same line and the fan reads as a single smudge, which is what the
 * first version of this did.
 *
 * The control point sits high and near the end's own x, so each curve leaves the
 * pivot heading left, bows outward, and arrives travelling downward. The
 * innermost is nearly vertical and the outermost sweeps the full width, which is
 * what makes the set read as a fan rather than as a bundle.
 */
function beam(index: number): string {
  const spread = index / (BEAMS - 1)
  const endX = WIDTH * 0.9 * (1 - spread)
  const endY = HEIGHT
  const controlX = endX + (PIVOT.x - endX) * 0.55
  const controlY = HEIGHT * 0.3
  return `M${PIVOT.x} ${PIVOT.y} Q${controlX} ${controlY} ${endX} ${endY}`
}

export function FanLines({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={`pointer-events-none absolute text-[var(--color-accent)] ${className}`}
    >
      {Array.from({ length: BEAMS }, (_, index) => (
        <path
          key={index}
          d={beam(index)}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.4}
          strokeWidth={1}
          strokeDasharray="2 4"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {/* The pivot: one filled dot, the same device as the fan mark's centre. */}
      <circle cx={PIVOT.x} cy={PIVOT.y} r={3.5} fill="currentColor" fillOpacity={0.8} />
    </svg>
  )
}
