/**
 * The browser half of the companion window: detecting it, and dressing the
 * window it opens.
 *
 * The companion is a Document Picture-in-Picture window, a small always-on-top
 * document owned by the page that opened it. docs/companion-window.md is the
 * plan and docs/decisions/0010 the constraints, the first of which is that
 * nothing here ever reads, writes or scripts a marketplace's page. Nothing in
 * this file has a way to: the only documents it touches are Fanwise's own and
 * the blank one the browser hands back.
 *
 * The TypeScript DOM library does not declare the API yet, so the two shapes
 * used are declared here, narrowly, rather than reached for through `any`.
 */

export interface CompanionWindowOptions {
  width: number
  height: number
}

export interface DocumentPictureInPicture {
  requestWindow(options: CompanionWindowOptions): Promise<Window>
}

type CompanionHost = Window & { documentPictureInPicture?: DocumentPictureInPicture }

/** The size it opens at. The site cannot position it, and does not try to. */
export const COMPANION_SIZE: CompanionWindowOptions = { width: 420, height: 720 }

/**
 * The API, where the browser has it. Feature detection only, never the user
 * agent: where this is null the pop-out is not offered at all, and the page is
 * the handoff. Invariant 8, one level down.
 */
export function companionApi(win: Window): DocumentPictureInPicture | null {
  return (win as CompanionHost).documentPictureInPicture ?? null
}

/** The attributes on <html> and <body> that carry the theme and the fonts. */
function copyRootAttributes(from: Document, to: Document) {
  to.documentElement.className = from.documentElement.className
  const theme = from.documentElement.dataset.theme
  if (theme === undefined) delete to.documentElement.dataset.theme
  else to.documentElement.dataset.theme = theme
  to.body.className = from.body.className
}

/**
 * Gives the new window the page's stylesheets, theme and fonts.
 *
 * The window arrives with an empty document, so without this the handoff
 * renders unstyled. Same-origin sheets are copied as their rules, which covers
 * both the linked sheets of a production build and the injected ones of a dev
 * server. A sheet whose rules cannot be read is cloned as its <link>. Inline
 * styles are admitted by ADR 0007's `style-src`, and the window inherits that
 * policy from the page that opened it.
 */
export function dressCompanionDocument(from: Document, to: Document, title: string) {
  to.title = title

  for (const sheet of Array.from(from.styleSheets)) {
    try {
      const style = to.createElement("style")
      style.textContent = Array.from(sheet.cssRules)
        .map((rule) => rule.cssText)
        .join("\n")
      to.head.appendChild(style)
    } catch {
      const owner = sheet.ownerNode
      if (owner && owner.nodeName === "LINK") {
        to.head.appendChild(to.importNode(owner, true))
      }
    }
  }

  copyRootAttributes(from, to)
}

/**
 * Keeps the window's theme in step with the page's while it is open, so a
 * theme toggled in the page does not leave the companion in the other one.
 * Returns the function that stops watching.
 */
export function followTheme(from: Document, to: Document): () => void {
  const observer = new MutationObserver(() => copyRootAttributes(from, to))
  observer.observe(from.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-theme"],
  })
  return () => observer.disconnect()
}
