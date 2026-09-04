import { z } from "zod"
import type { Database } from "@/lib/supabase/database.types"

export type Product = Database["public"]["Tables"]["products"]["Row"]
export type ProductAsset = Database["public"]["Tables"]["product_assets"]["Row"]
export type ProductType = Database["public"]["Enums"]["product_type"]
export type ProductStatus = Database["public"]["Enums"]["product_status"]
export type AssetType = Database["public"]["Enums"]["asset_type"]
export type AssetState = Database["public"]["Enums"]["asset_state"]

export const PRODUCT_TYPES = [
  "font",
  "template",
  "graphic",
  "photo",
  "illustration",
  "icon",
  "mockup",
  "brush",
  "three_d",
  "theme",
  "other",
] as const satisfies readonly ProductType[]

export const ASSET_TYPES = [
  "deliverable",
  "source_file",
  "archive",
  "cover_image",
  "preview_image",
  "thumbnail",
  "specimen",
  "documentation",
  "license",
  "screenshot",
  "promotional",
  "other",
] as const satisfies readonly AssetType[]

export const productTypeSchema = z.enum(PRODUCT_TYPES)
export const assetTypeSchema = z.enum(ASSET_TYPES)

/** Human labels. The UI never renders a raw enum value. */
export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  font: "Font",
  template: "Template",
  graphic: "Graphic",
  photo: "Photo",
  illustration: "Illustration",
  icon: "Icon",
  mockup: "Mockup",
  brush: "Brush",
  three_d: "3D",
  theme: "Theme",
  other: "Other",
}

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  deliverable: "Deliverable",
  source_file: "Source file",
  archive: "Archive",
  cover_image: "Cover image",
  preview_image: "Preview image",
  thumbnail: "Thumbnail",
  specimen: "Specimen",
  documentation: "Documentation",
  license: "License",
  screenshot: "Screenshot",
  promotional: "Promotional",
  other: "Other",
}

export const ASSET_STATE_LABELS: Record<AssetState, string> = {
  pending: "Uploading",
  ready: "Ready",
  failed: "Failed",
}

/** Asset types that are expected to hold an image and can produce derivatives. */
export const IMAGE_ASSET_TYPES = [
  "cover_image",
  "preview_image",
  "thumbnail",
  "specimen",
  "screenshot",
  "promotional",
] as const satisfies readonly AssetType[]

export function isImageAssetType(type: AssetType): boolean {
  return (IMAGE_ASSET_TYPES as readonly AssetType[]).includes(type)
}
