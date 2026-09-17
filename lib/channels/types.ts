import { z } from "zod"
import type { Database } from "@/lib/supabase/database.types"
import type { Product, ProductAsset } from "@/lib/products/types"
import type { ImageSpec } from "@/lib/products/derivatives"
import type { PackageSpec } from "@/lib/products/package-spec"
import type { HandoffImage, HandoffStep } from "./handoff"

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
 * Every channel Fanwise knows about. A3 shipped two mocks; A5 adds the first
 * real provider, and the rest arrive here as their adapters land.
 *
 * This union is what keeps provider names out of the rest of the codebase: a
 * component that wants to special-case a marketplace has to name a key, and a
 * unit test fails the moment a key appears outside lib/channels/adapters.
 */
export const CHANNEL_KEYS = [
  "mock_api",
  "mock_assisted",
  "shopify",
  "woocommerce",
  "etsy",
  "gumroad",
  "behance",
  "creative_market",
] as const
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
 * What the creator does instead, wherever a channel cannot do one of these.
 *
 * Shown on the channel card rather than hidden behind a hover. This list is
 * read once, while deciding whether to connect a channel, and the half of it
 * that changes that decision is the half a channel cannot do. An explanation
 * someone has to go looking for is one they find after they needed it.
 *
 * Typed against CapabilityKey, so a new capability does not compile until the
 * consequence of not having it is written down.
 */
export const CAPABILITY_ABSENCES: Record<CapabilityKey, string> = {
  automaticPublish: "You create the listing on the channel yourself.",
  automaticUpdate: "Later edits stay in Fanwise until you copy them across.",
  metrics: "Fanwise cannot tell you how the listing is performing.",
  transactions: "Sales here will not appear in Fanwise.",
  digitalFileUpload: "Fanwise gives you a step to attach the file by hand.",
  imageUpload: "You add the images on the channel yourself.",
  drafts: "Creating the listing puts it on sale straight away.",
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
  /**
   * Non-secret facts the connection learned about the account at authorization
   * time, such as the currency a storefront actually sells in.
   *
   * Deliberately an opaque bag rather than typed fields: the adapter wrote
   * these keys and is the only thing that reads them, so naming them here would
   * put provider-shaped fields on a shared type. It is `metadata` from
   * channel_connections and never `channel_connection_secrets`, so nothing in
   * it is a credential and it is safe to send to the browser, which the editor
   * does so client-side readiness matches the server's.
   */
  connectionMetadata?: Record<string, unknown>
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
  /**
   * The search-result title and description, when the creator wants them to
   * differ from the listing's own.
   *
   * Both are overrides and null is the ordinary state: a channel that has these
   * fields falls back to the listing title and the short description, which is
   * usually the right answer. They are separate from `shortDescription` because
   * a blurb written for a product page and a line written for a search result
   * are two pieces of writing, and a channel that offers both fields is a
   * channel that expects two.
   */
  seoTitle: string | null
  seoDescription: string | null
  price: number | null
  currency: string
  category: string | null
  tags: string[]
  metadata: Record<string, unknown>
}

/**
 * What the provider now holds after a write.
 *
 * `externalState` is the field that keeps ADR 0001 honest. A channel that
 * cannot receive the deliverable through its API creates the object in a state
 * a buyer cannot reach, and only a human confirming the file is attached moves
 * it to `live`. Without this field "published" would be one word covering both
 * "for sale" and "for sale with nothing behind it".
 */
export interface PublishResult {
  externalListingId: string
  externalUrl: string | null
  externalState: ExternalListingState
  /**
   * Whether a buyer can actually reach and buy the thing that was just written.
   *
   * Separate from `externalState`, and the separation is the whole point. A5's
   * exit test found a provider where the object's own status says "active" and
   * a buyer still cannot reach it, because being active and being on a sales
   * channel are two different facts there. `externalState` answers the first —
   * it has to, because an update reads it back to avoid taking a live object
   * off sale — so it cannot also answer the second without one of the two
   * questions getting the wrong answer.
   *
   * `null` means the adapter did not establish it. That is not the same as
   * false and must never be rendered as one: a channel with no such concept,
   * and every listing published before this field existed, are both null, and
   * reporting those as "nobody can buy this" would be a fresh lie in the
   * opposite direction.
   */
  purchasable?: boolean | null
  /**
   * The address a buyer would use, when the object has one.
   *
   * `externalUrl` is the creator's address, and on a storefront that is the
   * admin editor because nothing else works for a draft. This is the page a
   * visitor lands on. The runner stores it only while the listing is live and
   * not known to be unpurchasable, so an adapter returns it whenever the
   * provider says what it is, without deciding liveness a second time.
   */
  publicUrl?: string | null
  /**
   * Facts about the provider's object that only the adapter needs back on its
   * next write, merged into `channel_listings.metadata` by the runner.
   *
   * Exists because one provider hands out an address exactly once: Gumroad
   * returns a file's canonical URL at upload and never again, and an update
   * that cannot resend it deletes the buyer's download. Never a credential,
   * never rendered, and never allowed to override the keys publication owns
   * (`externalState`, `purchasable`), which the runner writes after it.
   */
  listingMetadata?: Record<string, unknown>
  /**
   * The provider's own response, persisted to publication_jobs. Never rendered,
   * and never a credential: adapters return what came back from a write.
   */
  providerResponse?: unknown
}

export type ExternalListingState = "draft" | "live"

/**
 * Everything an adapter needs to perform an external write.
 *
 * `assetUrl` is injected rather than imported so the adapter never reaches into
 * lib/products/storage. Providers that ingest media by URL get a time-limited
 * signed link; the adapter asks for one and does not know or care where the
 * bytes live.
 */
export interface PublishContext {
  listing: ChannelListing
  connection: ChannelConnection
  subject: AdapterSubject
  assetUrl(asset: ProductAsset): Promise<string>
  /**
   * A permanent download address for a deliverable on this listing, for a
   * channel that serves the file to buyers by URL (ADR 0012). The same address
   * on every call for the same file. Injected, like `assetUrl`, so no adapter
   * reaches into delivery or storage itself.
   */
  deliveryUrl(asset: ProductAsset): Promise<string>
  /**
   * A time-limited signed link to a rendition of an image, built to the spec
   * the adapter names, for a channel whose image slot has a shape of its own
   * (a square thumbnail, say). Rendered once and cached by the derivative
   * engine; the adapter names a spec and never touches storage or sharp.
   * Optional because only the runner provides it, and a channel that needs
   * none should not have to be handed one.
   */
  derivativeUrl?(asset: ProductAsset, spec: ImageSpec): Promise<string>
}

/**
 * Work the provider's API cannot do and a person must.
 *
 * Declared in the adapter, in code, for the same reason capabilities are: the
 * database row records only which step and whether it is done. A row that also
 * carried "required" would be a requirement somebody could edit away.
 *
 * ADR 0001 is the worked example. Shopify has no API for attaching a
 * buyer-downloadable file, so the creator does it once per product, and until
 * they have, the product is not purchasable.
 */
export interface ManualStepSpec {
  key: string
  label: string
  description: string
  /** Rendered as a numbered list, in order. */
  instructions: readonly string[]
  /** An incomplete required step means published, but not live. */
  required: boolean
  /**
   * True when the provider object stays in a draft state until this is done and
   * the adapter flips it live afterwards. An adapter declaring this must
   * implement `activate`, which a unit test checks.
   */
  gatesActivation: boolean
  /** True when the creator needs the deliverable in hand to perform the step. */
  needsDeliverable: boolean
}

/** What the creator types before an authorization begins. */
export interface OAuthAuthorizeRequest {
  state: string
  accountHint: string
  redirectUri: string
  /**
   * Where a provider that delivers the credential server-to-server should post
   * it. Built by Fanwise like the redirect URI, and ignored by a provider that
   * hands the credential to the browser.
   */
  grantUri: string
  /**
   * The S256 challenge for a provider that requires PKCE. Present only when
   * the adapter declares `pkce`; the verifier it was derived from stays on
   * the state row and reaches `exchange`.
   */
  codeChallenge?: string
}

/**
 * A credential that arrives by a separate POST rather than in the redirect.
 *
 * Some providers do not put anything secret in the browser: the store posts
 * the keys to a server endpoint and sends the person back with a yes or a no.
 * An adapter that declares this completes the connection from that POST, and
 * the browser callback only reports. The generic routes branch on its
 * presence; nothing else in the tree knows which providers work this way.
 */
export interface ChannelGrant {
  /**
   * Reads the provider's POST body. Returns null for anything that is not a
   * well-formed grant, and never throws on a stranger's input.
   */
  parse(
    body: unknown,
  ): { state: string; credentials: Record<string, unknown>; scopes: string[] } | null
  /**
   * Proves the credential works against the account the flow started for,
   * and reads what the connection should carry. A credential that does not
   * work against that account is refused: the state proves someone approved
   * *something*, and this proves it was the store the creator named.
   */
  verify(params: {
    accountHint: string
    credentials: Record<string, unknown>
    scopes: string[]
  }): Promise<OAuthGrant>
}

/**
 * The result of a completed authorization.
 *
 * `credentials` is the only secret-bearing field, is sealed by
 * lib/credentials before it reaches a row, and never leaves the server.
 * Everything else is non-secret and lands on channel_connections.
 */
export interface OAuthGrant {
  externalAccountId: string
  externalAccountName: string | null
  scopes: string[]
  expiresAt: string | null
  credentials: Record<string, unknown>
  metadata: Record<string, unknown>
}

export interface ChannelOAuth {
  /** Label and placeholder for the account field, e.g. a shop domain. */
  accountHintLabel: string
  accountHintPlaceholder: string
  /**
   * Everything this build asks the provider for.
   *
   * Declared here rather than left inside the adapter so shared code can ask
   * whether an existing connection was granted it, without naming a provider.
   * `channel_connections.scopes` records what was actually granted, and until
   * this field existed nothing compared the two — the column was written at
   * every authorization and read by nothing, which was survivable only while
   * the list never changed.
   *
   * It changes. A connection authorized before a scope was added holds a token
   * that cannot do the new thing, and the creator has to be asked again.
   */
  scopes: readonly string[]
  /**
   * Whether a granted list covers one required scope.
   *
   * Optional, and the default is plain membership. It exists because plain
   * membership is wrong on at least one provider and shared code has no way to
   * know which: Shopify treats `write_x` as implying `read_x` and grants back
   * only the write half, so a literal comparison reports a scope missing on a
   * connection that holds it — permanently, since reconnecting cannot add an
   * entry the provider will not return.
   *
   * The rule belongs to the adapter rather than here for the ordinary reason:
   * the next provider's rule will differ, and encoding Shopify's in shared code
   * would make it everyone's.
   */
  holdsScope?(granted: readonly string[], required: string): boolean
  /**
   * Validates and normalizes what the creator typed, before it reaches a URL.
   * An account hint becomes a hostname Fanwise redirects a person to and then
   * sends a client secret to, so it is checked rather than trusted.
   */
  parseAccountHint(raw: string): { ok: true; value: string } | { ok: false; message: string }
  /**
   * Present when the provider posts the credential to a server endpoint. The
   * callback then verifies the browser's return and reports; `exchange` is
   * never called for such a channel.
   */
  grant?: ChannelGrant
  /**
   * True when the provider's OAuth requires PKCE. The shared flow mints the
   * verifier, keeps it on the state row, hands the challenge to
   * `authorizeUrl` and the verifier to `exchange`.
   */
  pkce?: boolean
  authorizeUrl(request: OAuthAuthorizeRequest): string
  /**
   * Integrity of the callback itself, verified before any parameter is used,
   * per docs/security.md rule 5.
   */
  verifyCallback(query: URLSearchParams): boolean
  exchange(params: {
    accountHint: string
    query: URLSearchParams
    redirectUri: string
    /** The PKCE verifier minted when the flow started, for a `pkce` adapter. */
    codeVerifier?: string
  }): Promise<OAuthGrant>
  /**
   * Tells the provider the credential is finished with, before the connection
   * row is deleted. For a provider whose tokens never expire, this is the only
   * thing that ever ends the authorization. Best effort: a revoke that fails
   * does not stop a disconnect, and the adapter reads the credential itself so
   * the token never passes through the action.
   */
  revoke?(params: { workspaceId: string; connectionId: string }): Promise<void>
}

/**
 * How a channel wants to be written for.
 *
 * Declared per adapter, in code, like capabilities and requirements and for the
 * same reason: it describes the channel, and a channel description that could
 * be edited in a row is one the prompt could be talked out of. lib/ai reads
 * this and never a provider name; the profile is the only channel-shaped thing
 * that reaches a model, and it is merchandising instruction, never facts.
 *
 * docs/ai-merchandising.md is the source: do not write the canonical
 * description four times. One product, one FactSheet, one profile per channel.
 *
 * `promptVersion` moves whenever the text does. It is written to every
 * generation row so a listing can be traced to the instructions that produced
 * it, which matters the first time a profile change makes copy worse.
 */
export interface MerchandisingProfile {
  /** Bumped by hand whenever any text below changes. */
  promptVersion: string
  /** Who buys here and how they arrive: search, browsing, a brand they know. */
  audience: string
  /** The register the copy should take. */
  voice: string
  /** How the description should be shaped, in prose the model can follow. */
  structure: string
  /** Guidance per output field, beyond the limits the requirements already state. */
  fields: {
    title: string
    description: string
    shortDescription: string
    seoTitle: string
    seoDescription: string
    tags: string
  }
}

/**
 * The adapter contract.
 *
 * The optional methods are the point. An assisted channel does not implement
 * publish, and because capabilities.automaticPublish is false the UI never
 * offers it. Absent methods are how the honesty is enforced: a capability
 * claimed without its method fails a unit test.
 *
 * Methods beyond publish arrive with the steps that need them. A5 brings the
 * first real publish implementation, B5 brings fetchTransactions, and neither
 * is declared here as a capability until it exists.
 */
/**
 * A listing field a channel may or may not have. Currency travels with price
 * and metadata belongs to the adapter, so neither is one.
 */
export type ChannelField =
  | "title"
  | "description"
  | "shortDescription"
  | "seoTitle"
  | "seoDescription"
  | "price"
  | "category"
  | "tags"

export interface DeliverySetupSpec {
  title: string
  /** Why this is needed, in one or two sentences. */
  description: string
  /** Rendered as a numbered list, in order. */
  steps: readonly string[]
  /** Text the creator copies into the channel, shown verbatim with a Copy button. */
  snippet: string
}

/**
 * A provider limit that is not per connection.
 *
 * Every earlier channel throttles per shop or per app token, so one
 * workspace's traffic cannot starve another's. A provider that throttles by
 * source address changes that: every workspace's creates leave from the same
 * workers and draw on one allowance. An adapter that declares this has its
 * publishes queued one at a time, on the named queue, and each holds its turn
 * for at least the interval, platform-wide. The runner reads it; nothing else
 * names a provider.
 */
export interface PublishPace {
  /** The durable queue creates run on, declared in trigger/jobs.ts with a concurrency of one. */
  queue: string
  /** How long a publish holds its turn, from when it started. */
  minIntervalMs: number
}

/**
 * How a channel with nothing to authorize against is connected.
 *
 * An assisted channel holds no credential, so Connect writes a row and starts
 * no flow. What it still needs is which account the row is for: the profile a
 * creator will submit to, so the connection can be named and so a second
 * workspace cannot quietly claim the same one. The adapter parses what was
 * typed for the same reason an OAuth adapter parses its account hint: the
 * value becomes `external_account_id`, and a guess there is a wrong row.
 */
export interface AccountHintSpec {
  label: string
  placeholder: string
  parse(raw: string): { ok: true; value: string; name: string } | { ok: false; message: string }
}

/**
 * A per-listing setting the channel asks for that is not a listing field.
 *
 * A marketplace form has controls the canonical listing has no column for:
 * which of its own creative fields a piece belongs to, which of two fixed
 * licenses the seller grants, which of two ways the handoff should run. They
 * are stored under `channel_listings.metadata[key]`, declared here as data so
 * the editor renders them without knowing the channel, and read back by the
 * adapter's requirements and handoff. The server validates a saved value
 * against this declaration, so the browser cannot write a key the adapter did
 * not ask for.
 */
export interface ListingChoiceOption {
  value: string
  label: string
  /** One line under the label, when the option needs one. */
  hint?: string
}

interface ListingChoiceBase {
  /** The metadata key. camelCase, never a provider name. */
  key: string
  label: string
  description?: string
  /** Rendered only while another choice holds the named value, or one of them. */
  showWhen?: { key: string; value: string | readonly string[] }
}

export type ListingChoiceSpec =
  | (ListingChoiceBase & { kind: "single"; options: readonly ListingChoiceOption[] })
  | (ListingChoiceBase & {
      kind: "multiple"
      options: readonly ListingChoiceOption[]
      /** A ceiling the channel's own form enforces. */
      max?: number
    })
  | (ListingChoiceBase & { kind: "text"; placeholder?: string; maxLength?: number })

/**
 * One rendition the handoff hands the creator, named by the adapter.
 *
 * Built by the derivative engine from the adapter's spec, cached on the
 * source, and listed on the handoff as a download. `role` is what the file is
 * for on the channel's form, in the adapter's words; `position` orders files
 * that share a role.
 */
export interface HandoffRenditionSpec {
  source: ProductAsset
  spec: ImageSpec
  role: string
  position: number
}

/** A rendition as the handoff receives it: built, or not yet. */
export interface HandoffRendition {
  role: string
  position: number
  source: ProductAsset
  /** The derivative row, once the engine has produced it. */
  asset: ProductAsset | null
}

/** The package a handoff hands over: named by the adapter, built or not yet. */
export interface HandoffPackage {
  spec: PackageSpec
  /** The package row, once the build has produced it. */
  asset: ProductAsset | null
}

/** Everything an adapter's handoff is built from. */
export interface HandoffInput {
  draft: ChannelListingDraft
  subject: AdapterSubject
  /** The channel's images in channel order, as the generic handoff lists them. */
  images: readonly HandoffImage[]
  renditions: readonly HandoffRendition[]
  /** Present for a channel that declares `handoffPackage`. */
  package?: HandoffPackage | null
}

/**
 * How a creator tells Fanwise a listing they submitted by hand is up.
 *
 * Present only on an assisted channel, and the only way such a listing ever
 * reaches `published`. The URL the creator pastes is the one handle Fanwise
 * will hold on the listing; the adapter parses it, because the shape of a
 * provider's address is the provider's business, and the id it yields is
 * what keeps the same project from being claimed twice.
 */
export interface SubmissionSpec {
  urlLabel: string
  urlPlaceholder: string
  parseUrl(
    raw: string,
  ): { ok: true; externalListingId: string; externalUrl: string } | { ok: false; message: string }
}

export interface ChannelAdapter {
  key: ChannelKey
  name: string
  integrationType: IntegrationType
  capabilities: ChannelCapabilities
  /** Present on a channel whose create limit is shared across every workspace. */
  pace?: PublishPace
  /**
   * The listing fields this channel has. The editor shows these and no others,
   * and a listing resolves a field the channel lacks to empty, so a product
   * edit to a field nobody sends never reads as a change to send.
   */
  fields: readonly ChannelField[]
  /**
   * True when the channel delivers the file by serving a Fanwise download
   * address (ADR 0012), which the creator can replace to cut off a leaked link.
   */
  deliversByLink?: boolean
  /**
   * What the creator is warned of before replacing a download link, when the
   * link has already reached buyers somewhere Fanwise cannot update.
   */
  deliveryLinkReplaceNote?: string
  /**
   * A one-time setup, per connected account, that delivery depends on
   * (ADR 0013). Rendered on the Channels page; confirmed onto the connection.
   */
  deliverySetup?: DeliverySetupSpec
  /** The rules this channel enforces, as data. See lib/channels/requirements.ts. */
  requirements: readonly RequirementSpec[]
  /** Work this channel's API cannot do. Empty for a channel that needs none. */
  manualSteps: readonly ManualStepSpec[]
  /** How copy for this channel should read. Read by lib/ai. Step B1. */
  merchandising: MerchandisingProfile
  buildListing(subject: AdapterSubject): ChannelListingDraft
  /** Present only on a channel Fanwise can authorize against. */
  oauth?: ChannelOAuth
  /**
   * Present on a channel connected by naming an account rather than
   * authorizing one. Never alongside `oauth`.
   */
  accountHint?: AccountHintSpec
  /** Settings the channel's form asks for beyond the listing fields. */
  choices?: readonly ListingChoiceSpec[]
  /**
   * The renditions an assisted channel's handoff hands over. Built when the
   * listing is built and matched to their rows when the handoff is shown.
   */
  handoffImages?(subject: AdapterSubject): HandoffRenditionSpec[]
  /**
   * The handoff in this channel's own order. Absent, the generic order in
   * lib/channels/handoff.ts is used.
   */
  buildHandoff?(input: HandoffInput): HandoffStep[]
  /**
   * The package an assisted channel's handoff hands over: the buyer's files,
   * a README and the license documents in one zip, named as a spec and built
   * by the package build when the listing is built. Null when the product
   * has nothing to package yet.
   */
  handoffPackage?(subject: AdapterSubject): PackageSpec | null
  /** Mark submitted with URL capture. Assisted channels only. */
  submission?: SubmissionSpec
  publish?(context: PublishContext): Promise<PublishResult>
  update?(context: PublishContext): Promise<PublishResult>
  /** Moves a provider draft to live. Required when a step gates activation. */
  activate?(context: PublishContext): Promise<PublishResult>
  unpublish?(context: PublishContext): Promise<void>
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
export type ListingTextField =
  "title" | "description" | "shortDescription" | "seoTitle" | "seoDescription" | "category"
export type ListingNumberField = "price"

export interface TextRequirement extends RequirementSpecBase {
  kind: "text"
  field: ListingTextField
  minLength?: number
  maxLength?: number
  /**
   * True when an empty value is fine and the bounds apply only to a value that
   * is set.
   *
   * The field this was added for is a meta title. Leaving it blank is not a
   * mistake — the channel falls back to the listing title, which is usually
   * what the creator wants — but a 200 character one is a mistake, and it is
   * the kind the creator cannot see without a counter. Without this flag the
   * only way to get the counter was to declare a rule that complains about
   * every listing that has quite reasonably left the field alone, and a
   * readiness list that is mostly noise is a readiness list nobody reads.
   *
   * `custom` could express the same rule, but a custom rule is opaque to
   * `constraintsFor`, so the editor would show no limit at all and the creator
   * would learn about the wall by hitting it.
   */
  optional?: boolean
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
