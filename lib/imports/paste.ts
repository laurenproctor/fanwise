/**
 * Whether pasted text is really a whole HTML document.
 *
 * A creator who copies an artifact's code into the text box has handed over
 * markup, and reading it as prose would draft a listing about angle brackets.
 * Only a document that declares itself — a doctype or an `<html>` element at
 * the top, after any comments — is re-read as HTML; a paragraph that mentions
 * a tag stays text.
 *
 * A scan rather than one regular expression. The obvious pattern, a repeated
 * group of lazy comments, backtracks exponentially on a paste made of
 * `--><!--` over and over, and this runs inside a server action on whatever a
 * browser sent. Each step here moves forward, so the cost is linear.
 */
export function isWholeHtmlDocument(text: string): boolean {
  let position = 0
  for (;;) {
    while (position < text.length && /\s/.test(text[position]!)) position += 1
    if (!text.startsWith("<!--", position)) break
    const end = text.indexOf("-->", position + 4)
    if (end === -1) return false
    position = end + 3
  }
  return /^(<!doctype\s+html|<html[\s>])/i.test(text.slice(position, position + 32))
}
