import { describe, expect, it } from "vitest"
import {
  CUSTOM_LICENSE_ID,
  CUSTOM_LICENSE_VERSION,
  LICENSE_CATALOG,
  RIGHTS_ATTESTATION_TEXT,
  RIGHTS_ATTESTATION_VERSION,
  RIGHTS_DISCLAIMER,
  licenseEntry,
  licenseText,
  versionFor,
} from "@/lib/imports/licenses"
import { evidenceChanges, licenseFor, rightsFor } from "@/lib/imports/view"
import { hashEvidence, type ProductSourceEvidence } from "@/lib/imports/evidence"
import type { ImportRecord } from "@/lib/imports/queries"
import type { Product } from "@/lib/products/types"

/**
 * The licence catalogue, the attestation, and the change preview.
 *
 * Fanwise had no licence model before this step, so what is tested here is the
 * smallest thing that answers "which licence, exactly, and when": a key, a
 * version, and the wording being recoverable afterwards.
 */

describe("the licence catalogue", () => {
  it("versions every entry, so wording cannot change under a product silently", () => {
    for (const entry of LICENSE_CATALOG) {
      expect(entry.version, entry.id).toMatch(/^\d+$/)
      expect(entry.summary.trim().length, entry.id).toBeGreaterThan(0)
      expect(entry.hint.trim().length, entry.id).toBeGreaterThan(0)
    }
  })

  it("has no two entries sharing a key", () => {
    const keys = LICENSE_CATALOG.map((entry) => entry.id)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("reads a version from the catalogue rather than being told one", () => {
    for (const entry of LICENSE_CATALOG) expect(versionFor(entry.id)).toBe(entry.version)
    expect(versionFor(CUSTOM_LICENSE_ID)).toBe(CUSTOM_LICENSE_VERSION)
  })

  it("reconstructs the exact terms that were accepted", () => {
    const entry = LICENSE_CATALOG[0]!
    expect(
      licenseText({ id: entry.id, version: entry.version, summary: "whatever was stored" }),
    ).toBe(entry.summary)
  })

  it("falls back to the stored summary once the catalogue has moved on", () => {
    // A product that accepted version 1 must not be shown version 2's words.
    const entry = LICENSE_CATALOG[0]!
    expect(licenseText({ id: entry.id, version: "0", summary: "the older wording" })).toBe(
      "the older wording",
    )
  })

  it("returns a creator's own terms verbatim", () => {
    expect(
      licenseText({ id: CUSTOM_LICENSE_ID, version: CUSTOM_LICENSE_VERSION, summary: "Mine." }),
    ).toBe("Mine.")
  })

  it("knows nothing about a key it does not have", () => {
    expect(licenseEntry("invented")).toBeNull()
  })
})

describe("the attestation", () => {
  it("is the sentence the application asks for, exactly", () => {
    expect(RIGHTS_ATTESTATION_TEXT).toBe(
      "I created this product or have permission to sell and distribute it.",
    )
  })

  it("carries a version, so the wording is recoverable", () => {
    expect(RIGHTS_ATTESTATION_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\./)
  })

  it("says Fanwise is recording a statement rather than making a finding", () => {
    expect(RIGHTS_DISCLAIMER).toContain("does not check it")
    expect(RIGHTS_DISCLAIMER).toContain("not legal advice")
  })
})

/* ------------------------------------------------------------------ view */

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "p1",
    workspace_id: "w1",
    name: "Aster",
    slug: "aster",
    product_type: "font",
    status: "draft",
    canonical_title: null,
    canonical_description: null,
    short_description: null,
    brand_name: null,
    base_price: null,
    currency: "USD",
    version: null,
    support_url: null,
    documentation_url: null,
    license_summary: null,
    license_id: null,
    license_version: null,
    license_accepted_at: null,
    rights_confirmed_at: null,
    rights_confirmed_by: null,
    rights_attestation_version: null,
    third_party_components: null,
    third_party_declared_at: null,
    metadata: {},
    created_at: "2026-09-12T00:00:00.000Z",
    updated_at: "2026-09-12T00:00:00.000Z",
    archived_at: null,
    ...overrides,
  } as Product
}

function record(overrides: Partial<ImportRecord> = {}): ImportRecord {
  return {
    row: {
      accepted: {},
      previous_evidence: null,
      previous_content_hash: null,
      provider: "webpage",
      source_url: "https://example.com/a",
    } as ImportRecord["row"],
    product: product(),
    evidence: null,
    draft: null,
    withheld: [],
    aiUnavailable: false,
    missingInformation: [],
    errorCode: null,
    errorMessage: null,
    ...overrides,
  }
}

function evidence(overrides: Partial<ProductSourceEvidence> = {}): ProductSourceEvidence {
  const base = {
    provider: "webpage" as const,
    originalUrl: "https://example.com/a",
    resolvedUrl: "https://example.com/a",
    title: { value: "Aster", provenance: "observed" as const, origin: "og" as const },
    visibleFeatures: {
      value: ["One thing"],
      provenance: "observed" as const,
      origin: "dom" as const,
    },
    previewAssets: [],
    publicDemoAvailable: true,
  }
  const merged = { ...base, ...overrides }
  return { ...merged, retrievedAt: "2026-09-12T00:00:00.000Z", contentHash: hashEvidence(merged) }
}

describe("reading a licence back off a product", () => {
  it("needs a key, not only a summary", () => {
    // The product form has always allowed free text. A summary with no key is
    // not a choice this screen recorded, and must not read as one.
    expect(licenseFor(record({ product: product({ license_summary: "Some terms." }) }))).toBeNull()
  })

  it("carries the version it was accepted at", () => {
    const chosen = licenseFor(
      record({
        product: product({
          license_id: "commercial",
          license_version: "1",
          license_summary: "For personal and commercial projects.",
        }),
      }),
    )
    expect(chosen).toMatchObject({ id: "commercial", version: "1", name: "Commercial use" })
  })
})

describe("reading an attestation back off a product", () => {
  it("needs all three parts", () => {
    expect(
      rightsFor(
        record({
          product: product({
            rights_confirmed_at: "2026-09-12T00:00:00.000Z",
            rights_confirmed_by: "u1",
          }),
        }),
      ),
    ).toBeNull()
  })

  it("distinguishes declaring none from never being asked", () => {
    const declared = rightsFor(
      record({
        product: product({
          rights_confirmed_at: "2026-09-12T00:00:00.000Z",
          rights_confirmed_by: "u1",
          rights_attestation_version: "2026-09-12.1",
          third_party_declared_at: "2026-09-12T00:00:00.000Z",
        }),
      }),
    )
    expect(declared?.thirdPartyDeclaredAt).not.toBeNull()
    expect(declared?.thirdPartyComponents).toBeNull()

    const never = rightsFor(
      record({
        product: product({
          rights_confirmed_at: "2026-09-12T00:00:00.000Z",
          rights_confirmed_by: "u1",
          rights_attestation_version: "2026-09-12.1",
        }),
      }),
    )
    expect(never?.thirdPartyDeclaredAt).toBeNull()
  })
})

describe("what changed at the source", () => {
  it("is empty when there is nothing to compare against", () => {
    expect(evidenceChanges(record({ evidence: evidence() }))).toEqual([])
  })

  it("names each field that differs, with both readings", () => {
    const before = evidence({ title: { value: "Old name", provenance: "observed", origin: "og" } })
    const changes = evidenceChanges(
      record({
        evidence: evidence(),
        row: {
          accepted: {},
          previous_evidence: JSON.parse(JSON.stringify(before)),
        } as ImportRecord["row"],
      }),
    )

    const title = changes.find((change) => change.field === "title")
    expect(title).toMatchObject({ before: "Old name", after: "Aster" })
  })

  it("says nothing about a field that did not move", () => {
    const same = evidence()
    const changes = evidenceChanges(
      record({
        evidence: same,
        row: {
          accepted: {},
          previous_evidence: JSON.parse(JSON.stringify(same)),
        } as ImportRecord["row"],
      }),
    )
    expect(changes).toEqual([])
  })
})
