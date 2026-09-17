import { describe, expect, it, vi } from "vitest"
import { channelImage, renditionSpec, type ImagePolicy } from "@/lib/channels/image-policy"
import type { PublishContext } from "@/lib/channels/types"
import type { ImageSpec } from "@/lib/products/derivatives"
import type { ProductAsset } from "@/lib/products/types"

/**
 * A channel's image policy: when a source goes as it is, when a rendition is
 * built, and what the rendition is. The engine is proven in derivatives.test;
 * this is the decision in front of it, which is pure.
 */

const policy: ImagePolicy = {
  key: "fit-3000",
  maxEdge: 3000,
  accepts: ["image/jpeg", "image/png", "image/gif"],
  maxByteSize: 20 * 1024 * 1024,
}

function asset(overrides: Partial<ProductAsset> = {}): ProductAsset {
  return {
    id: "asset-1",
    workspace_id: "ws-1",
    product_id: "product-1",
    asset_type: "cover_image",
    asset_state: "ready",
    storage_path: "ws-1/product-1/asset-1.png",
    filename: "cover.png",
    mime_type: "image/png",
    byte_size: 1_000_000,
    metadata: { width: 2400, height: 1600 },
    derived_from: null,
    sort_order: 0,
    created_at: "2026-09-17T00:00:00Z",
    ...overrides,
  } as unknown as ProductAsset
}

describe("renditionSpec", () => {
  it("sends a source that already fits, untouched", () => {
    expect(renditionSpec(policy, asset())).toBeNull()
  })

  it("scales a picture larger than the channel's ceiling, inside the frame, never cropping", () => {
    const spec = renditionSpec(policy, asset({ metadata: { width: 6000, height: 4000 } }))
    expect(spec).toMatchObject({
      key: "fit-3000-png",
      width: 3000,
      height: 3000,
      fit: "inside",
      format: "png",
      maxByteSize: policy.maxByteSize,
    })
  })

  it("re-encodes a format the channel refuses, as JPEG", () => {
    const spec = renditionSpec(
      policy,
      asset({
        mime_type: "image/webp",
        filename: "cover.webp",
        metadata: { width: 1200, height: 800 },
      }),
    )
    expect(spec).toMatchObject({ key: "fit-3000-jpeg", format: "jpeg", fit: "inside" })
  })

  it("keeps PNG as PNG where the channel takes it, so transparency survives", () => {
    const spec = renditionSpec(policy, asset({ byte_size: 30 * 1024 * 1024 }))
    expect(spec?.format).toBe("png")
  })

  it("brings a picture over the byte ceiling under it", () => {
    const spec = renditionSpec(
      policy,
      asset({ mime_type: "image/jpeg", filename: "cover.jpg", byte_size: 25 * 1024 * 1024 }),
    )
    expect(spec).toMatchObject({ format: "jpeg", maxByteSize: policy.maxByteSize })
  })

  it("never re-encodes a GIF, which would keep one frame of an animation", () => {
    expect(
      renditionSpec(
        policy,
        asset({ mime_type: "image/gif", metadata: { width: 9000, height: 9000 }, byte_size: 40e6 }),
      ),
    ).toBeNull()
  })

  it("judges an unmeasured picture on format and bytes alone", () => {
    expect(renditionSpec(policy, asset({ metadata: {} }))).toBeNull()
    expect(renditionSpec(policy, asset({ metadata: {}, mime_type: "image/webp" }))?.format).toBe(
      "jpeg",
    )
  })

  it("ignores what is not an image", () => {
    expect(renditionSpec(policy, asset({ mime_type: "application/zip" }))).toBeNull()
    expect(renditionSpec(policy, asset({ mime_type: null }))).toBeNull()
  })

  it("names the spec after the shape, never the channel, so two channels share a cache", () => {
    const other: ImagePolicy = { ...policy, key: "fit-3000" }
    const a = renditionSpec(policy, asset({ metadata: { width: 5000, height: 5000 } }))
    const b = renditionSpec(other, asset({ metadata: { width: 5000, height: 5000 } }))
    expect(a).toEqual(b)
  })
})

describe("channelImage", () => {
  function context(): PublishContext {
    return {
      assetUrl: async (a: ProductAsset) => `https://signed.example/${a.filename}`,
      derivativeUrl: async (a: ProductAsset, spec: ImageSpec) =>
        `https://signed.example/${spec.key}/${a.filename}`,
    } as unknown as PublishContext
  }

  it("hands the channel the source when nothing needs doing", async () => {
    const image = await channelImage(context(), policy, asset())
    expect(image).toEqual({
      url: "https://signed.example/cover.png",
      filename: "cover.png",
      rendered: false,
    })
  })

  it("hands the channel the rendition, named with the extension the bytes have", async () => {
    const image = await channelImage(
      context(),
      policy,
      asset({ mime_type: "image/webp", filename: "cover.webp" }),
    )
    expect(image).toEqual({
      url: "https://signed.example/fit-3000-jpeg/cover.webp",
      filename: "cover.jpg",
      rendered: true,
    })
  })

  it("falls back to the source when the runner offers no renditions", async () => {
    const ctx = context()
    delete ctx.derivativeUrl
    const image = await channelImage(ctx, policy, asset({ mime_type: "image/webp" }))
    expect(image.rendered).toBe(false)
    expect(image.url).toBe("https://signed.example/cover.png")
  })

  it("falls back to the source when the rendition cannot be built, rather than failing the publish", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const ctx = context()
    ctx.derivativeUrl = async () => {
      throw new Error("source is not a readable image")
    }
    const image = await channelImage(ctx, policy, asset({ mime_type: "image/webp" }))
    expect(image).toMatchObject({ rendered: false, url: "https://signed.example/cover.png" })
    vi.restoreAllMocks()
  })
})
