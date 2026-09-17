import {
  formatHandoffPrice,
  textStep,
  type HandoffStep,
  type HandoffFile,
} from "@/lib/channels/handoff"
import type { HandoffInput, HandoffRendition } from "@/lib/channels/types"
import { markdownToPlainText } from "@/lib/text/markdown"
import { parseMetadata } from "@/lib/products/metadata"
import { feeSentence } from "./fees"
import { isLicenseType, licenseLabel } from "./fields"

/**
 * The handoff, ordered to Behance's project editor. docs/channels/behance.md §10.
 *
 * The editor runs: create the project, add content, Attach Assets, Continue,
 * then cover and title and fields and tags, then the description behind
 * "Co-owners, Credits, and More", then Publish. The steps follow that order
 * so the creator moves top to bottom in both windows.
 *
 * Two modes, chosen on the listing. New project emits everything. Existing
 * project emits only the asset: the creator pastes a project they already
 * published, and the sections Fanwise did not compose are left out rather
 * than greyed, so nothing looks as though Fanwise had a hand in that project.
 */

export const HANDOFF_MODE_KEY = "handoffMode"
export const EXISTING_PROJECT_URL_KEY = "existingProjectUrl"
export const CREATIVE_FIELDS_KEY = "creativeFields"
export const LICENSE_TYPE_KEY = "licenseType"

export type HandoffMode = "new" | "existing"

export const SECTIONS = {
  images: "Project images",
  asset: "Attach Assets",
  settings: "Project settings",
  credits: "Co-owners, Credits, and More",
  publish: "Make it public",
} as const

export function handoffMode(metadata: Record<string, unknown>): HandoffMode {
  return metadata[HANDOFF_MODE_KEY] === "existing" ? "existing" : "new"
}

export function creativeFields(metadata: Record<string, unknown>): string[] {
  const value = metadata[CREATIVE_FIELDS_KEY]
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []
}

/** `01-`, `02-`: the canvas order is the filename order, on Behance and in a folder. */
function numbered(position: number, filename: string): string {
  return `${String(position + 1).padStart(2, "0")}-${filename}`
}

function renditionFiles(renditions: readonly HandoffRendition[], role: string): HandoffFile[] {
  return renditions
    .filter((r) => r.role === role && r.asset !== null && r.asset.asset_state === "ready")
    .sort((a, b) => a.position - b.position)
    .map((r) => ({
      assetId: r.asset!.id,
      filename: numbered(r.position, r.asset!.filename),
      downloadAs: numbered(r.position, r.asset!.filename),
    }))
}

function filesStep(
  key: string,
  label: string,
  section: string,
  files: HandoffFile[],
  note: string,
): HandoffStep {
  return files.length === 0
    ? { kind: "missing", key, label, section }
    : { kind: "files", key, label, section, files, note }
}

/** The one file the asset holds, named for the buyer, docs/channels/behance.md §7. */
export function packageFile(input: HandoffInput): HandoffFile | null {
  const file = input.subject.assets.find(
    (a) =>
      a.asset_state === "ready" && (a.asset_type === "deliverable" || a.asset_type === "archive"),
  )
  if (!file) return null
  const extension = file.filename.match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase() ?? "zip"
  const name = `${input.subject.product.slug}-behance.${extension}`
  return { assetId: file.id, filename: name, downloadAs: name }
}

export function buildBehanceHandoff(input: HandoffInput): HandoffStep[] {
  const { draft, renditions, subject } = input
  const metadata = draft.metadata
  const mode = handoffMode(metadata)
  const steps: HandoffStep[] = []

  if (mode === "existing") {
    steps.push({
      kind: "note",
      key: "existing",
      label: "Your project",
      section: SECTIONS.asset,
      text: "You are attaching the download to a project you already published. Fanwise did not compose that project and is not checking it. Open it on Behance, choose Edit, and use Attach Assets.",
    })
  } else {
    steps.push(
      filesStep(
        "project_images",
        "Images for the canvas",
        SECTIONS.images,
        renditionFiles(renditions, "project"),
        "Upload them onto the canvas in filename order. Each is 2800 wide or smaller and under 10 MB.",
      ),
    )
  }

  const cover = renditionFiles(renditions, "cover")
  steps.push(
    filesStep(
      "asset_cover",
      "Cover",
      SECTIONS.asset,
      cover.map((file) => ({
        ...file,
        filename: file.filename.replace(/^01-/, ""),
        downloadAs: file.downloadAs?.replace(/^01-/, ""),
      })),
      "Already cropped to Behance's cover ratio. Accept the crop as it is.",
    ),
  )

  const file = packageFile(input)
  steps.push(
    file
      ? {
          kind: "copy",
          key: "file_name",
          label: "File name",
          section: SECTIONS.asset,
          value: file.filename,
          multiline: false,
          note: "Buyers see this name before they buy. Say what is inside in the description.",
        }
      : { kind: "missing", key: "file_name", label: "File name", section: SECTIONS.asset },
  )
  steps.push(
    filesStep(
      "asset_file",
      "The file",
      SECTIONS.asset,
      file ? [file] : [],
      "One file per asset, up to 500 MB.",
    ),
  )

  steps.push(textStep("category", "Category", draft.category, false, SECTIONS.asset))

  const license = metadata[LICENSE_TYPE_KEY]
  steps.push(
    isLicenseType(license)
      ? {
          kind: "note",
          key: "license",
          label: "License type",
          section: SECTIONS.asset,
          text: `Choose ${licenseLabel(license)}.`,
        }
      : { kind: "missing", key: "license", label: "License type", section: SECTIONS.asset },
  )

  steps.push(
    textStep(
      "asset_description",
      "Description",
      markdownToPlainText(draft.shortDescription ?? draft.description),
      true,
      SECTIONS.asset,
    ),
  )

  steps.push(
    draft.price === null
      ? { kind: "missing", key: "price", label: "Price", section: SECTIONS.asset }
      : {
          kind: "copy",
          key: "price",
          label: `Price, ${draft.currency}`,
          section: SECTIONS.asset,
          value: formatHandoffPrice(draft.price),
          multiline: false,
          note: feeSentence(draft.price, draft.currency),
        },
  )

  steps.push(
    filesStep(
      "example_images",
      "Example images",
      SECTIONS.asset,
      renditionFiles(renditions, "example"),
      "Up to 20. Upload them in filename order.",
    ),
  )
  steps.push({
    kind: "note",
    key: "add_asset",
    label: "Add the asset",
    section: SECTIONS.asset,
    text: "Click Add Asset, then Done.",
  })

  if (mode === "new") {
    steps.push({
      kind: "note",
      key: "project_cover",
      label: "Cover",
      section: SECTIONS.settings,
      text: "The same file as the asset cover. Accept the crop.",
    })
    steps.push(textStep("title", "Title", draft.title, false, SECTIONS.settings))
    const fields = creativeFields(metadata)
    steps.push(
      textStep(
        "creative_fields",
        "Creative Fields",
        fields.length > 0 ? fields.join(", ") : null,
        false,
        SECTIONS.settings,
      ),
    )
    steps.push(
      textStep(
        "tags",
        "Tags",
        draft.tags.length > 0 ? draft.tags.slice(0, 10).join(", ") : null,
        false,
        SECTIONS.settings,
      ),
    )
    const product = parseMetadata(subject.product.metadata)
    const tools = product.kind === "template" ? (product.software ?? []) : []
    steps.push(
      tools.length > 0
        ? {
            kind: "copy",
            key: "tools",
            label: "Tools Used",
            section: SECTIONS.settings,
            value: tools.join(", "),
            multiline: false,
          }
        : {
            kind: "note",
            key: "tools",
            label: "Tools Used",
            section: SECTIONS.settings,
            text: "Optional. Name the tools you made this with, and any generative tool, if you want them shown.",
          },
    )
    steps.push(
      textStep(
        "description",
        "Description",
        markdownToPlainText(draft.description),
        true,
        SECTIONS.credits,
      ),
    )
  }

  steps.push({
    kind: "submit",
    key: "submit",
    label: mode === "new" ? "Make the project public" : "Update the project",
    section: SECTIONS.publish,
    text:
      mode === "new"
        ? "Press the button on Behance that makes the project public, then paste the project's address below. Fanwise sends nothing to Behance."
        : "Save the project on Behance, then paste its address below. Fanwise sends nothing to Behance.",
  })

  return steps
}
