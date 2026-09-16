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
 * submission itself. A channel whose editor runs in a different order gets its
 * own order when its handoff is specified; Creative Market's is §10 of its
 * spec, and it is A8's to build.
 */

export interface HandoffFile {
  assetId: string
  filename: string
}

export type HandoffStep =
  | { kind: "copy"; key: string; label: string; value: string; multiline: boolean }
  | { kind: "files"; key: string; label: string; files: HandoffFile[]; note: string }
  | { kind: "missing"; key: string; label: string }
  | { kind: "submit"; key: string; label: string; text: string }

/** Assets as the handoff needs them: in channel order, with their state. */
export interface HandoffImage extends HandoffFile {
  ready: boolean
}

function textStep(
  key: string,
  label: string,
  value: string | null,
  multiline = false,
): HandoffStep {
  const trimmed = value?.trim() ?? ""
  return trimmed === ""
    ? { kind: "missing", key, label }
    : { kind: "copy", key, label, value: trimmed, multiline }
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
