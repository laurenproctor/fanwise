import { z } from "zod"

/**
 * Polar app configuration, parsed here rather than in lib/env.ts for the two
 * reasons the Shopify, Etsy and Gumroad adapters give: a provider name in the
 * shared schema is a provider name everywhere, and an app with no Polar
 * credentials is a valid app.
 *
 * Polar calls these the Client ID and the Client Secret, from an OAuth2 client
 * registered in a user's settings. One client per environment, because each
 * declares its own redirect URIs, and Polar refuses `http://` except on
 * localhost.
 *
 * `POLAR_ENVIRONMENT=sandbox` points every URL at Polar's isolated sandbox,
 * where a separate account, a separate OAuth client and the processor's test
 * cards exist for exactly this. Production is the default.
 */

const schema = z.object({
  clientId: z.string().min(1, "POLAR_CLIENT_ID is not set"),
  clientSecret: z.string().min(1, "POLAR_CLIENT_SECRET is not set"),
  environment: z.enum(["production", "sandbox"]),
})

export type PolarConfig = z.infer<typeof schema>

/**
 * Date-based, and pinned on every request through the `Polar-Version` header.
 *
 * Polar releases a version each January, April, July and October, keeps each
 * for about nine months, and answers 404 to one it has removed. This constant
 * is the adapter's whole exposure to that schedule: docs/channels/polar.md §10
 * says when it has to move.
 */
export const API_VERSION = "2026-04"

const HOSTS = {
  production: {
    api: "https://api.polar.sh/v1",
    authorize: "https://polar.sh/oauth2/authorize",
  },
  sandbox: {
    api: "https://sandbox-api.polar.sh/v1",
    authorize: "https://sandbox.polar.sh/oauth2/authorize",
  },
} as const

export function apiBase(): string {
  return HOSTS[environment()].api
}

export function authorizeUrl(): string {
  return HOSTS[environment()].authorize
}

export function tokenUrl(): string {
  return `${apiBase()}/oauth2/token`
}

export function revokeUrl(): string {
  return `${apiBase()}/oauth2/revoke`
}

/**
 * Only what publishing needs. Reads are needed where a write is later
 * reconciled against them: the product by id before an update, the product
 * list for the stamp search, the checkout links for a product. `orders:read`
 * arrives with B5 and means a reconnect then, the same trade Etsy made with
 * its transactions scope.
 */
export const SCOPES = [
  "organizations:read",
  "products:read",
  "products:write",
  "files:write",
  "benefits:write",
  "checkout_links:read",
  "checkout_links:write",
] as const

/**
 * Currencies Polar prices in, lowercased as its API spells them, with the
 * minimum a fixed price may be in the currency's own units. Zero is always
 * allowed and means free. From the `price_amount` documentation on the
 * `2026-04` create-product schema, docs/channels/polar.md §4.
 *
 * `minorUnits` follows the card processors' zero-decimal list, since Polar
 * states amounts "in cents". Polar's own table gives JPY's minimum as 80,
 * which reads as yen; [verify] on the exit run, §13.
 */
const ZERO_DECIMAL = new Set([
  "bif",
  "clp",
  "djf",
  "gnf",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "ugx",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf",
])

const MINIMUMS: Readonly<Record<string, number>> = {
  usd: 0.5,
  aed: 2,
  all: 50,
  amd: 200,
  aoa: 500,
  ars: 750,
  aud: 0.7,
  awg: 1,
  azn: 1,
  bam: 1,
  bbd: 2,
  bdt: 70,
  bif: 2000,
  bmd: 1,
  bnd: 1,
  bob: 5,
  brl: 2.5,
  bsd: 1,
  bwp: 10,
  bzd: 2,
  cad: 0.7,
  cdf: 2000,
  chf: 0.5,
  clp: 500,
  cny: 5,
  cop: 2000,
  crc: 300,
  cve: 50,
  czk: 15,
  djf: 100,
  dkk: 3.2,
  dop: 40,
  dzd: 70,
  egp: 30,
  etb: 80,
  eur: 0.5,
  fjd: 2,
  fkp: 1,
  gbp: 0.4,
  gel: 2,
  gnf: 5000,
  gip: 1,
  gmd: 40,
  gtq: 5,
  gyd: 200,
  hkd: 4,
  hnl: 20,
  htg: 70,
  huf: 175,
  idr: 9000,
  ils: 1.5,
  inr: 60,
  isk: 70,
  jmd: 80,
  jpy: 80,
  kes: 70,
  kgs: 50,
  khr: 3000,
  kmf: 500,
  krw: 800,
  kyd: 1,
  kzt: 300,
  lak: 20000,
  lkr: 200,
  lrd: 100,
  lsl: 10,
  mad: 5,
  mdl: 10,
  mga: 3000,
  mkd: 50,
  mnt: 2000,
  mop: 5,
  mur: 50,
  mvr: 8,
  mxn: 9,
  mwk: 1000,
  myr: 2,
  mzn: 50,
  nad: 10,
  ngn: 700,
  nio: 20,
  nok: 5,
  npr: 80,
  nzd: 0.9,
  pab: 1,
  pen: 2,
  pgk: 3,
  php: 35,
  pkr: 200,
  pln: 2,
  pyg: 4000,
  qar: 2,
  ron: 2.5,
  rsd: 60,
  rwf: 1000,
  sar: 2,
  sbd: 4,
  scr: 8,
  sek: 5,
  sgd: 0.7,
  shp: 1,
  sos: 500,
  srd: 20,
  szl: 10,
  thb: 20,
  tjs: 5,
  top: 2,
  try: 30,
  ttd: 4,
  twd: 20,
  tzs: 2000,
  uah: 30,
  ugx: 2000,
  uyu: 20,
  uzs: 7000,
  vnd: 20000,
  vuv: 100,
  wst: 2,
  xaf: 500,
  xcd: 2,
  xcg: 1,
  xof: 500,
  xpf: 100,
  yer: 200,
  zar: 9,
  zmw: 10,
}

export const CURRENCIES: Readonly<Record<string, { minimum: number; minorUnits: 1 | 100 }>> =
  Object.fromEntries(
    Object.entries(MINIMUMS).map(([code, minimum]) => [
      code,
      { minimum, minorUnits: ZERO_DECIMAL.has(code) ? 1 : 100 },
    ]),
  )

/** Polar's own limits, stated once. */
export const LIMITS = {
  titleMin: 3,
  titleMax: 64,
  /** A benefit's description, shown on the checkout page beside the product. */
  benefitDescriptionMin: 3,
  benefitDescriptionMax: 42,
  /** A product image, `service: product_media`. */
  mediaBytesMax: 10 * 1024 * 1024,
  /** A downloadable file. Polar says 10 GB. */
  fileBytesMax: 10 * 1024 * 1024 * 1024,
  /** Polar's own client sends 10 MB parts; S3 allows up to 10,000 of any size over 5 MiB. */
  partBytes: 100 * 1024 * 1024,
  /** A metadata key, and the stamp the guard relies on is one. */
  metadataKeyMax: 40,
} as const

/**
 * The metadata key a Fanwise-created product and checkout link carry, holding
 * the listing id. The list endpoint filters on it, which is what makes a
 * create whose response was lost findable rather than repeatable (ADR 0005).
 */
export const STAMP_KEY = "fanwise_listing_id"

let cached: PolarConfig | null = null

function environment(): PolarConfig["environment"] {
  return process.env.POLAR_ENVIRONMENT === "sandbox" ? "sandbox" : "production"
}

export function polarConfig(): PolarConfig {
  if (cached) return cached
  const parsed = schema.safeParse({
    clientId: process.env.POLAR_CLIENT_ID,
    clientSecret: process.env.POLAR_CLIENT_SECRET,
    environment: environment(),
  })
  if (!parsed.success) {
    throw new Error(
      "Polar is not configured on this deployment:\n" +
        parsed.error.issues.map((i) => `  ${i.message}`).join("\n"),
    )
  }
  cached = parsed.data
  return cached
}

export function isConfigured(): boolean {
  return Boolean(process.env.POLAR_CLIENT_ID && process.env.POLAR_CLIENT_SECRET)
}

/** The scopes a connection is missing, if any. Plain membership: Polar grants back what it was asked. */
export function staleScopes(granted: readonly string[]): string[] {
  if (granted.length === 0) return []
  return SCOPES.filter((scope) => !granted.includes(scope))
}

/** Test seam. */
export function resetConfigCacheForTests(): void {
  cached = null
}
