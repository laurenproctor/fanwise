import { HTML_LIMITS, sanitizeText } from "./html"

/**
 * Reading text a creator handed over: pasted words, or the words of a document.
 *
 * The same discipline as `html.ts` — bounded input, plain text out, nothing
 * evaluated — applied to text that has lines instead of tags. What is wanted is
 * the same four things a page gives: a title, a summary, the short lines a
 * reader would scan, and the running text a draft is written from.
 *
 * **A guess about structure is only ever a guess about structure.** The first
 * line is offered as a title because that is where people put titles, and the
 * screen says it was read from the document's text. It is never a claim about
 * the product, and a line that looks like code is not offered at all, because
 * `import React from "react"` is not anybody's product name.
 */

export const TEXT_LIMITS = {
  /** The most characters of body text carried into evidence and the prompt. */
  maxBodyLength: 20_000,
  /** A first line longer than this is a paragraph, not a title. */
  maxTitleLength: 150,
  minSummaryLength: 20,
} as const

export interface TextReading {
  title: string | null
  summary: string | null
  features: string[]
  body: string | null
}

const BULLET = /^(?:[-*•+▪◦‣]|\d{1,3}[.)])\s+/
const HEADING = /^#{1,6}\s+/

/**
 * Whether a line is source code rather than prose.
 *
 * Deliberately narrow and deliberately about the line's shape. Pasting an
 * artifact's code is a supported thing to do, and its first line is almost
 * always an import or a doctype; offering that as a title would put a module
 * specifier in the title field with an "observed" marker beside it.
 */
export function looksLikeCode(line: string): boolean {
  const trimmed = line.trim()
  if (/^(import|export|const|let|var|function|class|return|if|for|while)\b/.test(trimmed)) {
    return true
  }
  if (
    /^(<[!?/a-zA-Z]|\/\/|\/\*|\*\/|#include|def |from \S+ import|package |using |@)/.test(trimmed)
  ) {
    return true
  }
  return /[{};]$/.test(trimmed) || /=>|===|!==|\)\s*\{/.test(trimmed)
}

/** True when most of the non-empty lines are code, so the whole text is. */
export function isMostlyCode(lines: readonly string[]): boolean {
  const meaningful = lines.filter((line) => line.trim().length > 0).slice(0, 200)
  if (meaningful.length === 0) return false
  const code = meaningful.filter(looksLikeCode).length
  return code / meaningful.length >= 0.4
}

/**
 * Whether a line reads as running prose rather than a label.
 *
 * Three or more words of two letters or more, mostly lower case, and not
 * shattered into single letters. "GLYPHS", "THIN · 100", "OTF TTF VF" and a
 * kerned-apart "W ORD M AR K STORE FRONT" are labels; "A wide display face
 * that lives between two worlds" is prose.
 */
export function isProseLine(line: string): boolean {
  const tokens = line.split(/\s+/).filter((token) => token.length > 0)
  const words = tokens.filter((token) => /\p{L}{2,}/u.test(token))
  if (words.length < 3) return false
  const singles = tokens.filter((token) => /^\p{L}$/u.test(token)).length
  if (singles / tokens.length > 0.3) return false
  const letters = line.match(/\p{L}/gu) ?? []
  const lower = line.match(/\p{Ll}/gu) ?? []
  return lower.length / letters.length >= 0.5
}

/** A short line that ends the sentence the previous line left open. */
function finishesSentence(previous: string, line: string): boolean {
  return (
    !/[.!?:;]["'”’)\]]?$/.test(previous) &&
    /\p{Ll}/u.test(line) &&
    /[.!?]["'”’)\]]?$/.test(line) &&
    line.split(/\s+/).length <= 3
  )
}

/** Lines with their markup markers removed and their contents made safe. */
function cleanLine(raw: string): string {
  return sanitizeText(raw.replace(HEADING, "").replace(BULLET, ""), HTML_LIMITS.maxFeatureLength)
}

/**
 * One text, read.
 *
 * `raw` may be anything: a pasted essay, a markdown file, a page's worth of
 * code, the text layer of a PDF. Every value that comes out has been through
 * `sanitizeText`, so control characters and bidirectional overrides are gone
 * before anything is stored, exactly as for a page.
 */
export function readPlainText(raw: string): TextReading {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n")
  const body = lines
    .map((line) => sanitizeText(line, TEXT_LIMITS.maxBodyLength))
    .filter((line) => line.length > 0)
    .join("\n")
    .slice(0, TEXT_LIMITS.maxBodyLength)
    .trim()

  if (body.length === 0) return { title: null, summary: null, features: [], body: null }

  // Code has no title line and no summary paragraph worth offering. The body is
  // still carried, so a draft can be written from what the code displays.
  if (isMostlyCode(lines)) return { title: null, summary: null, features: [], body }

  const nonEmpty = lines.map((line) => line.trim()).filter((line) => line.length > 0)

  const first = nonEmpty[0] ?? ""
  const firstClean = cleanLine(first)
  const title =
    firstClean.length >= 3 &&
    firstClean.length <= TEXT_LIMITS.maxTitleLength &&
    !looksLikeCode(first) &&
    !BULLET.test(first)
      ? firstClean
      : null

  /*
    The first run of prose lines after the title, joined: a paragraph.

    Labels before it are passed over — a PDF of a web page opens with its
    navigation, eyebrows and figures, one short line each — and the run ends at
    a blank line, a heading, a bullet or the next label, so the summary is one
    paragraph rather than the whole document up to the length cap. A wrapped
    paragraph's last visual line is often a word or two ("lowercase."), and is
    kept when it finishes the sentence the line before it left open.
  */
  const trimmed = lines.map((line) => line.trim())
  const titleIndex = title ? trimmed.findIndex((line) => line.length > 0) : -1
  const paragraph: string[] = []
  for (const line of trimmed.slice(titleIndex + 1)) {
    if (line.length === 0 || HEADING.test(line) || BULLET.test(line)) {
      if (paragraph.length > 0) break
      continue
    }
    if (isProseLine(line)) {
      paragraph.push(line)
    } else if (paragraph.length > 0) {
      if (finishesSentence(paragraph[paragraph.length - 1]!, line)) paragraph.push(line)
      break
    }
    if (paragraph.join(" ").length >= HTML_LIMITS.maxSummaryLength) break
  }
  const joined = sanitizeText(paragraph.join(" "), HTML_LIMITS.maxSummaryLength)
  const summary = joined.length >= TEXT_LIMITS.minSummaryLength ? joined : null

  const features: string[] = []
  const seen = new Set<string>()
  for (const line of nonEmpty) {
    if (features.length >= HTML_LIMITS.maxFeatures) break
    if (!HEADING.test(line) && !BULLET.test(line)) continue
    const text = cleanLine(line)
    // Same rule as a page's list items: a one-word fragment is navigation.
    if (text.length < 3 || text.split(" ").length < 2) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    features.push(text)
  }

  return { title, summary, features, body }
}
