import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import sharp from "sharp"
import {
  UpscaleRefused,
  derivativeFilename,
  readImageDimensions,
  renderDerivative,
  specHash,
  type ImageSpec,
} from "@/lib/products/derivatives"

/**
 * The A2 exit test, at the pixel level: one source, two genuinely different
 * specs. They differ in aspect ratio AND format, so a pipeline that only
 * resizes, or only re-encodes, cannot pass both.
 *
 * Neither spec is named after a marketplace. lib/products does not know any
 * channel exists.
 */
const THREE_TWO: ImageSpec = {
  key: "wide-3-2",
  width: 1820,
  height: 1214,
  format: "jpeg",
  maxByteSize: 5 * 1024 * 1024,
}

const TWO_ONE: ImageSpec = {
  key: "banner-2-1",
  width: 1200,
  height: 600,
  format: "png",
}

const large = () => readFile("tests/fixtures/specimen-3000x2000.jpg")
const small = () => readFile("tests/fixtures/small-800x600.png")

describe("specHash", () => {
  it("is stable across calls", () => {
    expect(specHash(THREE_TWO)).toBe(specHash(THREE_TWO))
  })

  it("ignores key order in the literal", () => {
    const a: ImageSpec = { key: "k", width: 100, height: 50, format: "jpeg" }
    const b: ImageSpec = { format: "jpeg", height: 50, width: 100, key: "k" }
    expect(specHash(a)).toBe(specHash(b))
  })

  it("separates specs that differ in any rendered property", () => {
    const base: ImageSpec = { key: "k", width: 100, height: 50, format: "jpeg" }
    const variants: ImageSpec[] = [
      { ...base, width: 101 },
      { ...base, height: 51 },
      { ...base, format: "png" },
      { ...base, quality: 50 },
      { ...base, fit: "contain" },
      { ...base, focus: "centre" },
      { ...base, maxByteSize: 1000 },
      { ...base, key: "other" },
    ]
    const hashes = new Set([specHash(base), ...variants.map(specHash)])
    expect(hashes.size).toBe(variants.length + 1)
  })

  it("treats an explicit default as equal to omitting it", () => {
    const implicit: ImageSpec = { key: "k", width: 100, height: 50, format: "jpeg" }
    const explicit: ImageSpec = { ...implicit, fit: "cover", focus: "attention", quality: 82 }
    expect(specHash(implicit)).toBe(specHash(explicit))
  })
})

describe("renderDerivative", () => {
  it("renders the 3:2 jpeg spec at exact dimensions", async () => {
    const out = await renderDerivative(await large(), THREE_TWO)
    expect(out.width).toBe(1820)
    expect(out.height).toBe(1214)
    expect(out.format).toBe("jpeg")

    // Verify against the encoded bytes, not just our own bookkeeping.
    const meta = await sharp(out.data).metadata()
    expect(meta.width).toBe(1820)
    expect(meta.height).toBe(1214)
    expect(meta.format).toBe("jpeg")
  })

  it("renders the 2:1 png spec at exact dimensions", async () => {
    const out = await renderDerivative(await large(), TWO_ONE)
    expect(out.width).toBe(1200)
    expect(out.height).toBe(600)

    const meta = await sharp(out.data).metadata()
    expect(meta.width).toBe(1200)
    expect(meta.height).toBe(600)
    expect(meta.format).toBe("png")
  })

  it("produces different bytes for the two specs from one source", async () => {
    const source = await large()
    const a = await renderDerivative(source, THREE_TWO)
    const b = await renderDerivative(source, TWO_ONE)
    expect(a.data.equals(b.data)).toBe(false)
  })

  it("is deterministic, so a rebuild is genuinely redundant", async () => {
    const source = await large()
    const first = await renderDerivative(source, THREE_TWO)
    const second = await renderDerivative(source, THREE_TWO)
    expect(first.data.equals(second.data)).toBe(true)
  })

  it("honours a byte ceiling by stepping quality down", async () => {
    // The fixture encodes to ~26 KB at the default quality of 82, so this
    // ceiling is deliberately below that and can only be met by stepping down.
    const tight: ImageSpec = { ...THREE_TWO, key: "tight", maxByteSize: 21_000 }
    const out = await renderDerivative(await large(), tight)
    expect(out.byteSize).toBeLessThanOrEqual(21_000)
    expect(out.quality).toBeLessThan(82)
  })

  it("gives up at the quality floor rather than looping forever", async () => {
    // No jpeg of this size will reach 500 bytes. The renderer must stop at the
    // floor and return the smallest it managed, not spin.
    const impossible: ImageSpec = { ...THREE_TWO, key: "impossible", maxByteSize: 500 }
    const out = await renderDerivative(await large(), impossible)
    expect(out.quality).toBe(40)
    expect(out.byteSize).toBeGreaterThan(500)
  })

  it("pads rather than crops when the fit is contain", async () => {
    const out = await renderDerivative(await large(), {
      key: "contain",
      width: 1000,
      height: 1000,
      format: "jpeg",
      fit: "contain",
    })
    expect(out.width).toBe(1000)
    expect(out.height).toBe(1000)
  })

  it("refuses to upscale instead of shipping a blurry enlargement", async () => {
    await expect(renderDerivative(await small(), THREE_TWO)).rejects.toBeInstanceOf(UpscaleRefused)
  })

  it("names the refusal with both sizes so the message is actionable", async () => {
    const error = await renderDerivative(await small(), THREE_TWO).catch((e) => e)
    expect(error).toBeInstanceOf(UpscaleRefused)
    expect(String(error.message)).toContain("800x600")
    expect(String(error.message)).toContain("1820x1214")
  })

  it("rejects bytes that are not an image", async () => {
    await expect(renderDerivative(Buffer.from("not an image"), THREE_TWO)).rejects.toThrow()
  })
})

describe("readImageDimensions", () => {
  it("reads a real image", async () => {
    expect(await readImageDimensions(await large())).toEqual({ width: 3000, height: 2000 })
  })

  it("returns null for non-image bytes rather than throwing", async () => {
    expect(await readImageDimensions(Buffer.from("nope"))).toBeNull()
  })
})

describe("derivativeFilename", () => {
  it("swaps the extension for the spec format", () => {
    expect(derivativeFilename(THREE_TWO, "aster-grotesk.png")).toBe("aster-grotesk-wide-3-2.jpg")
  })

  it("keeps png as png", () => {
    expect(derivativeFilename(TWO_ONE, "cover.jpg")).toBe("cover-banner-2-1.png")
  })
})
