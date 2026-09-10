/**
 * Browser security headers.
 *
 * Pure functions, no Next import, so `next.config.ts`, the proxy and a unit
 * test can all read the same policy. Two things decide what a response gets:
 *
 *   - **The environment.** Production gets HSTS and upgraded requests; preview
 *     additionally admits Vercel's toolbar; development admits `'unsafe-eval'`,
 *     which React needs for its debugging stack traces and nothing needs in
 *     production; a local production build (what the E2E suite runs) gets the
 *     production policy without HSTS, because it is served over http.
 *   - **The route.** The workspace and auth routes are dynamically rendered,
 *     so the proxy can mint a nonce per request, put it in the policy, and
 *     Next attaches it to every script it emits. The marketing routes are
 *     prerendered at build time, when no request exists to mint a nonce for,
 *     and Next's own hydration scripts on those pages are inline, so a strict
 *     script rule there would block the framework itself. They get every other
 *     restriction, no script rule, and the strict policy in report-only mode
 *     so the day the marketing site moves to its own deployment the cost of a
 *     strict rule is already measured. ADR 0007 records the reasoning.
 *
 * Production never contains `'unsafe-inline'` or `'unsafe-eval'` in a script
 * rule, and the unit test reads the tree of directives to prove it.
 */

export type Environment = "development" | "preview" | "production" | "local"

/**
 * Vercel sets VERCEL_ENV on every deployment; a preview is a production build
 * on a throwaway URL, so NODE_ENV alone cannot tell the two apart. Off Vercel,
 * `next dev` is development and `next start` is local.
 */
export function environmentFrom(env: {
  VERCEL_ENV?: string | undefined
  NODE_ENV?: string | undefined
}): Environment {
  if (env.VERCEL_ENV === "production") return "production"
  if (env.VERCEL_ENV === "preview") return "preview"
  if (env.VERCEL_ENV === "development" || env.NODE_ENV === "development") return "development"
  return "local"
}

/**
 * The routes `next build` prerenders. Everything else renders per request.
 * The unit test compares this list with the prerender manifest of a build,
 * so a marketing page added without being listed here fails the suite rather
 * than shipping with a nonce it cannot carry.
 */
export const STATIC_MARKETING_ROUTES = [
  "/about",
  "/how-it-works",
  "/marketplaces",
  "/pricing",
  "/privacy",
  "/start",
  "/terms",
] as const

export function isStaticMarketingRoute(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname
  return (STATIC_MARKETING_ROUTES as readonly string[]).includes(path)
}

/** A fresh nonce: 128 bits, base64. Web Crypto, so it works wherever the proxy runs. */
export function createNonce(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return Buffer.from(bytes).toString("base64")
}

export interface HeaderEntry {
  key: string
  value: string
}

/**
 * Headers every response carries, CSP aside. Set from `next.config.ts` so they
 * reach static assets too, which the proxy's matcher deliberately skips.
 */
export function baselineHeaders(environment: Environment): HeaderEntry[] {
  const headers: HeaderEntry[] = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
    },
    // Belt for browsers that predate frame-ancestors. Same answer.
    { key: "X-Frame-Options", value: "DENY" },
  ]
  if (environment === "production") {
    // Two years, subdomains included, no preload: preloading is a registry
    // submission that outlives a deployment and is not made from a config file.
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains",
    })
  }
  return headers
}

export interface PolicyInput {
  environment: Environment
  /** NEXT_PUBLIC_SUPABASE_URL. The browser talks to it for auth and uploads. */
  supabaseUrl: string
}

/**
 * What Vercel's preview toolbar needs, per Vercel's own CSP guidance. Preview
 * only: a production response never names these.
 */
const VERCEL_TOOLBAR = {
  script: ["https://vercel.live"],
  connect: ["https://vercel.live", "wss://ws-us3.pusher.com"],
  img: ["https://vercel.live", "https://vercel.com"],
  font: ["https://vercel.live", "https://assets.vercel.com"],
  style: ["https://vercel.live"],
  frame: ["https://vercel.live"],
} as const

type Directives = Record<string, string[]>

function origin(url: string): string {
  return new URL(url).origin
}

/** The directives every policy shares: everything except scripts. */
function sharedDirectives({ environment, supabaseUrl }: PolicyInput): Directives {
  const preview = environment === "preview"
  const supabase = origin(supabaseUrl)
  const directives: Directives = {
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "form-action": ["'self'"],
    // Inline style attributes are used throughout the marketing pages, and a
    // style attribute cannot carry XSS the way a script can. Scripts are what
    // the nonce is for.
    "style-src": ["'self'", "'unsafe-inline'", ...(preview ? VERCEL_TOOLBAR.style : [])],
    // Asset previews redirect an <img> to a signed storage URL, so the storage
    // host has to be admitted for images.
    "img-src": ["'self'", "data:", "blob:", supabase, ...(preview ? VERCEL_TOOLBAR.img : [])],
    "font-src": ["'self'", ...(preview ? VERCEL_TOOLBAR.font : [])],
    // Uploads PUT straight to a signed storage URL from the browser, and the
    // auth client talks to the same host. In development the dev server's
    // hot-reload socket has to be reachable too.
    "connect-src": [
      "'self'",
      supabase,
      ...(environment === "development" ? ["ws:", "wss:"] : []),
      ...(preview ? VERCEL_TOOLBAR.connect : []),
    ],
    "frame-src": preview ? [...VERCEL_TOOLBAR.frame] : ["'none'"],
    "media-src": ["'self'"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
  }
  if (environment === "production" || environment === "preview") {
    directives["upgrade-insecure-requests"] = []
  }
  return directives
}

function serialize(directives: Directives): string {
  return Object.entries(directives)
    .map(([name, sources]) => (sources.length === 0 ? name : `${name} ${sources.join(" ")}`))
    .join("; ")
}

/**
 * The policy for a dynamically rendered route. Scripts run only from this
 * origin or with this request's nonce; Next stamps the nonce on every script
 * it emits once it sees it in the request's Content-Security-Policy header.
 */
export function applicationPolicy(input: PolicyInput & { nonce: string }): string {
  const { environment, nonce } = input
  const script = ["'self'", `'nonce-${nonce}'`]
  if (environment === "development") script.push("'unsafe-eval'")
  if (environment === "preview") script.push(...VERCEL_TOOLBAR.script)
  return serialize({
    "default-src": ["'self'"],
    "script-src": script,
    ...sharedDirectives(input),
  })
}

/**
 * The enforced policy for a prerendered marketing route: every restriction
 * but a script one. No `default-src` either, because scripts would fall back
 * to it and be blocked. This is stated plainly rather than hidden: until the
 * marketing site is its own deployment, its scripts are unrestricted.
 */
export function marketingPolicy(input: PolicyInput): string {
  return serialize(sharedDirectives(input))
}

/**
 * The strict policy a marketing route would get if it could carry a nonce,
 * sent in report-only mode so violations are counted and nothing breaks.
 */
export function marketingReportOnlyPolicy(
  input: PolicyInput & { reportUri?: string | null },
): string {
  const directives: Directives = {
    "default-src": ["'self'"],
    "script-src": ["'self'"],
    ...sharedDirectives(input),
  }
  if (input.reportUri) directives["report-uri"] = [input.reportUri]
  return serialize(directives)
}

/**
 * Sentry accepts CSP reports at a URL derived from the DSN. Null when there
 * is no DSN, in which case violations are visible in the browser console only.
 */
export function cspReportUri(sentryDsn: string | undefined | null): string | null {
  if (!sentryDsn) return null
  try {
    const dsn = new URL(sentryDsn)
    const projectId = dsn.pathname.replace(/^\/+/, "")
    if (!dsn.username || !projectId) return null
    return `${dsn.origin}/api/${projectId}/security/?sentry_key=${dsn.username}`
  } catch {
    return null
  }
}
