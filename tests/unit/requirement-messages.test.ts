import { describe, expect, it } from "vitest"
import { evaluateRequirements } from "@/lib/channels/requirements"
import type { AdapterSubject, ChannelListingDraft, RequirementSpec } from "@/lib/channels/types"
import type { Product, ProductAsset } from "@/lib/products/types"

/**
 * What a blocked publish says.
 *
 * "Title is empty" describes the field and leaves the consequence to be worked
 * out. The creator is looking at a Publish button that will not move, and the
 * sentence should say why it will not move.
 *
 * The distinction these tests exist to hold: only an error blocks publishing,
 * so only an error may say it does. Both kinds render in the same readiness
 * list, so a warning claiming to be required is a lie sitting one line away
 * from the truth.
 */

const draft: ChannelListingDraft = {
  title: "",
  description: "",
  shortDescription: null,
  price: null,
  currency: "USD",
  category: null,
  tags: [],
  metadata: {},
}

function subject(assets: ProductAsset[] = []): AdapterSubject {
  return { product: { id: "p1", name: "Aster" } as unknown as Product, assets }
}

function messageFor(spec: RequirementSpec, s: AdapterSubject = subject()): string | undefined {
  return evaluateRequirements([spec], draft, s).find((r) => r.key === spec.key)?.message
}

describe("a blocking requirement names the button it blocks", () => {
  it("says so for an empty text field", () => {
    expect(
      messageFor({
        kind: "text",
        key: "title",
        label: "Title",
        severity: "error",
        field: "title",
        minLength: 3,
      }),
    ).toBe("Title is required before you can publish your listing.")
  })

  it("says so for a number that was never set", () => {
    expect(
      messageFor({ kind: "number", key: "price", label: "Price", severity: "error", field: "price" }),
    ).toBe("Price is required before you can publish your listing.")
  })

  it("says so for a missing file, reading the article off the label", () => {
    // Labels carry their own article, so the sentence assembles without one.
    expect(
      messageFor({
        kind: "asset",
        key: "deliverable",
        label: "A deliverable",
        severity: "error",
        assetTypes: ["deliverable"],
        minCount: 1,
      }),
    ).toBe("A deliverable is required before you can publish your listing.")
  })
})

describe("a warning does not claim to block anything", () => {
  it("leaves an optional text field describing itself", () => {
    // Publishing works without a description. Saying it is required would be
    // false, and it would sit directly beneath a sentence that is true.
    expect(
      messageFor({
        kind: "text",
        key: "description",
        label: "Description",
        severity: "warning",
        field: "description",
        minLength: 40,
      }),
    ).toBe("Description is empty.")
  })

  it("leaves an optional file as an invitation rather than a demand", () => {
    expect(
      messageFor({
        kind: "asset",
        key: "cover_image",
        label: "A cover image",
        severity: "warning",
        assetTypes: ["cover_image"],
        minCount: 1,
      }),
    ).toBe("Add a cover image.")
  })
})

describe("a value that is present but wrong keeps its own explanation", () => {
  it("still counts characters rather than saying required", () => {
    // "required" is about absence. A title of the wrong length is present, and
    // the useful sentence is the one with the numbers in it.
    const message = evaluateRequirements(
      [
        {
          kind: "text",
          key: "title",
          label: "Title",
          severity: "error",
          field: "title",
          maxLength: 5,
        },
      ],
      { ...draft, title: "Far too long a title" },
      subject(),
    )[0]?.message

    expect(message).toContain("over the limit")
    expect(message).not.toContain("required")
  })
})
