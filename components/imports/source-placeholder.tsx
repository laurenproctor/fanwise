/**
 * The left column before a link has been read.
 *
 * It says what will happen and what will never happen, in that order. The
 * second half is not marketing: a creator being asked to paste a link to
 * something they own is entitled to know, before they paste it, that Fanwise
 * will not ask for a password to it, will not keep a session for it, and will
 * not run a line of what it downloads.
 */
const STEPS = {
  link: [
    "Fanwise opens the link from its own servers, signed out, the way any visitor would.",
    "It reads the title, the description and the pictures the page offers.",
    "It fills in a draft listing you can edit, marking what it read and what it worked out.",
  ],
  content: [
    "Fanwise keeps what you hand it privately, in your workspace, and reads it on its own servers.",
    "It reads the title, the opening and the text — never the scripts, forms or attachments inside.",
    "It fills in a draft listing you can edit, marking what it read and what it worked out.",
  ],
} as const

const NEVER = {
  link: [
    "Ask for your password, or keep a cookie or session for another service.",
    "Run, unpack or preview code it downloads.",
    "Publish anything. A link creates a draft, and nothing else.",
  ],
  content: [
    "Run, render or execute anything you paste or upload.",
    "Show your file to buyers or offer it for download. It is a source, not a deliverable.",
    "Publish anything. An import creates a draft, and nothing else.",
  ],
} as const

export function SourcePlaceholder({ mode = "link" }: { mode?: "link" | "content" }) {
  return (
    <section
      aria-labelledby="import-placeholder-heading"
      className="flex flex-col gap-5 rounded-[16px] border border-dashed border-[var(--color-rule)] bg-[var(--color-card)] px-6 py-8"
    >
      <h2 id="import-placeholder-heading" className="label-mono">
        What happens next
      </h2>

      <ol className="flex flex-col gap-3">
        {STEPS[mode].map((line, index) => (
          <li key={line} className="flex items-start gap-3">
            <span
              aria-hidden
              className="mt-[2px] grid h-5 w-5 shrink-0 place-items-center rounded-full border border-[var(--color-rule)] font-mono text-[10px] text-[var(--color-ink-3)]"
            >
              {index + 1}
            </span>
            <span className="text-[14px] leading-[1.55] text-[var(--color-ink-2)]">{line}</span>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-2 border-t border-[var(--color-rule-2)] pt-5">
        <h3 className="label-mono">What Fanwise never does</h3>
        <ul className="flex flex-col gap-1.5">
          {NEVER[mode].map((line) => (
            <li key={line} className="flex items-start gap-2.5">
              <span
                aria-hidden
                className="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full bg-[var(--color-ink-3)]"
              />
              <span className="text-[14px] leading-[1.55] text-[var(--color-ink-2)]">{line}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
