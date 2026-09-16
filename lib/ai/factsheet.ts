import { createHash } from "node:crypto"
import { PRODUCT_TYPE_LABELS, type Product, type ProductAsset } from "@/lib/products/types"
import { parseMetadata, type ProductMetadata } from "@/lib/products/metadata"
import { featureLabel } from "@/lib/fonts/coverage"
import { WEIGHT_NAMES, WIDTH_NAMES } from "@/lib/fonts/detected"
import { FONT_CLASSIFICATION_LABELS, FONT_LICENSE_LABELS } from "@/lib/fonts/labels"

/**
 * The FactSheet: the typed, derived set of facts a model is allowed to state.
 *
 * Derived deterministically from the canonical product, its metadata and its
 * ready assets, and from nothing else. It is the only factual content the
 * prompt receives, and it is what the factuality validator checks the answer
 * against, so the two halves of docs/ai-merchandising.md's rule meet here: a
 * fact absent from this structure cannot be stated, and a fact present in it
 * can be stated in any words.
 *
 * Every field is optional except identity, because a product early in its life
 * has few facts and that is the truth the model should be given rather than a
 * placeholder it might repeat.
 */

export interface FactSheet {
  name: string
  title: string
  productType: string
  description: string | null
  shortDescription: string | null
  brand: string | null
  price: { amount: number; currency: string } | null
  version: string | null
  licenseSummary: string | null
  supportUrl: string | null
  documentationUrl: string | null
  /** Product-type facts, straight from the validated metadata union. */
  details: FactDetails
  /** What a buyer receives, measured from the ready deliverable assets. */
  files: {
    deliverableCount: number
    /** Lowercase extensions, deduplicated, in first-seen order. */
    formats: string[]
  }
  imageCount: number
}

export type FactDetails =
  | {
      kind: "font"
      styleCount?: number
      isVariable?: boolean
      formats?: string[]
      languageSupport?: string[]
      glyphCount?: number
      /** In words, "Sans serif", never the enum value. */
      classification?: string
      styles?: FontStyleFact[]
      axes?: FontAxisFact[]
      /** Writing systems, as the creator confirmed them. */
      scripts?: string[]
      /** OpenType feature tags, lowercase. Rendered in words beside the tag. */
      features?: string[]
      /** The license types sold, by name. Prices and limits are not stated here. */
      licenses?: string[]
      /** The creator's own search keywords for the product. */
      keywords?: string[]
    }
  | { kind: "template"; software?: string[]; pageCount?: number; dimensions?: string }
  | { kind: "raster"; fileFormats?: string[]; dpi?: number; itemCount?: number }
  | { kind: "generic"; notes?: string }

export interface FontStyleFact {
  name: string
  weight?: number
  /** OS/2 width class, 1 to 9. */
  width?: number
  italic?: boolean
}

export interface FontAxisFact {
  tag: string
  name?: string
  min: number
  default: number
  max: number
}

/** The registered axes, named the way a buyer would say them. */
const REGISTERED_AXIS_NAMES: Record<string, string> = {
  wght: "Weight",
  wdth: "Width",
  ital: "Italic",
  slnt: "Slant",
  opsz: "Optical size",
}

/** The weight name a style's numeric weight rounds to, or null off the scale. */
export function weightName(weight: number): string | null {
  return WEIGHT_NAMES[Math.round(weight / 100) * 100] ?? null
}

/** Distinct named weights across the styles, lightest first. */
export function distinctWeights(styles: readonly FontStyleFact[]): string[] {
  const weights = [...new Set(styles.flatMap((s) => (s.weight === undefined ? [] : [s.weight])))]
  weights.sort((a, b) => a - b)
  return [...new Set(weights.flatMap((w) => weightName(w) ?? []))]
}

/** How many stylistic sets the feature list names (ss01 to ss20). */
export function stylisticSetCount(features: readonly string[]): number {
  return features.filter((tag) => /^ss\d\d$/.test(tag)).length
}

export function axisName(axis: FontAxisFact): string {
  return blank(axis.name) ?? REGISTERED_AXIS_NAMES[axis.tag] ?? axis.tag
}

function blank(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function extensionOf(filename: string): string | null {
  const match = /\.([a-z0-9]{1,8})$/i.exec(filename.trim())
  return match ? match[1]!.toLowerCase() : null
}

function details(metadata: ProductMetadata): FactDetails {
  switch (metadata.kind) {
    case "font":
      return {
        kind: "font",
        ...(metadata.styleCount !== undefined ? { styleCount: metadata.styleCount } : {}),
        ...(metadata.isVariable !== undefined ? { isVariable: metadata.isVariable } : {}),
        ...(metadata.formats?.length ? { formats: [...metadata.formats] } : {}),
        ...(metadata.languageSupport?.length
          ? { languageSupport: [...metadata.languageSupport] }
          : {}),
        ...(metadata.glyphCount !== undefined ? { glyphCount: metadata.glyphCount } : {}),
        ...(metadata.classification
          ? { classification: FONT_CLASSIFICATION_LABELS[metadata.classification] }
          : {}),
        ...(metadata.styles?.length
          ? {
              styles: metadata.styles.map((style) => ({
                name: style.name,
                ...(style.weight !== undefined ? { weight: style.weight } : {}),
                ...(style.width !== undefined ? { width: style.width } : {}),
                ...(style.italic !== undefined ? { italic: style.italic } : {}),
              })),
            }
          : {}),
        ...(metadata.axes?.length
          ? {
              axes: metadata.axes.map((axis) => ({
                tag: axis.tag,
                ...(blank(axis.name) ? { name: axis.name!.trim() } : {}),
                min: axis.min,
                default: axis.default,
                max: axis.max,
              })),
            }
          : {}),
        ...(metadata.scripts?.length ? { scripts: [...metadata.scripts] } : {}),
        ...(metadata.features?.length
          ? { features: [...new Set(metadata.features.map((tag) => tag.toLowerCase()))] }
          : {}),
        ...(metadata.licenses?.length
          ? { licenses: metadata.licenses.map((license) => FONT_LICENSE_LABELS[license.kind].name) }
          : {}),
        ...(metadata.tags?.length ? { keywords: [...metadata.tags] } : {}),
      }
    case "template":
      return {
        kind: "template",
        ...(metadata.software?.length ? { software: [...metadata.software] } : {}),
        ...(metadata.pageCount !== undefined ? { pageCount: metadata.pageCount } : {}),
        ...(blank(metadata.dimensions) ? { dimensions: metadata.dimensions!.trim() } : {}),
      }
    case "raster":
      return {
        kind: "raster",
        ...(metadata.fileFormats?.length ? { fileFormats: [...metadata.fileFormats] } : {}),
        ...(metadata.dpi !== undefined ? { dpi: metadata.dpi } : {}),
        ...(metadata.itemCount !== undefined ? { itemCount: metadata.itemCount } : {}),
      }
    case "generic":
      return {
        kind: "generic",
        ...(blank(metadata.notes) ? { notes: metadata.notes!.trim() } : {}),
      }
  }
}

export function buildFactSheet(product: Product, assets: readonly ProductAsset[]): FactSheet {
  const ready = assets.filter((asset) => asset.asset_state === "ready")
  const deliverables = ready.filter(
    (asset) => asset.asset_type === "deliverable" || asset.asset_type === "archive",
  )
  const formats: string[] = []
  for (const asset of deliverables) {
    const ext = extensionOf(asset.filename)
    if (ext && !formats.includes(ext)) formats.push(ext)
  }
  const images = ready.filter(
    (asset) =>
      asset.derived_from === null &&
      (asset.asset_type === "cover_image" || asset.asset_type === "preview_image"),
  )

  const price =
    product.base_price === null || product.base_price === undefined
      ? null
      : Number.isFinite(Number(product.base_price))
        ? { amount: Number(product.base_price), currency: product.currency }
        : null

  return {
    name: product.name,
    title: blank(product.canonical_title) ?? product.name,
    productType: PRODUCT_TYPE_LABELS[product.product_type],
    description: blank(product.canonical_description),
    shortDescription: blank(product.short_description),
    brand: blank(product.brand_name),
    price,
    version: blank(product.version),
    licenseSummary: blank(product.license_summary),
    supportUrl: blank(product.support_url),
    documentationUrl: blank(product.documentation_url),
    details: details(parseMetadata(product.metadata)),
    files: { deliverableCount: deliverables.length, formats },
    imageCount: images.length,
  }
}

/**
 * Stable serialization: keys sorted at every depth, so two FactSheets with the
 * same facts hash the same whatever order they were built in.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key]
      if (v !== undefined) out[key] = sortKeys(v)
    }
    return out
  }
  return value
}

/** SHA-256 of the canonical form, written to every ai_generations row. */
export function factSheetHash(sheet: FactSheet): string {
  return createHash("sha256").update(canonicalJson(sheet)).digest("hex")
}

function describeStyle(style: FontStyleFact): string {
  const parts: string[] = []
  if (style.weight !== undefined) {
    const name = weightName(style.weight)
    parts.push(name ? `weight ${style.weight}, ${name}` : `weight ${style.weight}`)
  }
  if (style.width !== undefined && WIDTH_NAMES[style.width]) {
    parts.push(`${WIDTH_NAMES[style.width]!.toLowerCase()} width`)
  }
  if (style.italic === true) parts.push("italic")
  return parts.length > 0 ? `${style.name} (${parts.join("; ")})` : style.name
}

/**
 * The FactSheet as the prompt carries it.
 *
 * Plain labelled lines rather than JSON: a model reads "Styles: 9" more
 * reliably than it reads nested braces, and the validator does not care which
 * form was sent because it checks against the structure, not the text. Fields
 * with no value are omitted rather than printed as "unknown", because a line
 * that says unknown is a line the model may try to fill in.
 */
export function renderFactSheet(sheet: FactSheet): string {
  const lines: string[] = []
  const add = (label: string, value: string | number | null | undefined) => {
    if (value === null || value === undefined || value === "") return
    lines.push(`${label}: ${value}`)
  }
  const list = (label: string, values: readonly string[] | undefined) => {
    if (values && values.length > 0) lines.push(`${label}: ${values.join(", ")}`)
  }

  add("Product name", sheet.name)
  add("Title", sheet.title)
  add("Product type", sheet.productType)
  add("Brand", sheet.brand)
  if (sheet.price) add("Price", `${sheet.price.amount} ${sheet.price.currency}`)
  add("Version", sheet.version)
  add("License", sheet.licenseSummary)
  add("Support URL", sheet.supportUrl)
  add("Documentation URL", sheet.documentationUrl)

  const d = sheet.details
  switch (d.kind) {
    case "font":
      add("Styles included", d.styleCount)
      if (d.isVariable !== undefined) add("Variable font", d.isVariable ? "yes" : "no")
      list("Font formats", d.formats)
      list("Language support", d.languageSupport)
      add("Glyph count", d.glyphCount)
      add("Classification", d.classification)
      if (d.styles) {
        const weights = distinctWeights(d.styles)
        if (weights.length > 0) {
          add("Weights", `${weights.length} (${weights.join(", ")})`)
        }
        const italics = d.styles.filter((style) => style.italic === true).length
        if (italics > 0) add("Italic styles", italics)
        const widths = [
          ...new Set(d.styles.flatMap((style) => (style.width ? [WIDTH_NAMES[style.width]!] : []))),
        ]
        if (widths.length > 0) list("Widths", widths)
        lines.push("Styles:")
        for (const style of d.styles) lines.push(`- ${describeStyle(style)}`)
      }
      if (d.axes) {
        lines.push("Variable axes:")
        for (const axis of d.axes) {
          lines.push(
            `- ${axisName(axis)} (${axis.tag}): ${axis.min} to ${axis.max}, default ${axis.default}`,
          )
        }
      }
      list("Writing systems", d.scripts)
      if (d.features) {
        const sets = stylisticSetCount(d.features)
        if (sets > 0) add("Stylistic sets", sets)
        list(
          "OpenType features",
          d.features.map((tag) => {
            const label = featureLabel(tag)
            return label === tag ? tag : `${label} (${tag})`
          }),
        )
      }
      list("License types sold", d.licenses)
      list("Creator's search keywords", d.keywords)
      break
    case "template":
      list("Software", d.software)
      add("Page count", d.pageCount)
      add("Dimensions", d.dimensions)
      break
    case "raster":
      list("File formats", d.fileFormats)
      add("Resolution (DPI)", d.dpi)
      add("Items included", d.itemCount)
      break
    case "generic":
      add("Notes", d.notes)
      break
  }

  add("Deliverable files", sheet.files.deliverableCount)
  list("Deliverable formats", sheet.files.formats)
  add("Images", sheet.imageCount)

  if (sheet.shortDescription) {
    lines.push("", "Creator's short description:", sheet.shortDescription)
  }
  if (sheet.description) {
    lines.push("", "Creator's description:", sheet.description)
  }

  return lines.join("\n")
}
