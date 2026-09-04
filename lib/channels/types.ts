import { z } from "zod"
import type { Database } from "@/lib/supabase/database.types"
import type { Product, ProductAsset } from "@/lib/products/types"

export type Channel = Database["public"]["Tables"]["channels"]["Row"]
export type ChannelConnection = Database["public"]["Tables"]["channel_connections"]["Row"]
export type ChannelListing = Database["public"]["Tables"]["channel_listings"]["Row"]
export type ListingSnapshot = Database["public"]["Tables"]["listing_snapshots"]["Row"]

export type IntegrationType = Database["public"]["Enums"]["channel_integration_type"]
export type ConnectionStatus = Database["public"]["Enums"]["connection_status"]
export type ListingStatus = Database["public"]["Enums"]["listing_status"]
export type ListingStatusSource = Database["public"]["Enums"]["listing_status_source"]
export type SnapshotType = Database["public"]["Enums"]["snapshot_type"]

/**
 * Every channel Fanwise knows about. A3 ships two mocks and nothing else; real
 * providers are added here as their adapters land.
 *
 * This union is what keeps provider names out of the rest of the codebase: a
 * component that wants to special-case a marketplace has to name a key, and a
 * unit test fails the moment a key appears outside lib/channels/adapters.
 */
export const CHANNEL_KEYS = ["mock_api", "mock_assisted"] as const
export type ChannelKey = (typeof CHANNEL_KEYS)[number]
export const channelKeySchema = z.enum(CHANNEL_KEYS)

/**
 * What a provider can actually do.
 *
 * Declared per adapter, in code. The UI reads this and never offers an action a
 * provider cannot perform. Every field here is a promise that something else in
 * the system is allowed to rely on, so declaring one true without implementing
 * the matching method is not optimism, it is a lie the UI will repeat to a
 * creator.
 */
export interface ChannelCapabilities {
  automaticPublish: boolean
  automaticUpdate: boolean
  metrics: boolean
  transactions: boolean
  digitalFileUpload: boolean
  imageUpload: boolean
  drafts: boolean
}

export const CAPABILITY_KEYS = [
  "automaticPublish",
  "automaticUpdate",
  "metrics",
  "transactions",
  "digitalFileUpload",
  "imageUpload",
  "drafts",
] as const satisfies readonly (keyof ChannelCapabilities)[]

export type CapabilityKey = (typeof CAPABILITY_KEYS)[number]

export const CAPABILITY_LABELS: Record<CapabilityKey, string> = {
  automaticPublish: "Publish automatically",
  automaticUpdate: "Update automatically",
  metrics: "Read metrics",
  transactions: "Read sales",
  digitalFileUpload: "Upload the deliverable",
  imageUpload: "Upload images",
  drafts: "Save a draft first",
}

/**
 * Everything an adapter is allowed to see about a product.
 *
 * Deliberately a copy rather than a live handle: an adapter reads the canonical
 * record and writes a listing, never the reverse.
 */
export interface AdapterSubject {
  product: Product
  assets: ProductAsset[]
}

export type RequirementSeverity = "error" | "warning" | "info"

/**
 * The result of one rule against one product.
 *
 * `severity` is the whole of it. An unsatisfied "error" blocks; an unsatisfied
 * "warning" is advice; "info" is display only. There is no separate `required`
 * flag, because two fields that must agree are two fields that can disagree.
 */
export interface RequirementResult {
  key: string
  label: string
  description?: string
  severity: RequirementSeverity
  satisfied: boolean
  message?: string
}

/**
 * Deterministic publishability. Computed from rules, never from a model: a
 * readiness score a model invented is a number nobody can act on.
 */
export interface Readiness {
  /** Errors resolved over errors total, 0 to 1. Warnings are excluded. */
  score: number
  errorsTotal: number
  errorsResolved: number
  /** Unsatisfied errors, in declaration order. These are what block. */
  blocking: RequirementResult[]
  /** Unsatisfied warnings and every info. These never block. */
  advisory: RequirementResult[]
  ready: boolean
}

/** What an adapter produces from a product. Never persisted directly. */
export interface ChannelListingDraft {
  title: string | null
  description: string | null
  shortDescription: string | null
  price: number | null
  currency: string
  category: string | null
  tags: string[]
  metadata: Record<string, unknown>
}

export interface PublishResult {
  externalListingId: string
  externalUrl: string | null
}

/**
 * The adapter contract.
 *
 * The optional methods are the point. An assisted channel does not implement
 * publish, and because capabilities.automaticPublish is false the UI never
 * offers it. Absent methods are how the honesty is enforced: a capability
 * claimed without its method fails a unit test.
 *
 * Methods beyond publish arrive with the steps that need them. A5 and A6 bring
 * real publish implementations, B5 brings fetchTransactions, and neither is
 * declared here as a capability until it exists.
 */
export interface ChannelAdapter {
  key: ChannelKey
  name: string
  integrationType: IntegrationType
  capabilities: ChannelCapabilities
  /** The rules this channel enforces, as data. See lib/channels/requirements.ts. */
  requirements: readonly RequirementSpec[]
  buildListing(subject: AdapterSubject): ChannelListingDraft
  publish?(listing: ChannelListing): Promise<PublishResult>
  update?(listing: ChannelListing): Promise<PublishResult>
  unpublish?(listing: ChannelListing): Promise<void>
}

/**
 * A requirement expressed as data.
 *
 * docs/channel-adapters.md asks that a submission spec be data rather than
 * code, so that a new assisted channel is a config file and not a feature. A
 * per-requirement validate() function cannot be that: it is code by
 * construction. These specs are walked by a single evaluator, and `custom` is
 * the escape hatch for the genuinely odd rule rather than the default shape.
 */
export type RequirementSpec =
  | TextRequirement
  | NumberRequirement
  | TagsRequirement
  | EnumRequirement
  | AssetRequirement
  | CustomRequirement

interface RequirementSpecBase {
  key: string
  label: string
  description?: string
  severity: RequirementSeverity
}

/** Fields a rule may address on a draft listing. */
export type ListingTextField = "title" | "description" | "shortDescription" | "category"
export type ListingNumberField = "price"

export interface TextRequirement extends RequirementSpecBase {
  kind: "text"
  field: ListingTextField
  minLength?: number
  maxLength?: number
}

export interface NumberRequirement extends RequirementSpecBase {
  kind: "number"
  field: ListingNumberField
  min?: number
  max?: number
}

export interface TagsRequirement extends RequirementSpecBase {
  kind: "tags"
  minCount?: number
  maxCount?: number
  maxTagLength?: number
}

export interface EnumRequirement extends RequirementSpecBase {
  kind: "enum"
  field: ListingTextField
  allowed: readonly string[]
}

export interface AssetRequirement extends RequirementSpecBase {
  kind: "asset"
  /** Any one of these types satisfies the rule. */
  assetTypes: readonly Database["public"]["Enums"]["asset_type"][]
  minCount: number
}

export interface CustomRequirement extends RequirementSpecBase {
  kind: "custom"
  evaluate(
    draft: ChannelListingDraft,
    subject: AdapterSubject,
  ): { satisfied: boolean; message?: string }
}
