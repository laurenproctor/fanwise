import type { ImportState } from "@/lib/imports/machine"
import { AnalyzingPanel } from "./analyzing-panel"
import { RecoveryPanel, type RecoveryHandlers, type RecoveryTone } from "./recovery-panel"
import { SourcePlaceholder } from "./source-placeholder"
import { SourcePreview } from "./source-preview"

/**
 * The left column: whatever the source currently is.
 *
 * One component rather than a switch inside the screen, so that every one of
 * the eight states can be rendered on its own by a test without standing up the
 * whole page. It is also the file to read to answer "what does a creator see
 * when this goes wrong", which was four places before it was one.
 *
 * Every state resolves to a panel. There is no fall-through and no null: a
 * source that cannot be read still has a column, because an empty column is how
 * a creator concludes the screen is broken.
 */

const TONES: Record<string, RecoveryTone> = {
  private: "private",
  notFound: "notFound",
  unsupported: "unsupported",
  failed: "failed",
}

export function SourcePanel({
  state,
  handlers,
  mode = "link",
}: {
  state: ImportState
  handlers: RecoveryHandlers
  mode?: "link" | "content"
}) {
  switch (state.status) {
    case "analyzed":
      return <SourcePreview snapshot={state.snapshot} />
    case "analyzing":
      return <AnalyzingPanel stage={state.stage} mode={mode} />
    case "private":
    case "notFound":
    case "unsupported":
    case "failed":
      return (
        <RecoveryPanel
          tone={TONES[state.status]!}
          message={state.message}
          recoveries={state.recoveries}
          handlers={handlers}
          mode={mode}
        />
      )
    case "empty":
    case "validating":
      return <SourcePlaceholder mode={mode} />
  }
}
