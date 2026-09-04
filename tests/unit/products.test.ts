import { describe, expect, it } from "vitest"
import {
  createProductSchema,
  productSlugSchema,
  updateProductSchema,
  uploadIntentSchema,
} from "@/lib/products/schemas"
import {
  METADATA_KIND_BY_PRODUCT_TYPE,
  emptyMetadataFor,
  parseMetadata,
  productMetadataSchema,
} from "@/lib/products/metadata"
import { PRODUCT_TYPES, isImageAssetType } from "@/lib/products/types"
import { buildStoragePath, sanitizeFilename } from "@/lib/products/storage"
import { FALLBACK_MIME, isDerivableImage, sniffMimeType } from "@/lib/products/sniff"
import { groupDerivatives } from "@/lib/products/queries"
import type { ProductAsset } from "@/lib/products/types"

describe("product schemas", () => {
  it("requires a name and a type", () => {
    expect(createProductSchema.safeParse({ name: "", productType: "font" }).success).toBe(false)
    expect(createProductSchema.safeParse({ name: "Aster", productType: "nope" }).success).toBe(
      false,
    )
    expect(createProductSchema.safeParse({ name: "Aster", productType: "font" }).success).toBe(true)
  })

  it("accepts every declared product type", () => {
    for (const type of PRODUCT_TYPES) {
      expect(createProductSchema.safeParse({ name: "X", productType: type }).success).toBe(true)
    }
  })

  it("normalises empty optional text to undefined rather than empty string", () => {
    const parsed = updateProductSchema.parse({
      name: "Aster",
      productType: "font",
      canonicalTitle: "",
      currency: "usd",
    })
    expect(parsed.canonicalTitle).toBeUndefined()
    expect(parsed.currency).toBe("USD")
  })

  it("rejects a malformed currency", () => {
    const result = updateProductSchema.safeParse({
      name: "Aster",
      productType: "font",
      currency: "dollars",
    })
    expect(result.success).toBe(false)
  })

  it("rejects a negative price", () => {
    const result = updateProductSchema.safeParse({
      name: "Aster",
      productType: "font",
      basePrice: "-5",
      currency: "USD",
    })
    expect(result.success).toBe(false)
  })

  it("rejects a malformed url but accepts an empty one", () => {
    const base = { name: "Aster", productType: "font", currency: "USD" }
    expect(updateProductSchema.safeParse({ ...base, supportUrl: "not a url" }).success).toBe(false)
    expect(updateProductSchema.safeParse({ ...base, supportUrl: "" }).success).toBe(true)
    expect(
      updateProductSchema.safeParse({ ...base, supportUrl: "https://example.com" }).success,
    ).toBe(true)
  })

  it("rejects product slugs the database would reject", () => {
    for (const bad of ["ab", "-lead", "trail-", "double--hyphen", "has space", "sym!bol"]) {
      expect(productSlugSchema.safeParse(bad).success).toBe(false)
    }
    expect(productSlugSchema.safeParse("aster-grotesk-2").success).toBe(true)
  })

  it("normalises case rather than rejecting it", () => {
    // The schema lowercases before validating, so a creator typing "Aster" gets
    // a usable slug instead of an error. The stored value still satisfies the
    // database's lowercase-only check constraint.
    expect(productSlugSchema.parse("AsterGrotesk")).toBe("astergrotesk")
  })
})

describe("upload intent", () => {
  const valid = {
    productId: "6f1a2b3c-4d5e-4f60-8123-456789abcdef",
    assetType: "deliverable",
    filename: "aster.zip",
    byteSize: 1024,
  }

  it("accepts a well formed intent", () => {
    expect(uploadIntentSchema.safeParse(valid).success).toBe(true)
  })

  it("rejects an empty file", () => {
    expect(uploadIntentSchema.safeParse({ ...valid, byteSize: 0 }).success).toBe(false)
  })

  it("rejects a file over the 4 GB bucket limit", () => {
    const overLimit = 4 * 1024 * 1024 * 1024 + 1
    expect(uploadIntentSchema.safeParse({ ...valid, byteSize: overLimit }).success).toBe(false)
  })

  it("rejects a product id that is not a uuid", () => {
    expect(uploadIntentSchema.safeParse({ ...valid, productId: "nope" }).success).toBe(false)
  })
})

describe("product metadata", () => {
  it("maps every product type to a metadata kind", () => {
    for (const type of PRODUCT_TYPES) {
      expect(METADATA_KIND_BY_PRODUCT_TYPE[type]).toBeDefined()
      expect(productMetadataSchema.safeParse(emptyMetadataFor(type)).success).toBe(true)
    }
  })

  it("keeps a font from claiming a page count", () => {
    const result = productMetadataSchema.safeParse({ kind: "font", pageCount: 12 })
    // Unknown keys are stripped rather than accepted as font facts.
    expect(result.success).toBe(true)
    expect(result.success && "pageCount" in result.data).toBe(false)
  })

  it("accepts real font facts", () => {
    const parsed = productMetadataSchema.parse({
      kind: "font",
      styleCount: 14,
      isVariable: true,
      formats: ["otf", "ttf"],
    })
    expect(parsed).toMatchObject({ kind: "font", styleCount: 14, isVariable: true })
  })

  it("degrades unknown stored shapes to generic instead of throwing", () => {
    expect(parseMetadata({ kind: "from-a-future-schema" })).toEqual({ kind: "generic" })
    expect(parseMetadata(null)).toEqual({ kind: "generic" })
    expect(parseMetadata({})).toEqual({ kind: "generic" })
  })
})

describe("storage paths", () => {
  const ids = {
    workspaceId: "11111111-1111-4111-8111-111111111111",
    productId: "22222222-2222-4222-8222-222222222222",
    assetId: "33333333-3333-4333-8333-333333333333",
  }

  it("puts the workspace id first, so one policy covers the bucket", () => {
    const path = buildStoragePath({ ...ids, filename: "aster.zip" })
    expect(path.startsWith(`${ids.workspaceId}/`)).toBe(true)
    expect(path).toBe(`${ids.workspaceId}/${ids.productId}/${ids.assetId}.zip`)
  })

  it("never lets a filename escape its prefix", () => {
    const path = buildStoragePath({ ...ids, filename: "../../../etc/passwd" })
    expect(path.startsWith(`${ids.workspaceId}/${ids.productId}/`)).toBe(true)
    expect(path).not.toContain("..")
    expect(path).not.toContain("passwd")
  })

  it("drops an unusable extension rather than carrying it into the path", () => {
    expect(buildStoragePath({ ...ids, filename: "no-extension" })).toBe(
      `${ids.workspaceId}/${ids.productId}/${ids.assetId}`,
    )
  })

  it("lowercases the extension", () => {
    expect(buildStoragePath({ ...ids, filename: "COVER.PNG" }).endsWith(".png")).toBe(true)
  })
})

describe("sanitizeFilename", () => {
  it("strips directory components a browser may supply", () => {
    expect(sanitizeFilename("../../secret/aster.zip")).toBe("aster.zip")
    expect(sanitizeFilename("C:\\Users\\me\\aster.zip")).toBe("aster.zip")
  })

  it("strips characters that would break a Content-Disposition header", () => {
    const cleaned = sanitizeFilename('as"ter\r\n.zip')
    expect(cleaned).not.toContain('"')
    expect(cleaned).not.toContain("\r")
    expect(cleaned).not.toContain("\n")
  })

  it("never returns an empty name", () => {
    expect(sanitizeFilename("")).toBe("file")
    expect(sanitizeFilename("///")).toBe("file")
  })
})

describe("mime sniffing", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0])
  const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d])

  it("reads the bytes rather than trusting a label", () => {
    expect(sniffMimeType(png)).toBe("image/png")
    expect(sniffMimeType(jpeg)).toBe("image/jpeg")
    expect(sniffMimeType(zip)).toBe("application/zip")
    expect(sniffMimeType(pdf)).toBe("application/pdf")
  })

  it("recognises webp, which needs two windows", () => {
    const webp = Buffer.concat([
      Buffer.from([0x52, 0x49, 0x46, 0x46]),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from([0x57, 0x45, 0x42, 0x50]),
    ])
    expect(sniffMimeType(webp)).toBe("image/webp")
  })

  it("falls back honestly for bytes it does not know", () => {
    expect(sniffMimeType(Buffer.from("just some text"))).toBe(FALLBACK_MIME)
    expect(sniffMimeType(Buffer.alloc(0))).toBe(FALLBACK_MIME)
  })

  it("only calls raster formats derivable", () => {
    expect(isDerivableImage("image/png")).toBe(true)
    expect(isDerivableImage("image/jpeg")).toBe(true)
    // svg is an image but rasterising untrusted svg is a different risk.
    expect(isDerivableImage("image/svg+xml")).toBe(false)
    expect(isDerivableImage("application/zip")).toBe(false)
  })
})

describe("asset helpers", () => {
  it("knows which asset types hold an image", () => {
    expect(isImageAssetType("cover_image")).toBe(true)
    expect(isImageAssetType("specimen")).toBe(true)
    expect(isImageAssetType("deliverable")).toBe(false)
    expect(isImageAssetType("license")).toBe(false)
  })

  it("groups derivatives under their source", () => {
    const asset = (id: string, derivedFrom: string | null) =>
      ({ id, derived_from: derivedFrom }) as ProductAsset

    const { sources, derivativesBySource } = groupDerivatives([
      asset("source-a", null),
      asset("source-b", null),
      asset("derivative-1", "source-a"),
      asset("derivative-2", "source-a"),
    ])

    expect(sources.map((s) => s.id)).toEqual(["source-a", "source-b"])
    expect(derivativesBySource.get("source-a")?.map((d) => d.id)).toEqual([
      "derivative-1",
      "derivative-2",
    ])
    expect(derivativesBySource.has("source-b")).toBe(false)
  })
})
