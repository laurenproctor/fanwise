/**
 * Reading a page Fanwise did not write.
 *
 * **This parses and never renders.** There is no DOM, no `innerHTML`, no
 * `eval`, no iframe and no browser. The input is a bounded string and the
 * output is plain text and a list of URLs. Script, style, template, noscript,
 * svg, iframe, object and embed contents are cut out before anything is looked
 * for, so a `<script>` that happens to contain `<h1>` cannot contribute a
 * heading, and a page's own JavaScript is never anywhere near being run.
 *
 * **Written by hand rather than with a parser dependency**, and that is a
 * deliberate trade rather than a preference. What is wanted is narrow — a
 * title, a description, headings, list items, image URLs — the input is
 * hostile, and ADR 0009 spent a step on what a dependency in the build graph
 * costs. A real parser would be better at malformed markup; nothing here needs
 * to be right about malformed markup, it needs to be safe about it, and the
 * failure mode of this file is "found less", never "ran something".
 *
 * Every limit is a constant at the top. A page that exceeds one contributes
 * what it had up to that point rather than failing: a creator whose page has
 * four hundred list items wants the first forty, not an error.
 */

export const HTML_LIMITS = {
  /** The most markup to look at. Beyond this the read is refused, not truncated. */
  maxBytes: 2 * 1024 * 1024,
  /** The largest HTML file a creator may upload. Fetched pages keep `maxBytes`. */
  maxUploadBytes: Math.floor(4.8 * 1024 * 1024),
  /** How many headings and list items may become visible features. */
  maxFeatures: 40,
  maxFeatureLength: 300,
  /** How many image URLs to carry forward. */
  maxAssets: 12,
  maxTitleLength: 500,
  maxSummaryLength: 4000,
  /** The most `<script type="application/ld+json">` bytes to attempt to parse. */
  maxJsonLdBytes: 64 * 1024,
} as const

/** Elements whose contents are never text a reader sees. Cut before anything else. */
const OPAQUE_ELEMENTS = [
  "script",
  "style",
  "template",
  "noscript",
  "svg",
  "math",
  "iframe",
  "object",
  "embed",
  "canvas",
]

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  middot: "·",
  bull: "•",
  times: "×",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
}

/**
 * Entities, decoded once.
 *
 * Once is the important word. Decoding repeatedly until nothing changes turns
 * `&amp;lt;script&amp;gt;` into `<script>`, which is how a sanitizer becomes an
 * injector. A single pass leaves `&lt;` as the text `<`, which is what the page
 * meant, and React escapes it again on the way to the screen.
 */
export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code =
        body.startsWith("#x") || body.startsWith("#X")
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole
      // Surrogates are not characters; a lone one makes a string no JSON
      // column will hold.
      if (code >= 0xd800 && code <= 0xdfff) return whole
      try {
        return String.fromCodePoint(code)
      } catch {
        return whole
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole
  })
}

/**
 * Text a page showed, fit to be stored and rendered.
 *
 * Tags out, entities decoded once, control characters and bidirectional
 * overrides dropped, whitespace collapsed, length capped. The bidi characters
 * are worth naming: they reorder what a reader sees without changing what a
 * reviewer greps, which is exactly the trick for making a listing say one thing
 * to a person and another to a machine.
 */
/**
 * Characters that must never survive into stored text.
 *
 * Built with `new RegExp` from an ASCII source string rather than written as a
 * regex literal, and that is not a style choice. Written literally, a formatter
 * rewrites `\u0000` into the character it denotes, and the file then contains a
 * real NUL byte: git calls it binary, the diff becomes unreviewable, and the one
 * place in the codebase that decides what a stranger's text may contain is the
 * one place nobody can read. Doubling the backslash keeps the source ASCII and
 * the meaning identical.
 *
 * Two groups, for two different reasons:
 *
 *   - **C0 and C1 controls.** A NUL ends a string in anything that later hands
 *     it to C, and the rest are unprintable noise that no page meant to show.
 *   - **Zero-width and bidirectional overrides.** These reorder what a reader
 *     sees without changing what a reviewer greps, which is exactly the trick
 *     for making a listing say one thing to a person and another to a machine.
 */
const CONTROL_CHARACTERS = new RegExp(
  "[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f]",
  "g",
)

const INVISIBLE_CHARACTERS = new RegExp(
  "[\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069\\ufeff]",
  "g",
)

/**
 * Text a page showed, fit to be stored and rendered.
 *
 * Tags out, entities decoded once, control characters and bidirectional
 * overrides dropped, whitespace collapsed, length capped.
 */
export function sanitizeText(input: string, maxLength: number): string {
  const withoutTags = input.replace(/<[^>]*>/g, " ")
  const decoded = decodeEntities(withoutTags)
  return decoded
    .replace(CONTROL_CHARACTERS, "")
    .replace(INVISIBLE_CHARACTERS, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
    .trim()
}

/** The markup with every opaque element's contents removed. */
export function stripOpaqueElements(html: string): string {
  let out = html
  for (const tag of OPAQUE_ELEMENTS) {
    out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), " ")
    // An unclosed opaque element swallows the rest of the document, which is
    // the safe direction: better to find nothing than to read a script body.
    out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*$`, "i"), " ")
  }
  return out
}

/** One element's attributes, as a map, lower-cased names. */
function attributesOf(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(tag)) !== null) {
    const name = match[1]!.toLowerCase()
    const value = match[3] ?? match[4] ?? match[5] ?? ""
    if (!(name in attributes)) attributes[name] = decodeEntities(value)
  }
  return attributes
}

export interface MetaTag {
  key: string
  content: string
}

/** Every `<meta>`, keyed by whichever of name/property/itemprop it carried. */
export function readMetaTags(html: string): MetaTag[] {
  const tags: MetaTag[] = []
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = attributesOf(match[0])
    const key = attributes.property ?? attributes.name ?? attributes.itemprop
    const content = attributes.content
    if (!key || content === undefined) continue
    tags.push({ key: key.toLowerCase(), content })
  }
  return tags
}

export function metaValue(tags: readonly MetaTag[], ...keys: string[]): string | null {
  for (const key of keys) {
    const found = tags.find((tag) => tag.key === key)
    if (found && found.content.trim().length > 0) return found.content
  }
  return null
}

export function readTitle(html: string): string | null {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)
  if (!match) return null
  const text = sanitizeText(match[1] ?? "", HTML_LIMITS.maxTitleLength)
  return text.length > 0 ? text : null
}

export function readLanguage(html: string): string | null {
  const match = /<html\b[^>]*>/i.exec(html)
  if (!match) return null
  const lang = attributesOf(match[0]).lang
  if (!lang) return null
  const cleaned = lang.trim().slice(0, 35)
  return /^[a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*$/.test(cleaned) ? cleaned : null
}

/**
 * The headings and list items a page displays, in document order.
 *
 * Not "features". They are strings the page showed, and calling them features
 * anywhere but in the field name would be Fanwise deciding that a heading is a
 * claim about a product. Duplicates and one-word fragments are dropped because
 * navigation menus are made of them.
 */
export function readVisibleFeatures(html: string): string[] {
  const found: string[] = []
  const seen = new Set<string>()

  for (const match of html.matchAll(/<(h1|h2|h3|li)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)) {
    if (found.length >= HTML_LIMITS.maxFeatures) break
    const text = sanitizeText(match[2] ?? "", HTML_LIMITS.maxFeatureLength)
    if (text.length < 3) continue
    // A nested list produces the outer item's whole subtree; a run of items
    // joined by spaces is navigation, not a feature.
    if (text.split(" ").length < 2) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    found.push(text)
  }

  return found
}

export interface ReadAsset {
  url: string
  origin: "og" | "twitter" | "jsonld" | "dom"
}

/**
 * Image URLs the page advertised, best first.
 *
 * Open Graph and Twitter first because they are what the author chose for a
 * card; `<img>` after, in document order. Nothing is fetched here — these are
 * strings a stranger controls, and they are resolved and checked one at a time
 * by the asset fetcher against the same outbound boundary as the page itself.
 */
export function readAssets(
  html: string,
  tags: readonly MetaTag[],
  /**
   * The page's address, for resolving relative URLs. Null for markup a creator
   * handed over, which has no address: a relative URL then resolves to nothing
   * and is dropped, and only an absolute one is carried forward.
   */
  base: string | null,
): ReadAsset[] {
  const found: ReadAsset[] = []
  const seen = new Set<string>()

  const push = (raw: string | null, origin: ReadAsset["origin"]) => {
    if (!raw || found.length >= HTML_LIMITS.maxAssets) return
    let absolute: string
    try {
      absolute = (base === null ? new URL(raw.trim()) : new URL(raw.trim(), base)).toString()
    } catch {
      return
    }
    // data: and blob: are not fetchable and not ours; anything but http(s) is
    // refused here rather than later, where it would look like a network fault.
    if (!/^https?:\/\//i.test(absolute)) return
    if (absolute.length > 2048 || seen.has(absolute)) return
    seen.add(absolute)
    found.push({ url: absolute, origin })
  }

  push(metaValue(tags, "og:image", "og:image:url", "og:image:secure_url"), "og")
  push(metaValue(tags, "twitter:image", "twitter:image:src"), "twitter")

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    if (found.length >= HTML_LIMITS.maxAssets) break
    const attributes = attributesOf(match[0])
    push(attributes.src ?? attributes["data-src"] ?? null, "dom")
  }

  return found
}

export interface JsonLdFacts {
  name: string | null
  description: string | null
  images: string[]
}

/**
 * The structured description a page may carry, read before scripts are cut.
 *
 * `application/ld+json` lives inside a `<script>`, so this runs on the raw
 * markup, and it is the one place that looks inside one. What comes out is
 * parsed as JSON with a size cap and read for three fields; the graph is
 * walked one level, which is where `@graph` puts things, and no deeper.
 * Nothing is evaluated: `JSON.parse` is not `eval`, and a value that is not a
 * string is dropped rather than coerced.
 */
export function readJsonLd(html: string): JsonLdFacts {
  const facts: JsonLdFacts = { name: null, description: null, images: [] }

  for (const match of html.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi,
  )) {
    const body = match[1] ?? ""
    if (body.length > HTML_LIMITS.maxJsonLdBytes) continue

    let parsed: unknown
    try {
      parsed = JSON.parse(decodeEntities(body))
    } catch {
      continue
    }

    for (const node of flatten(parsed)) {
      if (typeof node !== "object" || node === null) continue
      const record = node as Record<string, unknown>
      if (!facts.name && typeof record.name === "string") {
        facts.name = sanitizeText(record.name, HTML_LIMITS.maxTitleLength) || null
      }
      if (!facts.description && typeof record.description === "string") {
        facts.description = sanitizeText(record.description, HTML_LIMITS.maxSummaryLength) || null
      }
      const image = record.image
      if (typeof image === "string") facts.images.push(image)
      else if (Array.isArray(image)) {
        for (const entry of image) if (typeof entry === "string") facts.images.push(entry)
      }
    }
  }

  facts.images = facts.images.slice(0, HTML_LIMITS.maxAssets)
  return facts
}

/** A JSON-LD document as a flat list of candidate nodes. One level of graph. */
function flatten(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(flatten)
  if (typeof value !== "object" || value === null) return []
  const record = value as Record<string, unknown>
  const graph = record["@graph"]
  return graph === undefined ? [record] : [record, ...flatten(graph)]
}

/**
 * The words a document shows, in reading order, one block per line.
 *
 * Opaque elements are gone before this runs, so a script body cannot become
 * prose. Block-level boundaries become line breaks, and the markup's own line
 * breaks do not, so a paragraph wrapped at eighty columns in the source stays
 * one paragraph. The boundary marker is a private-use character, removed from
 * the input first, so the document cannot forge one.
 */
const BLOCK_BREAK = String.fromCharCode(0xe000)

export function readVisibleText(html: string, maxLength: number): string {
  const marked = stripOpaqueElements(html.split(BLOCK_BREAK).join(""))
    .replace(/<head\b[\s\S]*?<\/head\s*>/gi, " ")
    .replace(
      /<(br|p|div|li|h[1-6]|tr|section|article|header|footer|blockquote|pre)\b[^>]*>|<\/(p|div|li|h[1-6]|tr|section|article|header|footer|blockquote|pre)\s*>/gi,
      BLOCK_BREAK,
    )
  return marked
    .split(BLOCK_BREAK)
    .map((block) => sanitizeText(block, maxLength))
    .filter((block) => block.length > 0)
    .join("\n")
    .slice(0, maxLength)
    .trim()
}
