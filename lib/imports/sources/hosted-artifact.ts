import { ImportError, type ImportErrorCode } from "../errors"
import type { ProductSourceEvidence } from "../evidence"
import type { FetchedPage } from "../retrieval/fetch-page"
import { sanitizeText, stripOpaqueElements } from "../retrieval/html"
import { isEmptyEvidence, readCommonEvidence, refuseEmpty, type SourceImporter } from "./importer"

/**
 * A published artifact page.
 *
 * The hosts are named here and in `registry.ts` and nowhere else in the tree —
 * `tests/unit/import-source-boundaries.test.ts` reads the files to prove it.
 *
 * **Only a publicly published artifact is supported, and that is a product
 * decision rather than a limitation to work around.** Fanwise reads the page
 * the way any signed-out visitor would: no cookie, no token, no account. If the
 * answer is a sign-in wall then the honest report is that the creator has not
 * published it, and the recovery is to publish it — not for Fanwise to find a
 * way in.
 *
 * What this adapter adds over the generic reading is the ability to tell the
 * several things a 200 can mean on a host like this. An artifact that is
 * private, that belongs to an organization, or that has been deleted may all
 * answer 200 with a rendered page saying so, and calling any of those a
 * successful import would put a product in a creator's catalog built from a
 * login screen.
 */

const HOSTS = ["claude.ai", "claude.site"] as const

/**
 * Phrases that mean the page is a wall rather than the thing.
 *
 * Matched against sanitized, lower-cased text with a length cap, so this reads
 * a paragraph rather than a whole document. Deliberately conservative: a false
 * positive tells a creator to publish something that is already published,
 * which is annoying, while a false negative builds a product out of a sign-in
 * screen, which is worse and harder to notice.
 */
const GATE_MARKERS: ReadonlyArray<{ code: ImportErrorCode; phrases: readonly string[] }> = [
  {
    code: "organization_only",
    phrases: [
      "only people in your organization",
      "members of this organization",
      "your organization can view",
      "shared with your organization",
      "you do not have access to this organization",
    ],
  },
  {
    code: "expired",
    phrases: ["this link has expired", "link is no longer valid", "sharing has been turned off"],
  },
  {
    code: "not_found",
    phrases: [
      "page not found",
      "artifact not found",
      "this artifact does not exist",
      "no longer available",
      "has been deleted",
    ],
  },
  {
    code: "login_required",
    phrases: [
      "sign in to continue",
      "log in to continue",
      "sign in to view",
      "you need to be signed in",
      "please sign in",
      "continue with google",
      "create an account to view",
    ],
  },
]

/** A password field is a sign-in form, whatever the copy around it says. */
function hasPasswordField(html: string): boolean {
  return /<input\b[^>]*type\s*=\s*["']?password["']?/i.test(html)
}

/**
 * Which gate a page is, or null when it is not one.
 *
 * Exported so the test suite can enumerate it rather than infer it from a
 * whole-page fixture, and so the order of precedence is visible: the most
 * specific explanation wins, and a bare password field is the last resort.
 */
export function detectGate(html: string): ImportErrorCode | null {
  const text = sanitizeText(stripOpaqueElements(html), 20_000).toLowerCase()

  for (const { code, phrases } of GATE_MARKERS) {
    if (phrases.some((phrase) => text.includes(phrase))) return code
  }
  if (hasPasswordField(html)) return "login_required"
  return null
}

export function claimsHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "")
  return HOSTS.some((known) => host === known || host.endsWith(`.${known}`))
}

export const hostedArtifactImporter: SourceImporter = {
  kind: "hosted_artifact",

  claims(url: URL): boolean {
    return claimsHost(url.hostname)
  },

  read(page: FetchedPage, originalUrl: string): ProductSourceEvidence {
    const gate = detectGate(page.html)
    if (gate) throw new ImportError(gate, { host: new URL(page.resolvedUrl).hostname })

    const evidence = readCommonEvidence(page, originalUrl, "hosted_artifact")

    // A page that answered 200 and said nothing is either a wall this adapter
    // does not recognise or a shell that renders with JavaScript. Either way
    // there is nothing to draft from, and saying so is better than saying the
    // import worked.
    if (isEmptyEvidence(evidence)) refuseEmpty()

    return evidence
  },
}
