import type { ProductSourceEvidence } from "../evidence"
import type { FetchedPage } from "../retrieval/fetch-page"
import { isEmptyEvidence, readCommonEvidence, refuseEmpty, type SourceImporter } from "./importer"

/**
 * Any other public web page.
 *
 * The catch-all, and it claims everything the specific importers did not, so a
 * pasted link always resolves to an importer and "nothing matched" is not a
 * state the screen has to render.
 *
 * It names no host, knows no site, and adds nothing to the common reading
 * beyond the decision to refuse a page that said nothing. That restraint is the
 * point: site-specific knowledge belongs in an importer that claims that site,
 * and the day this file starts branching on a hostname is the day the generic
 * path has stopped being generic.
 */
export const genericWebImporter: SourceImporter = {
  kind: "webpage",

  /** Total by design. This is the last importer consulted. */
  claims(): boolean {
    return true
  },

  read(page: FetchedPage, originalUrl: string): ProductSourceEvidence {
    const evidence = readCommonEvidence(page, originalUrl, "webpage")
    if (isEmptyEvidence(evidence)) refuseEmpty()
    return evidence
  },
}
