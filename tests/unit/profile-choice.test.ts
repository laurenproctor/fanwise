import { describe, expect, it } from "vitest"
import {
  PROFILE_CHOICE_TEXT,
  planProfileChoice,
  withProductShown,
} from "@/lib/public/profile-choice"

/**
 * The checkbox on a product's public page, below the browser: what it writes
 * into the builder's arrangement, and what it does to the live profile.
 */

const A = "00000000-0000-4000-8000-00000000000a"
const B = "00000000-0000-4000-8000-00000000000b"
const C = "00000000-0000-4000-8000-00000000000c"

describe("the arrangement", () => {
  const arranged = [
    { productId: A, visible: true },
    { productId: B, visible: false },
  ]

  it("appends a product the builder has never arranged", () => {
    expect(withProductShown(arranged, C, true)).toEqual([
      ...arranged,
      { productId: C, visible: true },
    ])
  })

  it("switches an arranged product on in place rather than moving it to the end", () => {
    expect(withProductShown(arranged, B, true)).toEqual([
      { productId: A, visible: true },
      { productId: B, visible: true },
    ])
  })

  it("switches a product off in place, and adds nothing for one never arranged", () => {
    expect(withProductShown(arranged, A, false)).toEqual([
      { productId: A, visible: false },
      { productId: B, visible: false },
    ])
    expect(withProductShown(arranged, C, false)).toEqual(arranged)
  })
})

describe("the plan", () => {
  it("publishes the page now when the profile is live and the product is eligible", () => {
    expect(
      planProfileChoice({
        onProfile: true,
        profileStatus: "published",
        eligible: true,
        live: false,
      }),
    ).toEqual({ outcome: "shown", publishNow: true, unpublishPage: false })
  })

  it("does not publish again a page already live", () => {
    expect(
      planProfileChoice({
        onProfile: true,
        profileStatus: "published",
        eligible: true,
        live: true,
      }),
    ).toEqual({ outcome: "shown", publishNow: false, unpublishPage: false })
  })

  it("keeps the choice when the profile itself is not published", () => {
    expect(
      planProfileChoice({ onProfile: true, profileStatus: "draft", eligible: true, live: false }),
    ).toEqual({ outcome: "chosen_until_published", publishNow: false, unpublishPage: false })
  })

  it("keeps the choice when the product is not live in a shop, and says so", () => {
    const plan = planProfileChoice({
      onProfile: true,
      profileStatus: "published",
      eligible: false,
      live: false,
    })
    expect(plan).toEqual({ outcome: "kept_until_live", publishNow: false, unpublishPage: false })
    expect(PROFILE_CHOICE_TEXT[plan.outcome]).toContain("live in a connected shop")
  })

  it("returns a live page to draft when switched off, and touches nothing otherwise", () => {
    expect(
      planProfileChoice({
        onProfile: false,
        profileStatus: "published",
        eligible: true,
        live: true,
      }),
    ).toEqual({ outcome: "hidden", publishNow: false, unpublishPage: true })
    expect(
      planProfileChoice({ onProfile: false, profileStatus: "draft", eligible: false, live: false }),
    ).toEqual({ outcome: "hidden", publishNow: false, unpublishPage: false })
  })
})
