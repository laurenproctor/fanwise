import type { FontClassification, FontLicenseKind } from "@/lib/products/metadata"

/** Human words for the font enums. The screen never renders a raw value. */

export const FONT_CLASSIFICATION_LABELS: Record<FontClassification, string> = {
  sans_serif: "Sans serif",
  serif: "Serif",
  slab_serif: "Slab serif",
  display: "Display",
  script: "Script",
  handwritten: "Handwritten",
  monospace: "Monospace",
  blackletter: "Blackletter",
  decorative: "Decorative",
}

export const FONT_LICENSE_LABELS: Record<FontLicenseKind, { name: string; description: string }> = {
  desktop: {
    name: "Desktop license",
    description: "Install on computers to make graphics, documents and print.",
  },
  web: {
    name: "Webfont license",
    description: "Embed on websites with @font-face, limited by monthly pageviews.",
  },
  app: {
    name: "App license",
    description: "Embed inside a mobile or desktop application.",
  },
  epub: {
    name: "ePub license",
    description: "Embed inside electronic publications and ebooks.",
  },
}
