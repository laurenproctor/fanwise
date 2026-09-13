import type { LinkKind } from "@/lib/public/profile-links"

/**
 * The mark beside a profile link: a platform's glyph when the address is on
 * one Fanwise recognises, and a globe for everything else, a creator's own
 * site included.
 *
 * Line drawings in the current colour, at the weight of every other glyph on
 * a public page, rather than the platforms' own coloured logos: a row of brand
 * colours reads as a marketplace footer, and these have to sit quietly beside
 * a studio's name in both themes. Always decorative; the link beside it
 * carries the words.
 */
export function LinkGlyph({ kind, size = 18 }: { kind: LinkKind; size?: number }) {
  const common = {
    viewBox: "0 0 24 24",
    width: size,
    height: size,
    "aria-hidden": true,
    focusable: false,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "data-glyph": kind,
  }
  switch (kind) {
    case "instagram":
      return (
        <svg {...common}>
          <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
          <circle cx="12" cy="12" r="3.8" />
          <circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" />
        </svg>
      )
    case "behance":
      return (
        <svg {...common}>
          <path d="M3 7h5a2.5 2.5 0 0 1 0 5H3V7Zm0 5h5.5a2.75 2.75 0 0 1 0 5.5H3V12Z" />
          <path d="M14 13.5h7a3.5 3.5 0 1 0-1 2.5M15 8h5" />
        </svg>
      )
    case "dribbble":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M5.5 5.8c3.6 3.3 6.9 8.3 8.4 14.8M3.2 10.3c5.7.4 11-.8 15.1-4.6M8.3 20.2c1.8-4.6 6.1-7.5 12.6-6.4" />
        </svg>
      )
    case "linkedin":
      return (
        <svg {...common}>
          <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
          <path d="M8 10.5V16M8 7.8v.1M11.5 16v-5.5M11.5 13c0-1.6 1-2.6 2.3-2.6s2.2.9 2.2 2.6V16" />
        </svg>
      )
    case "x":
      return (
        <svg {...common}>
          <path d="M4.5 4.5 19.5 19.5M19.5 4.5 4.5 19.5" />
        </svg>
      )
    case "youtube":
      return (
        <svg {...common}>
          <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
          <path d="m10.2 9.3 4.6 2.7-4.6 2.7V9.3Z" />
        </svg>
      )
    case "tiktok":
      return (
        <svg {...common}>
          <path d="M13.5 3.5v11.2a3.3 3.3 0 1 1-3.3-3.3M13.5 3.5c.4 2.6 2.2 4.3 5 4.5" />
        </svg>
      )
    case "pinterest":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M10.6 20.5 12 14.4M10.2 13.3c-.9-3.2 1-5.8 3.6-5.8 2 0 3.3 1.4 3.3 3.3 0 2.7-1.6 4.7-3.6 4.7-1.1 0-1.9-.8-1.6-1.9" />
        </svg>
      )
    case "vimeo":
      return (
        <svg {...common}>
          <path d="M3.5 8.6c1.3-1 2.5-2.1 3.4-2.1 1.5 0 1.6 2.3 2.1 4.8.5 2.5.9 4.3 1.6 4.3 1.2 0 4.8-5.3 4.8-7.4 0-1.9-2.2-1.6-3.2-.9.7-2.8 3-4.2 5.1-3.7 2.1.5 2 3.1.9 5.5-1.6 3.4-5.8 9.4-8.4 9.4-2.3 0-2.8-5.3-3.9-8.4-.4-1.1-.9-1.3-1.7-.8" />
        </svg>
      )
    case "threads":
      return (
        <svg {...common}>
          <path d="M17.5 8.2C16.6 5.3 14.4 3.5 11.8 3.5 7.3 3.5 4.5 7 4.5 12s2.8 8.5 7.3 8.5c3.6 0 6.2-2.2 6.2-5.2 0-2.8-2.4-4.3-5.4-4.3-2.3 0-3.8 1.2-3.8 2.8 0 1.5 1.3 2.5 3 2.5 2.6 0 3.9-2.1 3.9-5.8" />
        </svg>
      )
    case "bluesky":
      return (
        <svg {...common}>
          <path d="M12 11.2C10.6 8.4 7.1 4.3 4.7 4.3c-1.7 0-1.4 3.6-.9 5.6.7 2.6 3.2 3.3 5.4 3-3.5.7-4.4 2.9-2.5 4.9 2.9 3 4.5-1 5.3-3.2.8 2.2 2.4 6.2 5.3 3.2 1.9-2 1-4.2-2.5-4.9 2.2.3 4.7-.4 5.4-3 .5-2 .8-5.6-.9-5.6-2.4 0-5.9 4.1-7.3 6.9Z" />
        </svg>
      )
    case "github":
      return (
        <svg {...common}>
          <path d="M9 19.5c-4 1.2-4-2-5.5-2.5M14.5 21v-3.2c0-1 .1-1.5-.5-2.1 2.7-.3 5.5-1.3 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.3 4.3 0 0 0-.1-3.2s-1-.3-3.3 1.3a11.3 11.3 0 0 0-6 0C6.5 3 5.5 3.3 5.5 3.3a4.3 4.3 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.7c0 4.7 2.8 5.7 5.5 6-.6.6-.6 1.2-.5 2.1V21" />
        </svg>
      )
    case "website":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" />
        </svg>
      )
  }
}
