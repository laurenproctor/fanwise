/**
 * Whether pasted text is really a whole HTML document.
 *
 * A creator who copies an artifact's code into the text box has handed over
 * markup, and reading it as prose would draft a listing about angle brackets.
 * Only a document that declares itself — a doctype or an `<html>` element at
 * the top — is re-read as HTML; a paragraph that mentions a tag stays text.
 */
export function isWholeHtmlDocument(text: string): boolean {
  return /^\s*(<!--[\s\S]*?-->\s*)*(<!doctype\s+html|<html[\s>])/i.test(text)
}
