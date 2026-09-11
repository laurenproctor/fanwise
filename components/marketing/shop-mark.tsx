import type { Shop } from "./channels"

/**
 * A shop's own mark, for the cards on the Marketplaces page.
 *
 * This is a second table. The application has one in
 * components/channels/channel-mark.tsx, and three shops appear in both.
 *
 * That is deliberate, and it is the same bargain components/marketing/channels.ts
 * already strikes: the marketing site keeps its own copy of what a shop is
 * rather than reading the adapter layer, so that adding a channel to the
 * registry cannot quietly rewrite the public site. The site also names four
 * shops that have no adapter at all, so there is no one table that could serve
 * both. tests/unit/channel-marks.test.ts pins the overlap, so the copies cannot
 * drift without a test going red.
 *
 * Keyed by `Shop["name"]`, which is the only handle this side has for a shop.
 */

export interface ShopBrandMark {
  hex: string
  /**
   * One path on a 24 by 24 viewBox, taken from the CC0 marks published by
   * simple-icons rather than redrawn. An approximated logo is a wrong logo.
   */
  path: string
}

/**
 * Partial on purpose. Creative Market and MyFonts publish no CC0 mark, and the
 * fallback below says so quietly rather than inventing something.
 */
export const SHOP_MARKS: Partial<Record<Shop["name"], ShopBrandMark>> = {
  Shopify: {
    hex: "#7AB55C",
    path: "M15.337 23.979l7.216-1.561s-2.604-17.613-2.625-17.73c-.018-.116-.114-.192-.211-.192s-1.929-.136-1.929-.136-1.275-1.274-1.439-1.411c-.045-.037-.075-.057-.121-.074l-.914 21.104h.023zM11.71 11.305s-.81-.424-1.774-.424c-1.447 0-1.504.906-1.504 1.141 0 1.232 3.24 1.715 3.24 4.629 0 2.295-1.44 3.76-3.406 3.76-2.354 0-3.54-1.465-3.54-1.465l.646-2.086s1.245 1.066 2.28 1.066c.675 0 .975-.545.975-.932 0-1.619-2.654-1.694-2.654-4.359-.034-2.237 1.571-4.416 4.827-4.416 1.257 0 1.875.361 1.875.361l-.945 2.715-.02.01zM11.17.83c.136 0 .271.038.405.135-.984.465-2.064 1.639-2.508 3.992-.656.213-1.293.405-1.889.578C7.697 3.75 8.951.84 11.17.84V.83zm1.235 2.949v.135c-.754.232-1.583.484-2.394.736.466-1.777 1.333-2.645 2.085-2.971.193.501.309 1.176.309 2.1zm.539-2.234c.694.074 1.141.867 1.429 1.755-.349.114-.735.231-1.158.366v-.252c0-.752-.096-1.371-.271-1.871v.002zm2.992 1.289c-.02 0-.06.021-.078.021s-.289.075-.714.21c-.423-1.233-1.176-2.37-2.508-2.37h-.115C12.135.209 11.669 0 11.265 0 8.159 0 6.675 3.877 6.21 5.846c-1.194.365-2.063.636-2.16.674-.675.213-.694.232-.772.87-.075.462-1.83 14.063-1.83 14.063L15.009 24l.927-21.166z",
  },
  /* The Woo mark rather than the WooCommerce wordmark, which is a smudge
    at this size. */
  WooCommerce: {
    hex: "#96588A",
    path: "M10.118 8.895c-.562 0-.928.183-1.255.797l-1.49 2.811v-2.496c0-.745-.353-1.111-1.007-1.111s-.928.222-1.255.85l-1.412 2.757v-2.47c0-.797-.327-1.137-1.124-1.137H.954C.34 8.895 0 9.183 0 9.706s.327.837.928.837h.667v3.15c0 .889.601 1.412 1.464 1.412s1.255-.34 1.686-1.137l.941-1.765v1.49c0 .876.575 1.412 1.451 1.412s1.203-.301 1.699-1.137l2.17-3.66c.471-.798.144-1.413-.901-1.413zm4.078 0c-1.778 0-3.124 1.321-3.124 3.112s1.359 3.098 3.124 3.098 3.111-1.32 3.124-3.098c0-1.791-1.359-3.112-3.124-3.112m0 4.301c-.667 0-1.124-.497-1.124-1.19s.458-1.203 1.124-1.203 1.124.51 1.124 1.203-.444 1.19-1.124 1.19m6.68-4.301c-1.765 0-3.124 1.32-3.124 3.111s1.359 3.098 3.124 3.098S24 13.784 24 12.006s-1.359-3.111-3.124-3.111m0 4.301c-.68 0-1.111-.497-1.111-1.19s.444-1.203 1.111-1.203S22 11.313 22 12.006s-.444 1.19-1.124 1.19",
  },
  Etsy: {
    hex: "#F16521",
    path: "M8.559 2.445c0-.325.033-.52.59-.52h7.465c1.3 0 2.02 1.11 2.54 3.193l.42 1.666h1.27c.23-4.728.43-6.784.43-6.784s-3.196.36-5.09.36H6.635L1.521.196v1.37l1.725.326c1.21.24 1.5.496 1.6 1.606 0 0 .11 3.27.11 8.64 0 5.385-.09 8.61-.09 8.61 0 .973-.39 1.333-1.59 1.573l-1.722.33V24l5.13-.165h8.55c1.935 0 6.39.165 6.39.165.105-1.17.75-6.48.855-7.064h-1.2l-1.284 2.91c-1.005 2.28-2.476 2.445-4.11 2.445h-4.906c-1.63 0-2.415-.64-2.415-2.05V12.8s3.62 0 4.79.096c.912.064 1.463.325 1.76 1.598l.39 1.695h1.41l-.09-4.278.192-4.305h-1.391l-.45 1.89c-.283 1.244-.48 1.47-1.754 1.6-1.666.17-4.815.14-4.815.14V2.45h-.05z",
  },
  "Envato Market": {
    hex: "#81B441",
    path: "M16.156 0a2.7 2.7 0 0 0-1.886.8L4 11.253c-.382.42-.558.978-.453 1.57.176.945 1.116 1.571 2.06 1.399l5.54-1.13c.12-.025.183.136.082.204L5.088 17.23c-.769.487-1.119 1.36-.875 2.234.244 1.151 1.398 1.814 2.516 1.537l9.183-2.26a.11.11 0 0 1 .113.176l-1.433 1.77c-.383.487.244 1.15.77.767l4.716-3.877c.84-.697.281-2.062-.803-1.957l-.011-.004-6.047.65a.111.111 0 0 1-.08-.199l5.918-4.609c.382-.315.628-.801.523-1.326-.105-.803-.767-1.328-1.607-1.223l-6.43.942c-.112.015-.174-.128-.084-.2l6.375-4.867c1.256-.978 1.36-2.898.209-4.015A2.6 2.6 0 0 0 16.156 0M13.1 21.855a1.07 1.07 0 0 0-1.073 1.073A1.07 1.07 0 0 0 13.1 24a1.07 1.07 0 0 0 1.072-1.072 1.07 1.07 0 0 0-1.072-1.073",
  },
  /* Adobe's own mark. Adobe Stock has no separate CC0 mark, and the parent
    brand is the honest attribution: nobody reads a red Adobe A beside the
    words Adobe Stock as another company. */
  "Adobe Stock": {
    hex: "#FF0000",
    path: "M13.966 22.624l-1.69-4.281H8.122l3.892-9.144 5.662 13.425zM8.884 1.376H0v21.248zm15.116 0h-8.884L24 22.624Z",
  },
}

/**
 * Decorative: the shop's name is the heading beside it, so a mark announced as
 * well would say the name twice.
 */
export function ShopMark({ name }: { name: Shop["name"] }) {
  const mark = SHOP_MARKS[name]

  if (!mark) {
    return (
      <span aria-hidden className="fw-shop__mark fw-shop__mark--plain">
        {name.trim().charAt(0).toUpperCase()}
      </span>
    )
  }

  return (
    <span
      aria-hidden
      className="fw-shop__mark"
      style={{
        // The badge recipe next to it, in the brand's colour rather than a
        // semantic one: a tint under the mark and a border around it.
        background: `color-mix(in srgb, ${mark.hex} 9%, transparent)`,
        borderColor: `color-mix(in srgb, ${mark.hex} 30%, transparent)`,
      }}
    >
      <svg viewBox="0 0 24 24" width={22} height={22} fill={mark.hex} aria-hidden>
        <path d={mark.path} />
      </svg>
    </span>
  )
}
