"use client"

import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { Markdown } from "@tiptap/markdown"

/**
 * One description, three ways to edit it.
 *
 * The value is always Markdown, because that is what the record stores (see
 * lib/text/markdown.ts). The three tabs are views over it:
 *
 *   - **Visual** is a rich-text editor. What it can express is exactly what the
 *     storefront sanitizer lets through: paragraphs, headings, bold,
 *     italic, strikethrough, lists, quotes, code and links. Nothing it produces
 *     is later stripped, which is the point of keeping the two lists the same.
 *   - **Markdown** is the text itself.
 *   - **HTML** shows the editor's HTML, and HTML typed or pasted there is read
 *     back through the editor's schema. Anything outside it — a script, a style,
 *     an iframe — simply has nowhere to go and is dropped, before it is ever
 *     Markdown, let alone stored.
 *
 * The visual editor stays mounted behind the text tabs, because it is also the
 * converter between them.
 *
 * ## Forms
 *
 * Controlled with `value` and `onChange`, or uncontrolled with `defaultValue`
 * inside a form that reads `FormData`. Either way a hidden textarea carries the
 * Markdown under `name`, and every change dispatches a bubbling `input` event
 * from it, so a form that autosaves on input sees an edit here the same way it
 * sees one in any other field.
 */

type Mode = "visual" | "markdown" | "html"

const MODES: ReadonlyArray<{ key: Mode; label: string }> = [
  { key: "visual", label: "Visual" },
  { key: "markdown", label: "Markdown" },
  { key: "html", label: "HTML" },
]

const surfaceClass =
  "w-full rounded-b-[10px] border border-t-0 border-[var(--color-rule)] bg-[var(--color-card)] px-3 py-2.5 text-[15px] text-[var(--color-ink)] outline-none focus-within:border-[var(--color-accent)]"

export interface MarkdownEditorProps {
  id: string
  name: string
  /**
   * The field's label. Omitted when the caller renders its own label line,
   * pointed at `id`, with anything else it wants beside it.
   */
  label?: ReactNode
  value?: string
  defaultValue?: string
  onChange?: (markdown: string) => void
  /** Roughly how tall the editor is, in lines of text. */
  rows?: number
  describedBy?: string
  /**
   * The accessible name of the editing surface. Defaults to `label` when that
   * is a string. A `<label for>` cannot name a contenteditable, so this is how
   * "Description" reaches assistive technology and a test's `getByLabel`.
   */
  ariaLabel?: string
  /** Rendered on the label line, right-aligned: counters, buttons. */
  aside?: ReactNode
}

export function MarkdownEditor({
  id,
  name,
  label,
  value,
  defaultValue = "",
  onChange,
  rows = 8,
  describedBy,
  ariaLabel,
  aside,
}: MarkdownEditorProps) {
  const accessibleName = ariaLabel ?? (typeof label === "string" ? label : undefined)
  const controlled = value !== undefined
  const [markdown, setMarkdown] = useState(controlled ? value : defaultValue)
  const [mode, setMode] = useState<Mode>("visual")
  const [htmlDraft, setHtmlDraft] = useState("")
  const hiddenRef = useRef<HTMLTextAreaElement>(null)
  // The last Markdown this component produced, so a controlled value coming
  // back round is recognized as our own and not re-parsed into the editor,
  // which would move the caret while someone types.
  const emitted = useRef(markdown)
  const tabsId = useId()

  function emit(next: string) {
    if (next === emitted.current) return
    emitted.current = next
    setMarkdown(next)
    onChange?.(next)
    const hidden = hiddenRef.current
    if (hidden) {
      hidden.value = next
      hidden.dispatchEvent(new Event("input", { bubbles: true }))
    }
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // One is accepted so a pasted or typed top-level heading survives as a
        // heading; the sanitizer renders it a level down on every page.
        heading: { levels: [1, 2, 3, 4] },
        // Underline has no Markdown and no place on a storefront.
        underline: false,
        link: {
          openOnClick: false,
          autolink: true,
          protocols: ["mailto"],
          isAllowedUri: (url) => /^(https?:|mailto:)/i.test(url),
          HTMLAttributes: { rel: null, target: null },
        },
      }),
      // Breaks as the rest of Fanwise reads them: a single newline is a line.
      Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
    ],
    content: markdown,
    contentType: "markdown",
    // Rendered on the client only; the server has no DOM to render into.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        id,
        class: "fanwise-prose min-h-full outline-none",
        role: "textbox",
        "aria-multiline": "true",
        ...(accessibleName ? { "aria-label": accessibleName } : {}),
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
      },
    },
    onUpdate: ({ editor: current }) => emit(normalize(current.getMarkdown())),
  })

  // A controlled value replaced from outside — a regeneration, "Use canonical".
  useEffect(() => {
    if (!controlled || value === emitted.current) return
    emitted.current = value
    setMarkdown(value)
    editor?.commands.setContent(value, { contentType: "markdown", emitUpdate: false })
  }, [controlled, value, editor])

  function switchTo(next: Mode) {
    if (next === mode || !editor) return
    if (mode === "markdown") {
      editor.commands.setContent(markdown, { contentType: "markdown", emitUpdate: false })
    }
    if (mode === "html") applyHtml(htmlDraft)
    if (next === "html") setHtmlDraft(editor.getHTML())
    setMode(next)
  }

  function applyHtml(html: string) {
    if (!editor) return
    editor.commands.setContent(html, { contentType: "html", emitUpdate: false })
    emit(normalize(editor.getMarkdown()))
  }

  const minHeight = `${rows * 1.6}em`

  return (
    <div className="flex flex-col gap-2">
      {label || aside ? (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          {label ? (
            <label htmlFor={mode === "visual" ? id : `${id}-${mode}`} className="label-mono">
              {label}
            </label>
          ) : (
            <span />
          )}
          {aside ? <div className="flex flex-wrap items-center gap-2">{aside}</div> : null}
        </div>
      ) : null}

      <div>
        <div
          role="tablist"
          aria-label="Editing mode"
          className="flex flex-wrap items-center justify-between gap-2 rounded-t-[10px] border border-[var(--color-rule)] bg-[var(--color-paper-2)] px-2 py-1.5"
        >
          <div className="flex items-center gap-1">
            {MODES.map((entry) => (
              <button
                key={entry.key}
                type="button"
                role="tab"
                id={`${tabsId}-${entry.key}`}
                aria-selected={mode === entry.key}
                onClick={() => switchTo(entry.key)}
                className={`rounded-[6px] px-2.5 py-1 text-[13px] ${
                  mode === entry.key
                    ? "bg-[var(--color-card)] text-[var(--color-ink)] shadow-[0_0_0_1px_var(--color-rule)]"
                    : "text-[var(--color-ink-2)] hover:text-[var(--color-ink)]"
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>
          {mode === "visual" && editor ? <Toolbar editor={editor} /> : null}
        </div>

        <div hidden={mode !== "visual"} className={surfaceClass} style={{ minHeight }}>
          <EditorContent editor={editor} />
        </div>

        {mode === "markdown" ? (
          <textarea
            id={`${id}-markdown`}
            aria-label={accessibleName ? `${accessibleName} (Markdown)` : undefined}
            aria-describedby={describedBy}
            value={markdown}
            onChange={(event) => emit(event.target.value)}
            spellCheck
            className={`${surfaceClass} font-mono text-[14px]`}
            style={{ minHeight }}
          />
        ) : null}

        {mode === "html" ? (
          <textarea
            id={`${id}-html`}
            aria-label={accessibleName ? `${accessibleName} (HTML)` : undefined}
            aria-describedby={describedBy}
            value={htmlDraft}
            onChange={(event) => setHtmlDraft(event.target.value)}
            onBlur={() => applyHtml(htmlDraft)}
            spellCheck={false}
            className={`${surfaceClass} font-mono text-[13px]`}
            style={{ minHeight }}
          />
        ) : null}
      </div>

      <textarea ref={hiddenRef} name={name} value={markdown} readOnly hidden aria-hidden />
    </div>
  )
}

/** The editor's Markdown, with the trailing whitespace it adds removed. */
function normalize(markdown: string): string {
  return markdown.replace(/\s+$/, "")
}

function Toolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      quote: e.isActive("blockquote"),
      link: e.isActive("link"),
      href: (e.getAttributes("link").href as string | undefined) ?? "",
    }),
  })
  const [linking, setLinking] = useState(false)
  const [href, setHref] = useState("")

  function openLink() {
    setHref(state.href)
    setLinking(true)
  }

  function applyLink() {
    const url = href.trim()
    const chain = editor.chain().focus().extendMarkRange("link")
    if (url === "") chain.unsetLink().run()
    else if (/^(https?:|mailto:)/i.test(url)) chain.setLink({ href: url }).run()
    setLinking(false)
  }

  if (linking) {
    return (
      <div className="flex items-center gap-1">
        <input
          type="url"
          aria-label="Link address"
          placeholder="https://"
          value={href}
          autoFocus
          onChange={(event) => setHref(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              applyLink()
            }
            if (event.key === "Escape") setLinking(false)
          }}
          className="w-44 rounded-[6px] border border-[var(--color-rule)] bg-[var(--color-card)] px-2 py-1 text-[13px] outline-none focus:border-[var(--color-accent)]"
        />
        <ToolButton label="Apply link" onClick={applyLink}>
          Apply
        </ToolButton>
        <ToolButton label="Cancel" onClick={() => setLinking(false)}>
          Cancel
        </ToolButton>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-0.5" aria-label="Formatting">
      <ToolButton
        label="Bold"
        active={state.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <strong>B</strong>
      </ToolButton>
      <ToolButton
        label="Italic"
        active={state.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <em>I</em>
      </ToolButton>
      <ToolButton
        label="Heading"
        active={state.h2}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        H2
      </ToolButton>
      <ToolButton
        label="Subheading"
        active={state.h3}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        H3
      </ToolButton>
      <ToolButton
        label="Bulleted list"
        active={state.bullet}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        • List
      </ToolButton>
      <ToolButton
        label="Numbered list"
        active={state.ordered}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        1. List
      </ToolButton>
      <ToolButton
        label="Quote"
        active={state.quote}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        Quote
      </ToolButton>
      <ToolButton label="Link" active={state.link} onClick={openLink}>
        Link
      </ToolButton>
    </div>
  )
}

function ToolButton({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      // Keeps the selection in the editor while the button is pressed.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`min-w-7 rounded-[6px] px-1.5 py-1 text-[13px] ${
        active
          ? "bg-[var(--color-card)] text-[var(--color-ink)] shadow-[0_0_0_1px_var(--color-rule)]"
          : "text-[var(--color-ink-2)] hover:bg-[var(--color-card)] hover:text-[var(--color-ink)]"
      }`}
    >
      {children}
    </button>
  )
}
