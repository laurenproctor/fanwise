import type { ChannelAdapter, HandoffInput } from "./types"
import type { ChannelListingDraft } from "./types"

/**
 * What a creator carries from Fanwise to an assisted channel, in order.
 *
 * An assisted channel has no API, so the listing reaches it by a person
 * copying fields into the marketplace's own editor. This is the list they copy
 * from. It is derived from the saved listing and nothing else, so the page and
 * the companion window (docs/companion-window.md) can never disagree about
 * what to paste: both render these steps.
 *
 * The order here is generic: title, description, tags, price, images, then the
 * submission itself. A channel whose editor runs in a different order declares
 * `buildHandoff` on its adapter and `handoffSteps` below hands it the same
 * input; Behance's is the first, ordered to its project editor. Creative
 * Market's is §10 of its spec, and it is A8's to build.
 */

export interface HandoffFile {
  assetId: string
  filename: string
  /**
   * The name the file should arrive under, when it differs from the row's.
   * A channel that shows the filename to buyers, or sorts uploads by it,
   * wants a name Fanwise chose rather than whatever the creator uploaded.
   */
  downloadAs?: string
}

interface HandoffStepBase {
  key: string
  label: string
  /**
   * The part of the channel's editor this step belongs to. Steps that share a
   * section are shown together under its heading, numbered as one. Absent on
   * every step, the panel numbers the steps themselves.
   */
  section?: string
}

export type HandoffStep =
  | (HandoffStepBase & {
      kind: "copy"
      value: string
      multiline: boolean
      /** A line under the value: what the channel does with it, a fee, a caveat. */
      note?: string
      /**
       * The same value as formatted text, for a channel whose field is a
       * rich-text editor: pasted markdown lands there as literal asterisks.
       * The panel puts both on the clipboard, and `value` is the plain
       * fallback for an editor that takes only text.
       */
      html?: string
    })
  | (HandoffStepBase & { kind: "files"; files: HandoffFile[]; note: string })
  | (HandoffStepBase & { kind: "missing" })
  /** An instruction with nothing to copy: a click to make, a setting to accept. */
  | (HandoffStepBase & { kind: "note"; text: string })
  | (HandoffStepBase & { kind: "submit"; text: string })

/** Assets as the handoff needs them: in channel order, with their state. */
export interface HandoffImage extends HandoffFile {
  ready: boolean
}

export function textStep(
  key: string,
  label: string,
  value: string | null,
  multiline = false,
  section?: string,
): HandoffStep {
  const trimmed = value?.trim() ?? ""
  const base = section ? { key, label, section } : { key, label }
  return trimmed === ""
    ? { kind: "missing", ...base }
    : { kind: "copy", ...base, value: trimmed, multiline }
}

/**
 * A price as a marketplace's price field wants it: the number, with two
 * decimals and no symbol. The currency goes in the label, because pasting "$15"
 * into a numeric field is the paste that fails.
 */
export function formatHandoffPrice(price: number): string {
  return price.toFixed(2)
}

export function buildHandoffSteps(
  draft: ChannelListingDraft,
  images: readonly HandoffImage[],
  channelName: string,
): HandoffStep[] {
  const steps: HandoffStep[] = [
    textStep("title", "Title", draft.title),
    textStep("description", "Description", draft.description, true),
    textStep("tags", "Tags", draft.tags.length > 0 ? draft.tags.join(", ") : null),
    draft.price === null
      ? { kind: "missing", key: "price", label: "Price" }
      : {
          kind: "copy",
          key: "price",
          label: draft.currency ? `Price, ${draft.currency}` : "Price",
          value: formatHandoffPrice(draft.price),
          multiline: false,
        },
  ]

  // An image still processing cannot be downloaded, and a download link that
  // answers 404 is worse than no link. It is left out rather than shown broken.
  const ready = images.filter((image) => image.ready)
  steps.push(
    ready.length === 0
      ? { kind: "missing", key: "images", label: "Images" }
      : {
          kind: "files",
          key: "images",
          label: "Images",
          files: ready.map(({ assetId, filename }) => ({ assetId, filename })),
          note: "Upload them in this order. On most marketplaces the first becomes the thumbnail.",
        },
  )

  steps.push({
    kind: "submit",
    key: "submit",
    label: "Submit",
    text: `Submit the listing on ${channelName} yourself. Fanwise does not send anything to ${channelName}.`,
  })

  return steps
}

/**
 * The handoff for one channel: its own order where it declares one, the
 * generic order otherwise. One entry point, so the listing page and the
 * companion window cannot pick differently.
 */
export function handoffSteps(
  adapter: Pick<ChannelAdapter, "name" | "buildHandoff">,
  input: HandoffInput,
): HandoffStep[] {
  if (adapter.buildHandoff) return adapter.buildHandoff(input)
  return buildHandoffSteps(input.draft, input.images, adapter.name)
}
