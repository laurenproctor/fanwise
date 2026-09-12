import type { ShopName } from "./channels"
import { ShopMark } from "./shop-mark"
import { PRODUCT_TYPE_LABELS, type ProductType } from "@/lib/products/types"

/**
 * The not-found picture: a catalog of products on their way to channels, with
 * one route that never arrived.
 *
 * Here rather than beside app/not-found.tsx because it names shops, and the
 * marketing directory is where that is sanctioned (tests/unit/channel-boundaries.test.ts).
 * It names them as copy and imports nothing from the adapter layer. Nothing in
 * it is a claim about a real connection or a real product.
 *
 * All of it is hidden from assistive technology. The heading beside it already
 * says what happened; a screen reader walking nine placeholder cards would be
 * reading a drawing aloud.
 *
 * The broken route is carried by shape, not colour: a dashed line that stops
 * short, then a hollow endpoint standing on its own before the card it was
 * meant to reach. The cells are placed by named grid areas, so the phone layout
 * is a different arrangement of the same markup rather than a second drawing.
 */

type Cell = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h"

type Card = {
  cell: Cell
  type: ProductType
  status: "live" | "pending"
  /** A healthy connector leaving this card toward the 404 tile's column or row. */
  line?: "down" | "right"
}

const CARDS: readonly Card[] = [
  { cell: "a", type: "font", status: "live", line: "down" },
  { cell: "b", type: "template", status: "live", line: "down" },
  { cell: "c", type: "brush", status: "live" },
  { cell: "d", type: "graphic", status: "pending", line: "right" },
  { cell: "e", type: "mockup", status: "pending" },
  { cell: "f", type: "photo", status: "live" },
  { cell: "g", type: "icon", status: "live" },
  { cell: "h", type: "illustration", status: "live" },
]

/** A destination above each top-row card. Creative Market has no CC0 mark and falls back quietly. */
const DESTINATIONS: readonly { cell: "pa" | "pb" | "pc"; name: ShopName }[] = [
  { cell: "pa", name: "Etsy" },
  { cell: "pb", name: "Creative Market" },
  { cell: "pc", name: "Gumroad" },
]

export function MissingRoute() {
  return (
    <div aria-hidden="true" className="fw-nf-grid">
      {DESTINATIONS.map((destination) => (
        <span
          key={destination.cell}
          className={`fw-nf-pill fw-nf-cell--${destination.cell}`}
          data-cell={destination.cell}
        >
          <ShopMark name={destination.name} className="fw-nf-pill__mark" glyph={11} />
          <span className="fw-nf-pill__name">{destination.name}</span>
          <span className="fw-nf-pill__dot" />
        </span>
      ))}

      {CARDS.map((card) => (
        <span
          key={card.cell}
          className={`fw-nf-card fw-nf-cell--${card.cell}${card.line ? ` fw-nf-line--${card.line}` : ""}`}
          data-cell={card.cell}
        >
          <span className="fw-nf-card__thumb">
            <span className="fw-nf-card__type">{PRODUCT_TYPE_LABELS[card.type]}</span>
          </span>
          <span className="fw-nf-card__body">
            <span className="fw-nf-bar fw-nf-bar--long" />
            <span className="fw-nf-card__foot">
              <span className="fw-nf-bar fw-nf-bar--short" />
              <span className={`fw-nf-dot fw-nf-dot--${card.status}`} />
            </span>
          </span>
        </span>
      ))}

      <span className="fw-nf-tile fw-nf-cell--x fw-nf-line--down" data-cell="x">
        <span className="fw-nf-tile__code">404</span>
        <span className="fw-nf-card__body">
          <span className="fw-nf-bar fw-nf-bar--long fw-nf-bar--on-tile" />
          <span className="fw-nf-card__foot">
            <span className="fw-nf-bar fw-nf-bar--short fw-nf-bar--on-tile" />
            <span className="fw-nf-dot fw-nf-dot--missing" />
          </span>
        </span>
        <span className="fw-nf-break">
          <span className="fw-nf-break__line" />
          <span className="fw-nf-break__end" data-testid="broken-route" />
        </span>
      </span>
    </div>
  )
}
