import type { FontMetadata } from "@/lib/products/metadata"
import type { FontReadiness } from "@/lib/fonts/readiness"
import type { PatchField } from "@/lib/fonts/save"
import type {
  ChannelDraftView,
  DetectedFamily,
  FontFileView,
  FontProductValues,
  FontSection,
  SpecimenImageView,
} from "@/lib/fonts/workspace"

export type FontKey = Exclude<keyof FontMetadata, "kind">

/** Typing waits for a pause; a choice saves at once. */
export interface EditOptions {
  immediate?: boolean
}

/**
 * What every section is handed.
 *
 * Sections hold no copy of the product. They read `values` and `metadata` from
 * the workspace and write through `setValue` / `setFont`, so switching sections
 * unmounts a form without losing a keystroke: the edit already lives above it.
 */
export interface SectionContext {
  workspaceSlug: string
  productId: string
  productSlug: string
  values: FontProductValues
  metadata: FontMetadata
  setValue: <K extends keyof FontProductValues>(
    key: K,
    value: FontProductValues[K],
    options?: EditOptions,
  ) => void
  setFont: <K extends FontKey>(
    key: K,
    value: FontMetadata[K] | undefined,
    options?: EditOptions,
  ) => void
  fieldError: (field: PatchField) => string | null
  files: FontFileView[]
  family: DetectedFamily
  images: SpecimenImageView[]
  channels: ChannelDraftView[]
  readiness: FontReadiness
  hasLicenseFile: boolean
  openSection: (section: FontSection, fieldId?: string | null) => void
  refresh: () => void
}
